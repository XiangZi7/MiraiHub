# 界面语言

「设置 → 通用 → 界面语言」提供跟随系统、简体中文和 English，默认跟随系统。保存后同步到所有已打开的 WebView；取消不会改变语言偏好。

Rust 的 `get_system_locale` IPC 返回系统界面语言。Windows 使用 `GetUserDefaultUILanguage`，避免把区域日期格式当作显示语言。Vue 在挂载前读取结果并初始化 vue-i18n，中文区域变体统一使用 `zh-CN`，其他语言回退到 `en-US`。显式选择中文或英文时优先使用用户选择；跟随系统时，窗口重新获得焦点会重新读取系统语言。浏览器预览使用 `navigator.language`。

翻译资源位于 `src/i18n/en-US.ts` 和 `src/i18n/zh-CN.ts`。设置页面、主题预览、主要工作区导航和公共提示使用 vue-i18n；设置元数据在 computed 中翻译，以响应运行期间的语言变更。原生托盘菜单使用系统语言。连接名称、用户输入和服务器返回的数据保持原样。

`tests/i18n.test.mjs` 验证语言解析、回退、翻译键覆盖、动态切换及原生语言初始化。`tests/skin.test.mjs` 验证旧设置兼容与语言偏好的持久化。
