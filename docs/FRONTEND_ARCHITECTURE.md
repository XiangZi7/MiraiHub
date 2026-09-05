# 前端目录与状态约定

MiraiHub 每个 WebView 先安装 Pinia，再安装 Vue Router，等待首条路由就绪后挂载 App。主窗口布局挂载后才发送 `app_ready`，启动画面会等到首屏可以显示。

| 目录 | 职责 |
| --- | --- |
| `src/router` | 具名路由、懒加载、参数校验、原生窗口入口转换、窗口范围守卫 |
| `src/pages/workspace` | 服务器、数据库、SSH 密钥、最近连接页面 |
| `src/pages/windows` | 设置、连接配置、远端编辑器、启动窗口的页面入口 |
| `src/layouts` | 工作区标题栏、侧栏、标签栏、全局快捷键与 RouterView |
| `src/stores` | 当前 WebView 的共享应用状态、派生值和业务动作 |
| `src/components` | 页面内部的领域组件及可复用 UI，不负责解析浏览器地址 |
| `src/composables` | 会话生命周期、组件交互逻辑、按连接过滤以及 Store 的只读适配接口 |
| `src/api` | IPC、持久化和跨窗口订阅，不依赖路由组件 |

## 路由

使用 Hash History，打包后的静态资源与浏览器预览都支持刷新和直达，无需服务端重写规则。

| 路径 | 路由名 | 用途 |
| --- | --- | --- |
| `#/servers/:connectionId?` | `servers` | SSH / 本地终端，可直达指定连接 |
| `#/databases/:connectionId?` | `databases` | 数据库连接工作区 |
| `#/ssh-keys` | `ssh-keys` | SSH 密钥 |
| `#/recent` | `recent` | 最近连接 |
| `#/settings/:section` | `settings` | 如 `general`、`appearance`、`ai`、`backup` |
| `#/connection/:kind?connectionId=...` | `connection` | `ssh`、`local`、`database` 的新建/编辑窗口 |
| `#/remote-editor` | `remote-editor` | 原生远端编辑器，目标由 Rust 窗口注册表提供 |
| `#/splash` | `splash` | Vue 启动画面入口；桌面首次启动仍使用独立 `splash.html` |

侧栏使用 RouterLink；命令面板、连接标签使用 `useWorkspaceNavigation`。当前主视图只从 `route.meta.nav` 派生，不再保存第二份 `activeNav` 状态。连接 ID 会校验是否存在、协议类型是否匹配。无效路径回到当前窗口的默认页，设置的非法分类回到通用设置。

原来的 Rust URL，例如 `index.html?window=settings` 和 `?window=connection&type=database&connectionId=...`，由 `window-entry.ts` 统一兼容。桌面窗口范围以 Tauri 实际 label 为准；窗口创建后禁止通过路由跳转到其他窗口类型。URL 不包含密码、API Key、SSH 会话 ID 或远端编辑路径。前端守卫只是页面边界，真实权限检查仍在 Rust。

返回、前进会切换页面及活动连接。历史记录中的已关闭连接仍然存在于配置中时，再次前往该地址会重新打开它。关闭标签使用 `replace` 更新地址；重排标签不改变路由。

## 页面缓存与会话

工作区 RouterView 内使用 KeepAlive，以路由名作为缓存 key，最多对应四个工作区页面。不能改成 `fullPath` 或连接 ID，否则会重复创建连接实例。服务器与数据库页内部继续按连接 ID 渲染会话组件；只有关闭连接标签或关闭窗口才卸载这些组件。

路由导航激活已有标签时保持连接配置对象的身份，避免数据库的配置 watcher 因引用替换而重连。通过侧栏显式重新打开连接时才采用最新配置。设置页同一实例处理分类参数变化，常规设置草稿在分类切换中保留；AI API Key 继续只留在 AI 面板，离开该面板即清空。

终端实例、连接控制器、DOM 引用和函数不放进 Store。页面通过 `useWorkspaceControllers` 向布局注册操作，KeepAlive 停用时保留，真正卸载时注销，因此后台建表草稿仍参与关闭确认。SQL 草稿沿用现有按连接保存/恢复逻辑。

## Store 使用

当前 Store：`settings`、`connections`、`workspace`、`workspace-layout`、`transfers`、`notifications`、`command-presets`、`saved-queries`、`remote-editor`。

统一使用 Setup Store：`defineStore` + `reactive/ref/computed` + actions。组件直接使用 Store 时用 `storeToRefs` 解构响应式状态，actions 可以直接解构。旧的 `useSettings` / `useConnections` 等是薄适配层，不再持有模块单例状态。单个终端的 I/O、数据库执行、AI 运行及表单草稿仍由各自 composable/组件持有。

各 WebView 的 Pinia 实例独立。设置通过已有 storage / Tauri 事件同步，连接通过存储订阅同步；不要把 Pinia 当成跨原生窗口的共享内存。订阅和计时器随 Store scope 清理，不在模块导入时创建监听。工具函数使用显式 Pinia 实例，并在调用时才获取 Store。

不使用全局 Store 持久化插件。工作区仅持久化连接 ID 和活动 ID；通知不持久化；传输历史与已保存查询沿用各自的存储格式。原生凭据与 AI 审批不进入路由或新的持久化层。

## 校验

`pnpm test` 覆盖窗口入口兼容、路由守卫、历史导航、连接引用稳定、Store 隔离与订阅清理、KeepAlive 生命周期和已有标签操作。`pnpm build` 执行完整 Vue/TypeScript 检查及生产构建。

实现依据：[Vue Router 的 RouterView / KeepAlive 用法](https://router.vuejs.org/guide/advanced/router-view-slot.html)、[组件外使用 Pinia](https://pinia.vuejs.org/core-concepts/outside-component-usage.html)。
