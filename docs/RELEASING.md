# GitHub 上传与自动发版

## 一条命令发版

先提交准备发布的源码，再运行：

```powershell
pnpm release
```

脚本默认递增补丁版本，依次检查工作区和远程分支、读取本地与远程版本标签、同步四个版本文件、创建 `chore(release): vX.Y.Z` 提交和附注标签，然后将当前分支与新标签一起推送到 `origin`。GitHub Actions 接着自动测试、构建安装版和免安装版、上传附件并公开 Release，无需手动填写版本号或创建 Release。

| 命令                                   | 用途                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| `pnpm release` 或 `pnpm release patch` | 补丁版本 +1，例如 `1.0.1 → 1.0.2`                        |
| `pnpm release minor`                   | 次版本 +1，补丁归零，例如 `1.0.2 → 1.1.0`                |
| `pnpm release major`                   | 主版本 +1，其余归零，例如 `1.1.0 → 2.0.0`                |
| `pnpm release --dry-run`               | 联网读取标签并预览，不修改文件、创建提交、创建标签或推送 |
| `pnpm release --retry v1.0.2`          | 推送失败后重试同一版本，不再递增                         |

自动递增以本地 `package.json`、本地标签、`origin` 推送目标的远程标签中最高的主/次/补丁版本为基准。例如源码仍是 `0.1.0`，远程已有 `v1.0.1`，下一次默认发版就是 `v1.0.2`。预发布标签的数值版本也参与比较；该命令总是递增所选数字段并生成正式版，例如基准为 `v2.0.0-beta.1` 时默认生成 `v2.0.1`。需要发布预览版时，使用下文的手动标签流程。

正式发版要求：

- 源码、暂存区和未跟踪文件均无待提交改动；脚本只自动提交四个版本文件。`--dry-run` 可在有改动时预览。
- 已配置 Git 作者信息和唯一的 `origin` 推送地址，并拥有当前分支与标签的推送权限。
- 当前检出的是分支，且包含远程同名分支的最新提交；落后或分叉时，先自行拉取并整合。

分支与新标签使用原子推送：任一项被拒绝，两者都不会更新。不会强制推送、覆盖旧标签或顺带推送其他标签。推送失败时保留本地版本提交和标签，按报错提示执行 `pnpm release --retry vX.Y.Z`。重试要求版本文件与标签一致、标签指向当前 HEAD；若这期间又提交了代码，先检查并处理原版本提交。

命令成功表示版本提交和标签已推送，最终安装包是否发布成功请看 **Actions → Release**。如果标签已推送而 CI 失败，直接在 Actions 重试失败任务；`--retry` 推送已存在的标签不会重新触发工作流。

## 首次上传

当前仓库的远程地址为 `https://github.com/XiangZi7/MiraiHub.git`，开发分支为 `master`。

1. 在 GitHub 仓库的 Actions 页面确认工作流已启用。工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需个人 Token 或额外 Secret。
2. 检查本地改动，将准备发布的源码、锁文件、`scripts`、`tests` 和 `.github/workflows/release.yml` 一起提交。不要上传本地连接备份、SSH 私钥或 AI API Key。`node_modules`、`dist`、Rust `target` 和 `release-output` 已被忽略。
3. 提交后运行一键发版命令；它会一并上传当前分支并创建新版本标签。

```powershell
git status
# 使用编辑器的源代码管理界面选择需要上传的文件并暂存；也可逐个 git add。
git commit -m "chore: prepare release"
pnpm release
```

如果你克隆到了另一仓库，先通过 `git remote -v` 确认 `origin`，再推送。工作流从 GitHub 上下文读取仓库名，不写死发布目标。

## 手动标签与版本号

也可以手动指定版本并推送标签，适合测试版或需要精确指定版本号的情况。先提交源码并推送分支，再使用一个尚未发布的新标签，例如：

```powershell
git push origin master
git tag -a v1.1.0-beta.1 -m "MiraiHub v1.1.0-beta.1"
git push origin v1.1.0-beta.1
```

| 标签            | 应用版本       | Release 类型               |
| --------------- | -------------- | -------------------------- |
| `v0.2.0`        | `0.2.0`        | 正式版，标记为 Latest      |
| `v0.2.1`        | `0.2.1`        | 修复版，标记为 Latest      |
| `v0.3.0-beta.1` | `0.3.0-beta.1` | Pre-release，不替换 Latest |
| `v0.3.0-rc.1`   | `0.3.0-rc.1`   | Pre-release，不替换 Latest |

只接受 `v主版本.次版本.修订版本`，或者末尾加 `-alpha.N`、`-beta.N`、`-rc.N`；数字不能有多余的前导零，前三段不能超过 65535。版本不合规则直接失败。

CI 以标签为唯一版本来源，在构建前同时更新：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` 中的 MiraiHub 版本
- `src-tauri/Cargo.lock` 中的 MiraiHub 版本

手动推标签时，这些同步只发生在 GitHub 的临时构建目录，不会向 `master` 自动提交；使用 `pnpm release` 则会先在本地同步并提交版本文件。手动发版若希望本地源码也显示新版本，可先执行并提交：

```powershell
pnpm version:set v0.2.0
pnpm version:check
```

版本升级幅度由你决定：修复用修订版本、新功能用次版本、不兼容变化用主版本。`pnpm release` 在本地按所选幅度递增，GitHub 工作流使用推送的标签，不会再次递增。Windows 文件属性中的数值版本受系统格式限制；应用内和发行文件名保留完整的测试版后缀。

## 工作流与下载

推送标签后，在 **Actions → Release** 查看进度。流程依次运行版本校验、前端工具测试、Rust 测试、Vue 类型检查与生产构建、Tauri NSIS 打包。只有全部成功才进入发布任务。

发布任务检查 SHA-256、源码提交与远程标签，先准备草稿并上传所有附件，再公开 Release。正式版发布到仓库的 **Releases** 页面：

- `MiraiHub_0.2.0_windows_x64_setup.exe`：Windows x64 安装程序。
- `MiraiHub_0.2.0_windows_x64_portable.zip`：解压后运行 `miraihub.exe`；系统需有 WebView2 Runtime，用户数据仍保存在应用数据目录。
- `SHA256SUMS.txt`：下载文件的 SHA-256。
- `version.json`：版本、标签、源码 commit、平台与架构。

构建附件也会在该次 Actions 运行中保留 14 天；Release 附件不会因这个保留期自动删除。

```powershell
Get-FileHash .\MiraiHub_0.2.0_windows_x64_setup.exe -Algorithm SHA256
```

将输出与 `SHA256SUMS.txt` 的对应值比较。目前未配置代码签名证书，Windows 可能显示“未知发布者”；SHA-256 用于检查文件完整性，不代表代码签名。

## 失败重试

- 构建失败：在 Actions 查看报错。依赖下载等临时失败可用 **Re-run failed jobs** 重试。
- 标签已存在但未成功发布：也可在 **Actions → Release → Run workflow** 输入这个已推送的标签。工作流文件必须已上传到默认分支才能显示手动运行入口。
- 附件上传中断：Release 会保持草稿，重试会补齐并替换该草稿的同名附件。
- 已发布成功：工作流拒绝覆盖已公开的版本。修复代码后提交新 commit，推送新版本标签；不要移动旧标签。
- 发布出现 `403`：检查仓库或组织的 Actions 策略是否允许此工作流的 `contents: write` 权限。

请通过推送 Git 标签发版，让工作流负责创建 Release。不要提前手动发布同名 Release；已经公开的同名版本会被拒绝覆盖。

## 本地打包

```powershell
pnpm version:check
pnpm release:build
# 下例适用于源码版本为 0.2.0；使用与你本地版本一致的标签。
./scripts/package-windows.ps1 -Tag v0.2.0 -Commit (git rev-parse HEAD)
```

脚本需要 PowerShell 7，结果位于 `release-output`。如该目录已存在，先将它移动到其他位置再重新打包。归档仅收集编译产物，不会收集连接配置或用户文件。

当前工作流打包 Windows x64；应用内自动下载更新、macOS/Linux 构建和签名证书不在此工作流中。

实现参考：[Tauri GitHub 分发文档](https://v2.tauri.app/distribute/pipelines/github/)、[GitHub 标签推送事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)、[GitHub CLI Release](https://cli.github.com/manual/gh_release_create)。
