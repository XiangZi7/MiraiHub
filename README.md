# MiraiHub

基于 Tauri 2、Rust、Vue 3 和 TypeScript 的桌面工作台，集中管理 SSH 终端、远端文件、数据库连接与 AI Agent。

## 开发

Windows 开发环境需要 Node.js 22.22.2、pnpm 10.33.0、Rust 1.96.0、Visual Studio C++ Build Tools 和 WebView2 Runtime。

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

```powershell
pnpm test
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
pnpm build
```

前端采用 Vue Router + Pinia，目录职责、页面路由、会话缓存和 Store 使用约定见 [前端架构](docs/FRONTEND_ARCHITECTURE.md)。

## 自动打包与版本发布

先提交准备发布的源码，再运行一条命令，自动递增版本、提交版本文件并推送当前分支和新标签，触发 GitHub Actions 测试、打包 Windows x64 并发布 GitHub Release：

```powershell
pnpm release               # 补丁版本 +1，例如 v1.0.1 → v1.0.2
pnpm release minor         # 次版本 +1，例如 v1.0.2 → v1.1.0
pnpm release major         # 主版本 +1，例如 v1.1.0 → v2.0.0
pnpm release --dry-run     # 仅预览，不发版
```

上面的命令各自独立，日常发版只需运行 `pnpm release`。版本基于本地配置、本地标签和远程标签中的最高版本递增，自动同步到应用“关于”页、Tauri 配置和 Rust 包。正式发版要求工作区无未提交改动，并具有 `origin` 的推送权限。测试版仍可手动推送 `v0.2.0-beta.1` 等标签（也支持 `alpha`、`rc`）。

发布附件包括安装程序、免安装 ZIP、SHA-256 校验文件和版本信息。免安装版需要系统已安装 WebView2 Runtime；数据仍使用应用的用户数据目录。

完整的首次上传、版本管理、失败重试与本地打包步骤见 [发版说明](docs/RELEASING.md)。
