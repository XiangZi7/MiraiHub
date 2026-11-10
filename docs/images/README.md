# README 图片

2026-11-10 更新。中英文 README 共用本目录素材。

## 当前首页素材

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `showcase-hero-zh.png` / `showcase-hero-en.png` | 首页顶部宣传图 | 原有 ImageGen 产品图与 HTML 排版，本次保持原样 |
| `feature-ssh-dark.png` | SSH 终端与 SFTP 文件面板 | 真实 SSH 会话，实际执行 `ls` 并读取演示目录 |
| `feature-database-dark.png` | 深色 SQL 编辑器、对象树、查询结果 | 真实 MySQL 8.0.46；独立演示库，24 行查询结果 |
| `feature-database-light.png` | 同一查询工作区的浅色外观 | 同一真实 MySQL 会话，通过软件自身开关切换主题 |
| `feature-files-light.png` | 本地 / 远端双栏浏览 | 真实本地文件 API 与 SFTP；两侧均为预设演示文件 |
| `feature-redis-dark.png` | 键分组、JSON 值与 TTL | 真实 Redis 7 临时容器，经 SSH 隧道连接；5 个预设键 |
| `feature-ai-dark.png` | 数据库与 AI Agent 分屏、提示词草稿 | 真实未配置模型状态；没有模拟回答或模型请求 |
| `feature-er-light.png` | 四张演示表的三条外键关系 | 真实 SQLite 3.46.0 文件的表与外键元数据 |
| `feature-designer-light.png` | 订单表字段、类型、索引、外键与中文注释 | 真实 MySQL 演示表的可视化设计器，未保存结构修改 |
| `feature-monitor-light.png` | 服务器指标浮层与系统信息 | 当前版本实际界面；CPU、内存、磁盘、网络等均为真实采样 |

顶部宣传图为原有 1600 × 800 素材，由 [readme-showcase.html](../../tests/readme-showcase.html) 排版并嵌入 AI 产品图。本次只替换下方九张 `feature-*.png`。

九张功能图来自 Windows 上使用 `pnpm tauri dev` 启动的 **v4.0.7 完整桌面应用**，统一为 1818 × 900 PNG。Windows 窗口抓图工具超时后，直接通过该应用 WebView2 的本机调试接口读取原始画面；没有打开独立浏览器演示页、替换 IPC、重绘 UI 或进行 AI 修图。截图前已从源码移除标题栏的“开发环境”标签。

## 隐私打码

九张功能图已在本地添加不透明遮挡，覆盖私人连接名称、终端用户名和所属用户/组、主机标识、Redis 连接地址与端口、SSH 连接摘要及本机绝对路径。预设的客户、商品和订单数据、演示目录与真实监控指标保留。顶部宣传图使用示例内容，保持原样。

遮挡直接写入最终 PNG 像素，不使用可还原的模糊或独立图层，不上传图片到图像生成服务，也不另存未脱敏备份。脚本逐像素校验遮挡区域外的图像未变，并重新读取保存的 PNG 验证结果。

```powershell
pwsh -File scripts/redact-readme-images.ps1
```

遮挡坐标记录在 [readme-redactions.json](../../scripts/readme-redactions.json)，对应当前 1818 × 900 构图。重新截图后先检查位置，再更新坐标并运行脚本；尺寸不符会停止处理。

## 预设数据

客户、商品、订单和明细均为虚构的预设数据，实际写入数据库：12 位客户、6 件商品、24 笔订单、24 条明细。表名使用 `mh_` 前缀，具有三条真实外键。MySQL 的表、字段和索引带中文原生注释；SQLite 不支持原生注释，在建表 SQL 中保留说明。

```powershell
python scripts/seed-readme-demo.py
python scripts/seed-readme-files.py
```

第一个脚本生成 `output/readme-demo/miraihub-demo.sqlite` 和同名 `.mysql.sql`。在已授权的 MySQL 开发连接中执行生成的 SQL，可建立独立的 `miraihub_readme_demo` 库；DDL 见 [readme-demo-mysql.sql](../../scripts/readme-demo-mysql.sql)。脚本使用 `CREATE IF NOT EXISTS` / `INSERT IGNORE`，不删除或覆盖已有记录。第二个脚本创建本地演示项目，保留同名已有文件。

本次经用户明确授权，仅新增远端 `/tmp/miraihub-readme-demo` 目录和独立演示库。Redis 使用现有官方 `redis:7` 镜像启动隔离容器，仅绑定服务器 `127.0.0.1:16379`，不使用业务 Redis；截图后停止并移除该容器。演示数据库与文件保留，便于重复截图。没有改动业务数据。

## 重新采集

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9237 --remote-debugging-address=127.0.0.1'
pnpm tauri dev
# 在软件中正常打开功能，等待真实连接与数据加载完成，再在另一个终端保存当前画面：
node scripts/capture-tauri-readme.mjs --output=docs/images/feature-database-dark.png
# 使用软件自身的外观开关切换浅色，再采集：
node scripts/capture-tauri-readme.mjs --output=docs/images/feature-database-light.png
```

脚本只读取已经运行的 Tauri 主窗口，检查真实 Tauri 环境、主题和开发标签，不启动浏览器、不修改 DOM 或 IPC、不导航页面、不模拟服务。原生窗口尺寸决定截图尺寸，本次保留窗口实际的 1818 × 900。结束后退出开发进程即可关闭调试端口。

检查查询结果、对象树、Redis 键值与 TTL、文件列表是否完整，确认深浅色可读、没有错误提示。AI 没有配置模型时保留真实状态，不能补造对话。

公开截图前按上方“隐私打码”步骤遮挡敏感信息，再检查全部最终图片。

## 历史素材

旧 [readme-preview.html](../../tests/readme-preview.html) / [readme-preview.mjs](../../tests/readme-preview.mjs) 使用模拟 IPC，仅供组件预览。旧 `capture-readme.mjs` 的功能图现输出到 `output/readme-fixtures/`，不会覆盖当前首页的真实截图。`--showcase` 仍用于历史宣传图排版。

其余 `showcase-*.png`、`overview.png`、`workspace.png`、连接与设置图等保留供历史文档引用。产品图生成提示词见 [product-visual-prompt.txt](product-visual-prompt.txt)。

## English

The nine feature images were refreshed on 2026-11-10 from the actual v4.0.7 Windows desktop app launched with `pnpm tauri dev`. They are raw frames from that app's WebView2, with real Rust backend calls, SSH/SFTP, MySQL, SQLite and Redis connections. No IPC mocks, browser fixture pages, AI redraws or fabricated responses were used. The original ImageGen-based hero images remain unchanged.

Opaque local redactions cover private connection names, usernames, host identifiers, server addresses and ports, SSH connection details and local absolute paths. Only those pixels are replaced; the remaining screenshot pixels are verified unchanged. The saved PNG is flattened and verified again, with no unredacted backup or image-generation service involved. Review the coordinate manifest before applying the redaction script to new captures.

The database contains 12 fictional customers, 6 products, 24 orders and 24 order items. The files and five Redis keys are seeded examples; system metrics and terminal output are real. The AI image shows its actual unconfigured state with a prompt draft, without sending model requests. Remote demo resources were explicitly authorized; the temporary Redis container is removed after capture, while the isolated demo databases and files remain reusable. The scripts above reproduce the data and capture the running desktop app. Historical browser-fixture captures now go to `output/readme-fixtures/`.
