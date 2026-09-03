//! 远端系统指标采集。
//!
//! 通过一次 exec 把 `/proc` 与几条常规命令的输出一起取回来再解析。
//! 全部走 POSIX 常见工具，不在远端装任何 agent。
//!
//! CPU 使用率需要两次采样求差 —— `/proc/stat` 给的是开机以来的累计时间，
//! 单次读只能算出"开机至今的平均值"，那个数字几乎不变，没有意义。
//! 所以采样脚本自己 sleep 一次读两遍，把差值留给这里算。

use serde::Serialize;

use super::error::SshResult;
use super::session::SshSession;
use super::shell::{section, split_sections};

/// 采集脚本。
///
/// 每一节前打 `@@名字@@` 标记，解析时按标记切分。
/// `2>/dev/null` 与 `|| true` 是必要的：目标可能是精简镜像，
/// 缺 `who`/`uptime` 不该让整次采集失败。
const PROBE_SCRIPT: &str = r#"
echo '@@os@@'; (cat /etc/os-release 2>/dev/null || uname -sr) | head -20
echo '@@kernel@@'; uname -r 2>/dev/null
echo '@@arch@@'; uname -m 2>/dev/null
echo '@@hostname@@'; hostname 2>/dev/null || cat /etc/hostname 2>/dev/null
echo '@@uptime@@'; cat /proc/uptime 2>/dev/null
echo '@@cpuinfo@@'; grep -c '^processor' /proc/cpuinfo 2>/dev/null
echo '@@cpumodel@@'; grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2
echo '@@loadavg@@'; cat /proc/loadavg 2>/dev/null
echo '@@stat1@@'; head -1 /proc/stat 2>/dev/null
echo '@@net1@@'; cat /proc/net/dev 2>/dev/null
sleep 1
echo '@@stat2@@'; head -1 /proc/stat 2>/dev/null
echo '@@net2@@'; cat /proc/net/dev 2>/dev/null
echo '@@meminfo@@'; head -5 /proc/meminfo 2>/dev/null
echo '@@disk@@'; df -kP / 2>/dev/null | tail -1
echo '@@who@@'; who 2>/dev/null | wc -l
"#;

/// 一次采集到的远端系统快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub hostname: String,
    /// 发行版名称，如 "Ubuntu 22.04.3 LTS"
    pub os: String,
    pub kernel: String,
    pub arch: String,
    /// 开机时长秒数
    pub uptime_secs: u64,
    pub cpu: CpuStats,
    pub memory: MemoryStats,
    pub disk: DiskStats,
    pub network: NetworkStats,
    /// 当前登录用户数
    pub online_users: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuStats {
    /// 使用率百分比，两次采样求差得出
    pub usage: f64,
    pub cores: u32,
    pub model: String,
    /// 1 / 5 / 15 分钟平均负载
    pub load: [f64; 3],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    /// 单位 KB，与 /proc/meminfo 一致，换算交给前端
    pub total_kb: u64,
    pub used_kb: u64,
    /// swap 未启用时为 0
    pub swap_total_kb: u64,
    pub swap_used_kb: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStats {
    /// 根分区，单位 KB
    pub total_kb: u64,
    pub used_kb: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    /// 每秒字节数，由两次采样差值除以采样间隔得出
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
}

/// 采样脚本里 sleep 的秒数，算速率时作除数。
const SAMPLE_INTERVAL_SECS: f64 = 1.0;

/// 在会话上采集一次系统指标。
pub async fn collect(session: &SshSession) -> SshResult<SystemStats> {
    let output = session.exec(PROBE_SCRIPT).await?;
    Ok(parse(&output.stdout))
}

/// 解析采集脚本的输出。
///
/// 单独拆出来是为了能用固定样本测 —— 各字段的解析都有边界情况
/// （字段缺失、格式变体），靠连真机验证不现实。
fn parse(stdout: &str) -> SystemStats {
    let sections = split_sections(stdout);

    let (total_kb, used_kb, swap_total_kb, swap_used_kb) =
        parse_meminfo(section(&sections, "meminfo"));
    let (disk_total, disk_used) = parse_df(section(&sections, "disk"));

    SystemStats {
        hostname: section(&sections, "hostname").to_owned(),
        os: parse_os_release(section(&sections, "os")),
        kernel: section(&sections, "kernel").to_owned(),
        arch: section(&sections, "arch").to_owned(),
        uptime_secs: parse_uptime(section(&sections, "uptime")),
        cpu: CpuStats {
            usage: parse_cpu_usage(section(&sections, "stat1"), section(&sections, "stat2")),
            cores: section(&sections, "cpuinfo").parse().unwrap_or(0),
            model: section(&sections, "cpumodel").to_owned(),
            load: parse_loadavg(section(&sections, "loadavg")),
        },
        memory: MemoryStats {
            total_kb,
            used_kb,
            swap_total_kb,
            swap_used_kb,
        },
        disk: DiskStats {
            total_kb: disk_total,
            used_kb: disk_used,
        },
        network: parse_network(section(&sections, "net1"), section(&sections, "net2")),
        online_users: section(&sections, "who").parse().unwrap_or(0),
    }
}

/// 从 os-release 里取 PRETTY_NAME。
///
/// 拿不到就退回整段第一行 —— 非 Linux（如 BSD、macOS）没有这个文件，
/// 脚本会退化成 `uname -sr` 的输出，那一行本身就够用了。
fn parse_os_release(text: &str) -> String {
    for line in text.lines() {
        if let Some(value) = line.trim().strip_prefix("PRETTY_NAME=") {
            return value.trim_matches('"').to_owned();
        }
    }

    text.lines().next().unwrap_or_default().trim().to_owned()
}

/// `/proc/uptime` 第一个字段是开机秒数（带小数）。
fn parse_uptime(text: &str) -> u64 {
    text.split_whitespace()
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .map(|secs| secs as u64)
        .unwrap_or(0)
}

/// `/proc/loadavg` 前三个字段是 1/5/15 分钟负载。
fn parse_loadavg(text: &str) -> [f64; 3] {
    let mut load = [0.0; 3];

    for (slot, value) in load.iter_mut().zip(text.split_whitespace()) {
        *slot = value.parse().unwrap_or(0.0);
    }

    load
}

/// 两次 `/proc/stat` 的 cpu 行求差算使用率。
///
/// 行格式：`cpu user nice system idle iowait irq softirq steal ...`
/// 使用率 = (总时间增量 - 空闲时间增量) / 总时间增量。
/// idle 与 iowait 都算空闲 —— 等 IO 时 CPU 确实没在干活。
fn parse_cpu_usage(first: &str, second: &str) -> f64 {
    let Some((total1, idle1)) = parse_cpu_line(first) else {
        return 0.0;
    };
    let Some((total2, idle2)) = parse_cpu_line(second) else {
        return 0.0;
    };

    // 计数器只增不减，但远端可能返回同一份缓存导致增量为 0，此时报 0 而不是除零
    let total_delta = total2.saturating_sub(total1);
    if total_delta == 0 {
        return 0.0;
    }

    let idle_delta = idle2.saturating_sub(idle1);
    let busy = total_delta.saturating_sub(idle_delta);

    round2(busy as f64 * 100.0 / total_delta as f64)
}

/// 解析一行 `/proc/stat` 的 cpu 汇总，返回 (总时间, 空闲时间)。
fn parse_cpu_line(line: &str) -> Option<(u64, u64)> {
    let mut fields = line.split_whitespace();

    if fields.next()? != "cpu" {
        return None;
    }

    let values: Vec<u64> = fields.filter_map(|value| value.parse().ok()).collect();

    // 至少要有 user/nice/system/idle 四项才算有效
    if values.len() < 4 {
        return None;
    }

    let total: u64 = values.iter().sum();
    // 第 4 项 idle，第 5 项 iowait（可能不存在，如精简内核）
    let idle = values[3] + values.get(4).copied().unwrap_or(0);

    Some((total, idle))
}

/// 解析 `/proc/meminfo` 前几行，返回 (总内存, 已用, swap 总量, swap 已用)，单位 KB。
///
/// 已用不取 `MemTotal - MemFree`：那样会把页缓存算成占用，
/// 得出的数字远高于用户感知。`MemAvailable` 是内核给出的
/// "无需换出即可分配的量"，与 `free -h` 的 available 列一致。
fn parse_meminfo(text: &str) -> (u64, u64, u64, u64) {
    let mut total = 0;
    let mut available = 0;
    let mut free = 0;
    let mut swap_total = 0;
    let mut swap_free = 0;

    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };

        let kb = value
            .split_whitespace()
            .next()
            .and_then(|num| num.parse::<u64>().ok())
            .unwrap_or(0);

        match key.trim() {
            "MemTotal" => total = kb,
            "MemAvailable" => available = kb,
            "MemFree" => free = kb,
            "SwapTotal" => swap_total = kb,
            "SwapFree" => swap_free = kb,
            _ => {}
        }
    }

    // 老内核（3.14 以前）没有 MemAvailable，退回 MemFree
    let unused = if available > 0 { available } else { free };
    let used = total.saturating_sub(unused);

    (
        total,
        used,
        swap_total,
        swap_total.saturating_sub(swap_free),
    )
}

/// 解析 `df -kP /` 的数据行，返回 (总量, 已用)，单位 KB。
///
/// `-P` 保证一行输出：设备名过长时 df 默认会折行，字段位置就错位了。
fn parse_df(line: &str) -> (u64, u64) {
    let fields: Vec<&str> = line.split_whitespace().collect();

    // Filesystem 1024-blocks Used Available Capacity Mounted
    if fields.len() < 4 {
        return (0, 0);
    }

    let total = fields[1].parse().unwrap_or(0);
    let used = fields[2].parse().unwrap_or(0);

    (total, used)
}

/// 两次 `/proc/net/dev` 求差算网络速率。
fn parse_network(first: &str, second: &str) -> NetworkStats {
    let (rx1, tx1) = sum_interfaces(first);
    let (rx2, tx2) = sum_interfaces(second);

    NetworkStats {
        rx_bytes_per_sec: ((rx2.saturating_sub(rx1)) as f64 / SAMPLE_INTERVAL_SECS) as u64,
        tx_bytes_per_sec: ((tx2.saturating_sub(tx1)) as f64 / SAMPLE_INTERVAL_SECS) as u64,
    }
}

/// 汇总 `/proc/net/dev` 里所有物理网卡的收发字节数。
///
/// 跳过 lo：本机回环流量不反映对外带宽，
/// 而容器化环境里的本地通信会让这个数字虚高一大截。
fn sum_interfaces(text: &str) -> (u64, u64) {
    let mut rx = 0;
    let mut tx = 0;

    for line in text.lines() {
        let Some((name, values)) = line.split_once(':') else {
            // 表头两行没有冒号，自然被跳过
            continue;
        };

        if name.trim() == "lo" {
            continue;
        }

        let fields: Vec<u64> = values
            .split_whitespace()
            .map(|value| value.parse().unwrap_or(0))
            .collect();

        // 接收 8 列后才是发送，取第 0 列（rx bytes）与第 8 列（tx bytes）
        if fields.len() >= 9 {
            rx += fields[0];
            tx += fields[8];
        }
    }

    (rx, tx)
}

/// 保留两位小数。百分比显示到小数点后两位够用，再多是噪声。
fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pretty_name() {
        let text = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 22.04.3 LTS\"\nID=ubuntu";
        assert_eq!(parse_os_release(text), "Ubuntu 22.04.3 LTS");
    }

    #[test]
    fn falls_back_to_uname_output() {
        assert_eq!(parse_os_release("Linux 5.15.0"), "Linux 5.15.0");
    }

    #[test]
    fn computes_cpu_usage_from_two_samples() {
        // 两次采样间总增量 200，其中空闲 150 → 忙 50 → 25%
        let first = "cpu 100 0 100 800 0 0 0 0";
        let second = "cpu 125 0 125 940 10 0 0 0";
        assert_eq!(parse_cpu_usage(first, second), 25.0);
    }

    #[test]
    fn cpu_usage_is_zero_when_counters_do_not_advance() {
        let line = "cpu 100 0 100 800 0 0 0 0";
        assert_eq!(parse_cpu_usage(line, line), 0.0);
    }

    #[test]
    fn memory_uses_available_not_free() {
        let text = "MemTotal:  16000 kB\nMemFree:  2000 kB\nMemAvailable:  9000 kB\n\
                    SwapTotal:  4000 kB\nSwapFree:  3000 kB";
        let (total, used, swap_total, swap_used) = parse_meminfo(text);

        assert_eq!(total, 16000);
        // 16000 - 9000（available），而不是 16000 - 2000（free）
        assert_eq!(used, 7000);
        assert_eq!(swap_total, 4000);
        assert_eq!(swap_used, 1000);
    }

    #[test]
    fn memory_falls_back_to_free_on_old_kernels() {
        let text = "MemTotal:  16000 kB\nMemFree:  2000 kB";
        let (_, used, _, _) = parse_meminfo(text);
        assert_eq!(used, 14000);
    }

    #[test]
    fn parses_df_line() {
        let line = "/dev/sda1  500000000  124000000  376000000  25% /";
        assert_eq!(parse_df(line), (500_000_000, 124_000_000));
    }

    #[test]
    fn network_skips_loopback() {
        let first =
            "Inter-|   Receive\n face |bytes\n  lo: 1000 0 0 0 0 0 0 0 1000 0 0 0 0 0 0 0\n\
                     eth0: 5000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0";
        let second = "  lo: 9000 0 0 0 0 0 0 0 9000 0 0 0 0 0 0 0\n\
                      eth0: 6000 0 0 0 0 0 0 0 2500 0 0 0 0 0 0 0";

        let stats = parse_network(first, second);
        // lo 涨了 8000 但被跳过，只算 eth0 的 1000 / 500
        assert_eq!(stats.rx_bytes_per_sec, 1000);
        assert_eq!(stats.tx_bytes_per_sec, 500);
    }

    #[test]
    fn parses_full_probe_output() {
        let stdout = "@@os@@\nPRETTY_NAME=\"Debian 12\"\n@@kernel@@\n6.1.0\n@@arch@@\nx86_64\n\
                      @@hostname@@\nweb-01\n@@uptime@@\n3600.55 7000.00\n@@cpuinfo@@\n4\n\
                      @@cpumodel@@\n Intel Xeon\n@@loadavg@@\n0.52 0.48 0.44 1/234 5678\n\
                      @@stat1@@\ncpu 100 0 100 800 0 0 0 0\n@@net1@@\neth0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n\
                      @@stat2@@\ncpu 150 0 150 900 0 0 0 0\n@@net2@@\neth0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n\
                      @@meminfo@@\nMemTotal: 8000 kB\nMemAvailable: 3000 kB\n\
                      @@disk@@\n/dev/sda1 1000 250 750 25% /\n@@who@@\n2\n";

        let stats = parse(stdout);

        assert_eq!(stats.os, "Debian 12");
        assert_eq!(stats.hostname, "web-01");
        assert_eq!(stats.uptime_secs, 3600);
        assert_eq!(stats.cpu.cores, 4);
        assert_eq!(stats.cpu.model, "Intel Xeon");
        assert_eq!(stats.cpu.load, [0.52, 0.48, 0.44]);
        assert_eq!(stats.memory.used_kb, 5000);
        assert_eq!(stats.disk.used_kb, 250);
        assert_eq!(stats.online_users, 2);
    }

    /// 远端是精简镜像时大部分节都取不到，此时应给出全 0 的结果而不是 panic
    #[test]
    fn tolerates_missing_sections() {
        let stats = parse("@@os@@\n@@disk@@\n");

        assert_eq!(stats.cpu.cores, 0);
        assert_eq!(stats.memory.total_kb, 0);
        assert_eq!(stats.disk.total_kb, 0);
        assert_eq!(stats.uptime_secs, 0);
    }
}
