/// <reference types="vite/client" />

// 不要为 *.vue 声明兜底模块：那会覆盖 vue-tsc 解析出的真实 SFC 类型，
// 导致组件的具名导出（如 TabBar 的 TabItem）无法被引用。
