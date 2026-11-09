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

## 自动生成更新日志

每次发版都会从 Git commit 自动生成中文 Release 日志，直接推送到分支的提交也会展示，无需创建 PR 或手写日志：

- 按新增功能、问题修复、优化改进、文档更新、构建与维护、其他更新分组，空分类不显示。
- 兼容现有的 `✨ feat(...)`、`🐛 fix(...)`、`♻️ refactor(...)` 等标题；展示修改范围、标题、提交正文和可点击的 commit 链接。普通提交标题也会保留。
- 自动过滤 `chore(release): vX.Y.Z` 版本提交及合并提交，保留合并分支中的实际改动。
- 对比当前历史中版本号最高的已公开 Release；失败标签和草稿不会截断更新范围。正式版对比上一个正式版，预发布版可对比上一个预发布版。首次发布列出完整历史。
- 日志先展示更新内容，再展示下载说明和完整版本对比链接；重试草稿发布时也会重新生成日志。

提交标题用于快速概览，正文用于说明细节。继续照常提交即可，例如：

```text
✨ feat(ssh): 新增 SSH 配置导入

- 支持从本机 SSH config 导入连接
- 保留原有连接配置
```

日志生成使用工作流提供的 GitHub Token 查询已发布版本，不需要额外配置 Secret。此流程在包含上述脚本与工作流的新标签中生效；已公开的历史 Release 不会自动改写。

## 首次上传

当前仓库的远程地址为 `https://github.com/XiangZi7/MiraiHub.git`，开发分支为 `master`。

1. 在 GitHub 仓库的 Actions 页面确认工作流已启用。上传 Release 使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需个人 Token；构建自动更新包需要按下节配置一次签名 Secret。
2. 检查本地改动，将准备发布的源码、锁文件、`scripts`、`tests` 和 `.github/workflows/release.yml` 一起提交。不要上传本地连接备份、SSH 私钥或 AI API Key。`node_modules`、`dist`、Rust `target` 和 `release-output` 已被忽略。
3. 提交后运行一键发版命令；它会一并上传当前分支并创建新版本标签。

```powershell
git status
# 使用编辑器的源代码管理界面选择需要上传的文件并暂存；也可逐个 git add。
git commit -m "chore: prepare release"
pnpm release
```

如果你克隆到了另一仓库，先通过 `git remote -v` 确认 `origin`，再推送。工作流从 GitHub 上下文读取仓库名，不写死发布目标。

## 自动更新：首次配置

应用的 Windows x64 安装版默认在启动 15 秒后、此后每 6 小时检查 GitHub 最新正式版。发现新版后自动下载，Tauri 使用内置公钥验证安装包签名。下载完成后每 10 秒检查是否可以安装：所有连接标签已关闭、没有排队/运行/暂停的文件传输、没有可见的设置/连接/编辑窗口，也没有未保存的远端编辑内容。满足条件便自动启动安装器，显示进度，完成后重新打开应用。

检查失败时按 1 分钟、5 分钟、15 分钟重试，连续失败后回到 6 小时间隔；联网恢复或重新开启自动更新会立即重试检查。下载、签名校验和安装失败保持 6 小时检查间隔，也可手动重试；每次重新获取并校验安装包，校验失败绝不安装。更新请求支持系统代理，保持 HTTPS 和签名校验。主窗口提示可通过右上角关闭；同类检查失败的重试不会重新弹出，新的下载、下载就绪或安装状态会再次提示，完整状态始终可在“设置 → 关于”查看。

“设置 → 关于”可以关闭自动更新、手动检查下载、查看进度或重试。下载就绪时，关于页与主窗口提示都显示“立即更新”和“暂不更新”。“立即更新”直接安装已经下载并校验的安装包，不要求提前关闭连接标签或其他窗口，关闭自动更新后也可使用。“暂不更新”暂停本次自动安装并收起主窗口提示，之后可在关于页选择“立即更新”。安装版的连接配置与用户数据保存在原应用数据目录，更新不删除它们。

更新地址为 `https://github.com/XiangZi7/MiraiHub/releases/latest/download/latest.json`。预发布版本不替换 Latest，不会推送给正式版用户。开发模式、其他平台和免安装版不运行自动更新；免安装版从 Releases 下载新 ZIP 后手动替换。

本次接入已生成公钥并写入 `src-tauri/tauri.conf.json`。私钥保存在本机 `.tauri/updater.key`，这个目录已被 Git 忽略；请另行备份，不能提交到仓库或附加到 Release。

1. 打开 [仓库 Actions Secrets](https://github.com/XiangZi7/MiraiHub/settings/secrets/actions)，新建 **Repository secret**：名称为 `TAURI_SIGNING_PRIVATE_KEY`，值为本机 `.tauri/updater.key` 文件的完整内容。
2. 当前生成的私钥没有密码，无需添加密码 Secret；如果使用加密私钥，再设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
3. 提交本次源码和公钥配置，然后照常运行 `pnpm release`。Actions 会生成安装包、`.sig` 和 `latest.json`，校验并一起发布。

其他开发机请恢复原私钥，或通过环境变量 `TAURI_SIGNING_PRIVATE_KEY` 提供密钥内容/文件路径。本地 `pnpm release:build` 会优先使用环境变量，再读取 `.tauri/updater.key`。`pnpm updater:setup` 可以检查本机公钥对应关系；已有公钥但缺失私钥时会拒绝生成新密钥，防止破坏现有客户端的信任关系。只有尚未配置过公钥的新项目才会生成密钥。

签名私钥必须长期保留，后续所有版本使用同一把密钥。Tauri 更新签名与 Windows Authenticode 代码签名是两个独立机制。若 fork 到其他仓库，请同时修改应用配置中的更新地址；附件下载地址由 Actions 的实际仓库名生成。

**已有旧客户端没有更新器，首次仍需手动安装一次带此功能的版本；之后才会自动升级。** 首个新版本自身和以后每个版本都必须携带上述三个更新附件。仅 `version.json` 和 SHA-256 文件不足以触发自动更新。

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

## 构建提速与缓存

推送代码到 `master` 时，**Actions → Release** 会提前运行前端测试、类型检查、Rust 测试和不带安装包的生产编译，把 pnpm 依赖和 Rust 测试 / 发布依赖缓存保存在默认分支。仅修改 Markdown、`docs/` 或 `LICENSE` 不触发预热；同一分支有新的推送时，会取消尚未完成的旧构建。预热不需要签名私钥，也不会发布 Release。

GitHub 的缓存按分支和标签隔离：不同版本标签不能直接读取彼此的缓存，但都能读取默认分支的缓存。因此只在 `v*` 标签上保存缓存，下一次发版仍可能重新编译大量 Rust 依赖。此流程复用同一个 Windows 环境、Rust 版本和构建任务，让标签构建能够读取 `master` 已保存的依赖缓存。主分支需要继续作为 GitHub 默认分支；若修改默认分支名，也要同步调整工作流的 `push.branches`。

想让下一次发版复用缓存，先推送源码到 `master`，等该分支的 **Release** 工作流成功完成，再运行 `pnpm release`。也可以在 **Actions → Release → Run workflow** 选择 `master`，将 `tag` 留空，手动预热。源码分支与版本标签同时推送时，两个任务可能同时启动，新标签只能使用当时已经保存的缓存，不会等待本次预热。

首次预热、Rust 工具链变更、依赖变更或缓存被回收时，仍可能需要较长时间。命中缓存后仍会重新编译 MiraiHub 自身，并执行测试、链接、安装包压缩及签名，实际提速以 Actions 各步骤耗时为准。正式发版继续使用 `pnpm release`；手动填写版本标签则构建并发布该标签对应的版本。

缓存隔离规则见 [GitHub 缓存访问限制](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)。

## 工作流与下载

推送标签后，在 **Actions → Release** 查看进度。流程依次运行版本校验、前端工具测试、Rust 测试、Vue 类型检查与生产构建、Tauri NSIS 打包。只有全部成功才进入发布任务。

发布任务检查 SHA-256、源码提交与远程标签，先准备草稿并上传所有附件，再公开 Release。正式版发布到仓库的 **Releases** 页面：

- `MiraiHub_0.2.0_windows_x64_setup.exe`：Windows x64 安装程序。
- `MiraiHub_0.2.0_windows_x64_portable.zip`：解压后运行 `miraihub.exe`；系统需有 WebView2 Runtime，用户数据仍保存在应用数据目录。
- `SHA256SUMS.txt`：下载文件的 SHA-256。
- `version.json`：版本、标签、源码 commit、平台与架构。
- `MiraiHub_0.2.0_windows_x64_setup.exe.sig`：安装包的更新签名。
- `latest.json`：供应用检查的版本、Windows x64 下载地址及签名。

构建附件也会在该次 Actions 运行中保留 14 天；Release 附件不会因这个保留期自动删除。

```powershell
Get-FileHash .\MiraiHub_0.2.0_windows_x64_setup.exe -Algorithm SHA256
```

将输出与 `SHA256SUMS.txt` 的对应值比较。目前未配置代码签名证书，Windows 可能显示“未知发布者”；SHA-256 用于检查文件完整性，不代表代码签名。

## 失败重试

- 编译成功后下载 `nsis_tauri_utils.dll` / NSIS 时出现 `http status: 504`：这是安装包工具下载的网关超时，不是 Rust 编译错误。`pnpm release:build` 先执行 `tauri build --no-bundle -- --locked`，再单独执行 `tauri bundle --bundles nsis`；打包遇到 408 / 425 / 429 / 5xx、超时或连接中断时最多尝试 3 次，分别等待 10 秒、20 秒，重试不重新编译。配置、签名和校验失败等错误直接中止。Actions 额外缓存 `%LOCALAPPDATA%\tauri` 中的打包工具，并在任务失败后保存 Rust 依赖缓存；上游持续不可用时仍会报错，可稍后重跑。使用新的脚本重试逻辑，需要发布包含此修复的新版本标签；手动运行旧标签仍会检出旧的打包脚本。
- 提示 `the --slurp option is not supported with --jq or --template`：读取已发布版本列表的 CLI 参数冲突。工作流已改为 `gh api --paginate --slurp ... | jq ...`，由独立的 `jq` 合并分页并提取日志所需字段。提交修复到默认分支后，从 **Actions → Release → Run workflow** 选择默认分支并输入尚未公开的原标签（例如 `v4.0.0`）；直接重跑旧记录仍使用原事件的提交和工作流。若版本已公开，请发布新的补丁标签，不移动旧标签。
- `Could not fetch a valid release JSON from the remote`：更新接口没有返回成功状态，不等同于本机断网。确认 GitHub **Latest 正式版**的附件中有 `latest.json`；旧版缺少清单或发布尚未完成时可能出现。清单恢复后应用会按上述间隔重试，也可手动点“重试”。可运行 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib updater::tests::published_update_manifest_is_accessible -- --ignored --exact`，使用应用的 Rust HTTP 栈检查已发布清单和安装包地址（不会下载安装）。
- 提示 `Configure the TAURI_SIGNING_PRIVATE_KEY repository secret`：到仓库 **Settings → Secrets and variables → Actions → Repository secrets** 配置 `TAURI_SIGNING_PRIVATE_KEY`，值为原签名私钥文件的完整内容，不是文件路径或公钥。只补齐 Secret 时，可直接重跑失败任务，无需修改源码或重新生成密钥。
- 提示 updater 版本不匹配：`@tauri-apps/plugin-updater` 和 Rust `tauri-plugin-updater` 必须使用相同的主、次版本；当前两端限定为 `2.10.x`，升级时一起调整并更新锁文件。若失败标签已包含错误依赖，修复后发布新的补丁版本；重跑旧标签仍会检出旧依赖。本地签名打包使用 `pnpm release:build`，它会自动读取本机私钥。
- 构建失败：在 Actions 查看报错。依赖下载等临时失败可用 **Re-run failed jobs** 重试。
- 标签已存在但未成功发布：也可在 **Actions → Release → Run workflow** 输入这个已推送的标签。工作流文件必须已上传到默认分支才能显示手动运行入口。
- 附件上传中断：Release 会保持草稿，重试会补齐并替换该草稿的同名附件。
- 已发布成功：工作流拒绝覆盖已公开的版本。修复代码后提交新 commit，推送新版本标签；不要移动旧标签。
- 发布出现 `403`：检查仓库或组织的 Actions 策略是否允许此工作流的 `contents: write` 权限。

请通过推送 Git 标签发版，让工作流负责创建 Release。不要提前手动发布同名 Release；已经公开的同名版本会被拒绝覆盖。

## 本地打包

Windows 安装信息位于 `src-tauri/tauri.conf.json` 的 `bundle` 配置中：默认仅构建 NSIS 安装包，发布者为 `XiangZi`，使用 MiraiHub 的主页、描述与现有应用图标。安装器和卸载器均使用 `src-tauri/icons/icon.ico`，开始菜单快捷方式位于 `MiraiHub` 文件夹。

安装面向当前用户，提供简体中文 / English 语言选择，禁止覆盖安装到更低版本。缺少 WebView2 Runtime 时会联网下载引导程序并静默安装。`src-tauri/windows/installer-hooks.nsh` 补充 Windows 卸载项中的应用描述、Issues 反馈链接和最新版本下载链接。

```powershell
pnpm version:check
pnpm release:build
# 下例适用于源码版本为 0.2.0；使用与你本地版本一致的标签。
./scripts/package-windows.ps1 -Tag v0.2.0 -Commit (git rev-parse HEAD)
```

脚本需要 PowerShell 7，结果位于 `release-output`。如该目录已存在，先将它移动到其他位置再重新打包。归档仅收集编译产物，不会收集连接配置或用户文件。

当前工作流打包 Windows x64 并发布签名自动更新附件；macOS/Linux 构建和 Windows 代码签名证书暂未配置。

实现参考：[Tauri GitHub 分发文档](https://v2.tauri.app/distribute/pipelines/github/)、[GitHub 标签推送事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)、[GitHub CLI Release](https://cli.github.com/manual/gh_release_create)。
