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

## 自动打包与版本发布

将代码提交到 GitHub 后，推送 `v` 开头的版本标签即可触发 `.github/workflows/release.yml`，自动测试、打包 Windows x64，并发布 GitHub Release。

```powershell
git tag -a v0.2.0 -m "MiraiHub v0.2.0"
git push origin v0.2.0
```

标签版本自动同步到应用“关于”页、Tauri 配置和 Rust 包。正式版使用 `v0.2.0`，测试版使用 `v0.2.0-beta.1`（也支持 `alpha`、`rc`）。每次发布应使用新标签。

发布附件包括安装程序、免安装 ZIP、SHA-256 校验文件和版本信息。免安装版需要系统已安装 WebView2 Runtime；数据仍使用应用的用户数据目录。

完整的首次上传、版本管理、失败重试与本地打包步骤见 [发版说明](docs/RELEASING.md)。
