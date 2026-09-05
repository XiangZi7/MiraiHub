import { createPinia } from "pinia";

/** 每个 WebView 各自创建实例；跨窗口同步由各领域的 API 订阅负责。 */
export const pinia = createPinia();
