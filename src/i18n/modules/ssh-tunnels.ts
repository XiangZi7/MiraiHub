/** ssh-tunnels 相关文案。中文原文即消息 ID，zh-CN 目录自动按 en 的键生成同名条目。 */
export const en: Record<string, string> = {
  'SSH 隧道 / 端口转发': 'SSH Tunnels / Port Forwarding',
  '通过已连接的 SSH 服务器转发端口：本地转发、远程转发或动态 SOCKS5 代理。':
    'Forward ports through a connected SSH server: local forwarding, remote forwarding, or a dynamic SOCKS5 proxy.',
  隧道类型: 'Tunnel type',
  本地转发: 'Local forwarding',
  远程转发: 'Remote forwarding',
  动态转发: 'Dynamic forwarding',
  '本机端口 → SSH 服务器 → 目标服务（ssh -L）':
    'Local port → SSH server → target service (ssh -L)',
  'SSH 服务器端口 → 本机 → 目标服务（ssh -R）':
    'SSH server port → this machine → target service (ssh -R)',
  '本机 SOCKS5 代理，经 SSH 服务器连接任意目标（ssh -D）':
    'Local SOCKS5 proxy that reaches any target through the SSH server (ssh -D)',
  远端监听: 'Remote listener',
  'SSH 服务器': 'SSH server',
  远端端口: 'Remote port',
  '端口填 0 时由服务器分配，仅服务器本机可访问。':
    'Port 0 lets the server assign one. Only reachable from the server itself.',
  '本地 SOCKS5 监听': 'Local SOCKS5 listener',
  '端口填 0 时自动分配。浏览器或应用把 SOCKS5 代理指向该地址，即可经 SSH 服务器访问任意目标。':
    'Port 0 assigns one automatically. Point a browser or app SOCKS5 proxy at this address to reach any target through the SSH server.',
  本地目标: 'Local target',
  '由本机发起连接，127.0.0.1 表示本机自身。':
    'Connections are made from this machine; 127.0.0.1 means this machine itself.',
  建立远程隧道: 'Create remote tunnel',
  建立动态代理: 'Create dynamic proxy',
  远端: 'Remote',
  '复制远端监听地址': 'Copy remote listen address',
  '复制 SOCKS5 代理地址': 'Copy SOCKS5 proxy address',
}
