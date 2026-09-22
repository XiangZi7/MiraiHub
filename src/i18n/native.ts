import { i18n, translateLabel } from './index'

/** Only localize known application messages; preserve external diagnostics and user content. */
export function translateNativeMessage(message: string): string {
  for (const [prefix, key] of [
    ['工具失败：', 'agent.toolFailed'],
    ['聊天记录尚未保存：', 'agent.historyUnsaved'],
    ['模型服务错误：', 'agent.providerError'],
  ] as const) {
    if (message.startsWith(prefix))
      return i18n.global.t(key, {
        error: translateLabel(message.slice(prefix.length)),
      })
  }
  return translateLabel(message)
}
