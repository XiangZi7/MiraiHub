# README 图片维护 / README image maintenance

中英文 README 共用本目录的图片。产品宣传图、当前实机截图和历史实机截图分别标注。

## 当前素材

2026-10-30 更新：采集自版本标记为 **v3.0.9** 的 Windows Tauri 桌面开发版。使用仓库当天已有的 `dist` 前端构建和已编译的 Rust 开发程序，通过真实 WebView2 的本机调试连接采集；没有替换 IPC 或生成模拟查询结果。开发实例使用独立的 WebView 数据目录，未操作正在运行的安装版会话。

| 文件 | 类型与展示内容 | 说明 |
| --- | --- | --- |
| `overview.png` | AI 产品宣传图 | 使用内置 ImageGen 更新，参考脱敏后的当前界面及原有眼镜 Logo；不作为功能验证截图 |
| `workspace.png` | 当前版实机截图 | 本地终端与命令面板；只启动 Shell，未输入演示命令，终端提示符与侧栏的本地目录已遮盖 |
| `ssh-connection.png` | 当前版实机截图 | SSH 连接配置；`server.example.com`、`ubuntu` 为未保存的示例，私钥路径字段已清空 |
| `redis-connection.png` | 当前版实机截图 | Redis 连接配置；`127.0.0.1:6379`、DB 0 为未保存示例，不表示已连接 |
| `ai-agent.png` | 当前版实机截图 | 新建但未保存的 OpenAI 官方示例，模型名称和 API Key 为空，地址仅为公开的官方入口 |
| `ai-capacity.png` | 当前版实机截图 | 同一示例的标准容量、模型 Token 预算与重试设置；没有发送模型请求 |
| `skin.png` | 当前版实机截图 | Kuriyama Mirai 主题的临时预览；其中数据库内容是应用内置的皮肤示例，预览后取消，未保存主题 |
| `database-workspace.png` | v2.0.25 历史实机截图 | 2026-10-08 采集的真实本机 MySQL 查询与 AI 分屏，SQL 仅返回示例常量；本次未覆盖 |
| `ssh-workspace.png` | 历史实机截图 | 仓库保留的早期 SSH 终端与文件图，本次未覆盖 |
| `server-monitoring.png` | 历史实机截图 | 仓库保留的早期监控图，本次未覆盖 |

本次没有使用已认证的 SSH / 数据库连接，三个已连接工作区的历史图片放在两份 README 的折叠区。不要将历史截图标为 v3 当前版截图，也不要将皮肤预览中的示例表格当作实时查询结果。

AI 产品图的生成规格保存在 [product-visual-prompt.txt](product-visual-prompt.txt)。生成只使用已脱敏的界面参考与公开 Logo；宣传图中的界面呈现不作为实机功能验证。

## 替换与校验

1. 使用完整 Tauri 桌面应用；通常通过 `pnpm tauri dev` 启动。浏览器前端不提供原生 SSH、数据库等能力。
2. 优先使用独立的测试会话。连接和模型表单可填写未保存的示例值；图注需说明其状态，避免保存或测试私人模型配置。
3. 保存截图前隐藏主机地址、内部项目名、API 服务地址、私钥路径、凭据、业务数据和本地目录。仅对展示内容遮盖，不改写用户已保存的连接或设置，不用 AI 重绘功能截图。
4. 工作区建议 1600 × 1000，设置页 1400 × 1050，连接表单 1000 × 850；保持窗口边界和底部操作区完整。产品图使用至少 1600 px 宽的横版 PNG。
5. 覆盖对应文件，视觉检查文字、图片资源、遮盖区域和边缘，确认没有加载状态、错误弹窗或未脱敏内容。
6. 同步 `../../README.md`、`../../README.en.md` 与相关功能文档，核对所有图片链接、采集日期、版本和演示状态。
7. 结束后取消设置草稿，关闭本次启动的开发实例和本机截图服务。

## English

Six screenshots were refreshed on **2026-10-30** in the **v3.0.9 Windows Tauri development app**, using that day's existing frontend build and the real Rust backend / WebView2. The development instance used an isolated WebView data directory. No mock IPC or fabricated query results were used.

The workspace capture shows a real local shell and command palette, with local paths concealed. SSH and Redis forms contain unsaved examples. AI screenshots use an unsaved official OpenAI template with an empty model name and API key; no model requests were sent. The theme screen contains the app's built-in database preview, and changes were canceled without saving.

`overview.png` is an **AI-generated promotional visual**. Its specification is saved in [product-visual-prompt.txt](product-visual-prompt.txt). Only sanitized screenshot references and the public logo are used.

`database-workspace.png`, `ssh-workspace.png`, and `server-monitoring.png` remain **historical connected desktop captures**. The database image was captured on 2026-10-08 in v2.0.25 with a constants-only local MySQL query. No authenticated SSH / database connection was used for this refresh; all three images appear in the historical section of both READMEs.

Before replacing images, use a test session, conceal private information, retain the full window and footer, and visually inspect the result. Update both READMEs and relevant guides, cancel unsaved settings, and close capture processes afterward. Never redraw functional screenshots with AI.
