<div align="center">
  <img src="public/logo-app-icon.png" width="88" alt="MiraiHub Logo" />
  <h1>MiraiHub</h1>
  <p><strong>一站式服务器与开发基础设施工作台</strong></p>
  <p>SSH 终端 · 远端文件 · 数据库 · 服务器监控 · AI Agent</p>
  <p>
    <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/v/release/XiangZi7/MiraiHub?style=flat-square&amp;color=8b5cf6" alt="GitHub Release" /></a>
    <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/downloads/XiangZi7/MiraiHub/total?style=flat-square&amp;color=8b5cf6" alt="Downloads" /></a>
    <a href="https://github.com/XiangZi7/MiraiHub/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/XiangZi7/MiraiHub/release.yml?style=flat-square&amp;label=release" alt="Release Workflow" /></a>
    <img src="https://img.shields.io/badge/Windows-x64-0078D4?style=flat-square" alt="Windows x64" />
    <img src="https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/Vue-3-42B883?style=flat-square" alt="Vue 3" />
  </p>
  <p>
    <a href="https://github.com/XiangZi7/MiraiHub/releases/latest"><strong>下载最新版</strong></a> ·
    <a href="#快速上手">快速上手</a> ·
    <a href="#文档">文档</a> ·
    <a href="https://github.com/XiangZi7/MiraiHub/issues">反馈问题</a> ·
    <a href="README.en.md">English</a>
  </p>
</div>

<br />

![MiraiHub 产品概览](docs/images/overview.png)

MiraiHub 是一款基于 **Tauri 2 + Rust + Vue 3** 的桌面工作台。它把服务器连接、文件传输、数据库操作、监控和 AI 辅助放进同一个多标签窗口，面向开发者与服务器维护者。

## 功能亮点

| | 功能 | 说明 |
| :-: | --- | --- |
| 🖥️ | **SSH 与本地终端** | 多连接标签、密码 / 密钥认证、双终端分屏、终端搜索、常用命令与启动命令预设 |
| 📁 | **远端文件** | SFTP 浏览、拖拽上传、下载，统一的传输中心；远端文本编辑带保存预览与冲突检查 |
| 🗄️ | **数据库工作台** | MySQL / PostgreSQL；对象树、数据浏览与编辑、表结构设计、SQL 编辑器、查询历史、导入导出 |
| 📈 | **服务器监控** | 通过 SSH 采集 CPU、内存、磁盘、网络与运行时间，无需在服务器安装 Agent |
| 🤖 | **AI Agent** | 在 SSH 与数据库工作区内对话，支持多模型配置、附件、工具调用与历史；可选逐次审批 / 自动只读 / 完全访问 |
| 🛠️ | **日常运维** | 本地端口转发、批量命令、SSH 密钥管理、连接分组与标签、加密备份与恢复 |
| 🎨 | **个性化** | 中 / 英文并跟随系统、主题皮肤、自定义配色与背景、界面缩放、可调整分屏布局 |

## 界面预览

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/images/ssh-workspace.png" alt="SSH 终端与远端文件" /><br />
      <sub><b>SSH 终端与远端文件</b></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/images/database-workspace.png" alt="数据库工作台与 AI Agent" /><br />
      <sub><b>数据库工作台与 AI Agent</b></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/images/server-monitoring.png" alt="服务器监控" /><br />
      <sub><b>服务器监控</b></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/images/skin.png" alt="主题皮肤" /><br />
      <sub><b>主题皮肤与自定义背景</b></sub>
    </td>
  </tr>
</table>

## 下载与安装

前往 [Releases](https://github.com/XiangZi7/MiraiHub/releases/latest) 下载。当前仅提供 **Windows x64** 构建，macOS / Linux 暂未发布。

| 文件 | 说明 |
| --- | --- |
| `MiraiHub_<version>_windows_x64_setup.exe` | 安装版，按向导完成安装 |
| `MiraiHub_<version>_windows_x64_portable.zip` | 免安装版，解压后运行 `miraihub.exe`，需已安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) |
| `SHA256SUMS.txt` / `version.json` | 校验值与版本、源码提交信息 |

> 安装包暂未做代码签名，Windows SmartScreen 可能提示“未知发布者”，选择「仍要运行」即可。用户数据保存在系统应用数据目录，不随免安装包移动。

## 快速上手

1. **添加连接**：在侧栏新建 SSH、本地终端或数据库连接，填写地址、端口与认证信息；可用分组和标签整理。
2. **进入工作区**：SSH 连接后可使用终端、文件面板与服务器概览；数据库连接后可浏览对象、编辑数据或执行 SQL。
3. **配置 AI（可选）**：「设置 → AI Agent」中添加服务地址、API 格式、模型 ID 和 API Key，保存后测试连接。
4. **与 AI 协作**：在工作区打开 AI Agent 标签或分屏。AI 提议执行命令或 SQL 时，先核对内容再确认。

AI 功能需要自备支持工具调用的模型服务，内置 OpenAI、Claude、DeepSeek、豆包、Gemini 与自定义模板，协议为 **OpenAI Chat Completions 兼容格式** 或 **Claude Messages 格式**。详见 [AI Agent 文档](docs/ai-agent.md)。

## 隐私与安全

- **模型请求**：对话内容与工具结果只发送到你自己配置的模型服务。
- **本地存储**：Windows 上 AI 配置与聊天历史使用当前用户的 DPAPI 加密；连接配置及选择保存的密码、私钥口令存放在本地 WebView 存储中。
- **连接备份**：默认不导出凭据；如需包含，必须设置独立的备份密码。

## 本地开发

| 依赖 | 版本 |
| --- | --- |
| Node.js | 22.22.2 |
| pnpm | 10.33.0（由 `packageManager` 字段锁定） |
| Rust | 1.96.0 |
| Windows | Visual Studio C++ Build Tools、Windows SDK、WebView2 Runtime |

```powershell
git clone https://github.com/XiangZi7/MiraiHub.git
cd MiraiHub
pnpm install --frozen-lockfile
pnpm tauri dev          # 启动前端与桌面应用
```

```powershell
pnpm test                                                        # 前端与发布逻辑测试
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib   # Rust 后端测试
pnpm build                                                       # 类型检查与前端构建
pnpm release:build                                               # 构建 Windows 安装包
pnpm release [patch|minor|major] [--dry-run]                     # 发版：同步版本、打标签并推送
```

仅运行 `pnpm dev` 可预览前端界面，SSH、数据库等原生能力需在 Tauri 应用中使用。发版细节见 [发版说明](docs/RELEASING.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [AI Agent](docs/ai-agent.md) | 模型配置、聊天历史、执行确认与数据处理 |
| [SSH 运维](docs/ssh-operations.md) | 端口转发、远端编辑、批量命令与连接备份 |
| [主题皮肤](docs/theme-skins.md) | 主题、自定义背景、配色与分屏布局 |
| [界面语言](docs/languages.md) | 中英文切换与跟随系统语言 |
| [前端架构](docs/FRONTEND_ARCHITECTURE.md) | 目录职责、路由、会话缓存与 Store 约定 |
| [性能说明](docs/PERFORMANCE.md) | 性能相关实现与验证记录 |
| [发版说明](docs/RELEASING.md) | 自动发布、版本管理与本地打包 |
| [截图维护](docs/images/README.md) | README 图片的命名与替换方式 |

## 参与贡献

欢迎通过 [Issues](https://github.com/XiangZi7/MiraiHub/issues) 反馈问题或提出需求，也欢迎提交 Pull Request。

- **反馈问题**：附上应用版本、系统版本、复现步骤与预期结果；截图和日志请先去除密码、私钥、API Key。
- **提交改动**：每个 PR 聚焦一个问题，说明改动与验证方式；功能变化请同步更新文档与中英文翻译。

## 许可证

仓库暂未添加 `LICENSE` 文件，许可证待维护者确认。

<div align="center">
  <sub>Made with ❤️ by <a href="https://github.com/XiangZi7">XiangZi</a></sub>
</div>
