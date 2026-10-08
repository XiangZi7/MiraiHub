# README 图片维护 / README image maintenance

中英文 README 共用本目录的图片。产品宣传图与实机截图分别维护，避免将 AI 图、皮肤预览或未连接的界面误标为真实运行结果。

## 当前素材

2026-10-08 更新：使用 v2.0.25 源码启动 Windows Tauri 桌面开发版，通过实际应用的 WebView2 采集界面；没有使用 mock IPC 页面代替工作区。截图时临时统一视口与界面缩放，保存后恢复缩放。表单示例未保存，皮肤只做预览后取消。

| 文件 | 类型与展示内容 | 说明 |
| --- | --- | --- |
| `overview.png` | AI 产品宣传图 | 使用内置 ImageGen 生成，参考当前数据库实机截图及现有眼镜 Logo；不作为功能验证截图 |
| `database-workspace.png` | 当前版实机截图 | 本机 MySQL 实际连接、SQL 编辑器、真实查询结果与 AI 分屏；SQL 只返回示例常量，不读取业务记录 |
| `ssh-connection.png` | 当前版实机截图 | SSH 连接配置窗口；`server.example.com` 为未保存的示例，私钥路径已隐藏 |
| `redis-connection.png` | 当前版实机截图 | Redis 连接配置窗口；`127.0.0.1:6379` 与 DB 0 为未保存的配置示例，不表示 Redis 已连接 |
| `ai-agent.png` | 当前版实机截图 | AI 多配置与 Responses 设置；自定义服务地址已隐藏，未发送模型请求 |
| `skin.png` | 当前版实机截图 | Kuriyama Mirai 主题设置；卡片和窗口内含应用自带的皮肤预览，并非实时数据库会话 |
| `ssh-workspace.png` | 历史实机截图 | 仓库原有 SSH 终端与文件图，本次未更新；仅在历史截图折叠区展示 |
| `server-monitoring.png` | 历史实机截图 | 仓库原有监控图，本次未更新；仅在历史截图折叠区展示 |

本次已有 SSH 连接出现超时或断开，未采集到新的已连接终端、SFTP 文件列表或监控指标。后续有可用连接时，再用新实机截图覆盖历史图片，并同步更新两份 README 与本说明。

AI 产品图的最终生成规格保存在 [product-visual-prompt.txt](product-visual-prompt.txt)。参考文件为 `database-workspace.png` 与 `../../public/logo-app-icon.png`，使用内置工具，无需 CLI / API Key。

## 替换与校验

1. 启动完整桌面版 `pnpm tauri dev`；浏览器前端不提供 SSH、数据库等原生能力。
2. 用测试环境或只读查询准备画面。配置窗口可以填写未保存的示例值；图注需说明它们是配置示例。
3. 隐藏主机地址、内部项目名、API 服务地址、私钥路径、凭据与业务数据。只改变展示内容，不改写保存的连接或设置；不要用 AI 重绘功能截图。
4. 建议工作区使用 1600 × 1000，设置页 1280 × 960，连接表单 1000 × 800，产品宣传图使用至少 1600 px 宽的 16:9 PNG。保持完整窗口与底部操作区可见。
5. 覆盖对应文件，检查文字、主题图片、查询结果和边缘是否清晰，确认无加载状态或错误弹窗。
6. 新增或改变展示位置时，同步 `../../README.md`、`../../README.en.md` 及相关功能文档，核对图片链接。

## English

Both READMEs share these images. Five captures were refreshed on **2026-10-08** from the **v2.0.25 Windows Tauri development app**, using its real WebView2 renderer. The database image uses a live local MySQL connection with a constants-only query. SSH and Redis forms are unsaved examples; the theme screen contains the app's built-in preview. Addresses and private key paths have been hidden.

`overview.png` is an **AI-generated promotional visual**, created with the built-in ImageGen tool from the current database screenshot and existing eyeglasses logo. The final specification is saved in [product-visual-prompt.txt](product-visual-prompt.txt).

`ssh-workspace.png` and `server-monitoring.png` remain **earlier desktop screenshots**. Existing SSH connections timed out or disconnected during this session, so no new connected SSH / SFTP / monitoring captures were produced. Do not present these images as current-version captures.

For replacements, start the complete desktop app, use test environments or read-only queries, conceal private data, retain the full window and footer, and check every image visually. Update both READMEs and the relevant guides when adding or changing a slot. Never redraw functional screenshots with AI.
