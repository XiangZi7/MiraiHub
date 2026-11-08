import { i18n, translateLabel } from './index'

/** SSH 后端带参数的消息：只翻译固定文字，主机、路径与服务端原文保持不变；更具体的规则放前面 */
const SSH_PATTERNS: [RegExp, string][] = [
  [/^认证失败：服务器拒绝了 (.+) 方式$/, '认证失败：服务器拒绝了 {value0} 方式'],
  [/^认证失败：(.+)$/s, '认证失败：{value0}'],
  [/^远端关闭连接：(.+)$/s, '远端关闭连接：{value0}'],
  [/^网络错误：(.+)$/s, '网络错误：{value0}'],
  [/^连接异常：(.+)$/s, '连接异常：{value0}'],
  [/^经代理 (.+?) 连接失败：(.+)$/s, '经代理 {value0} 连接失败：{value1}'],
  [/^连接 (.+?) 失败：(.+)$/s, '连接 {value0} 失败：{value1}'],
  [/^连接 (.+?) 超时（(\d+)s）$/, '连接 {value0} 超时（{value1}s）'],
  [/^会话 (.+) 不存在或已断开$/, '会话 {value0} 不存在或已断开'],
  [/^已拒绝 (.+) 的主机密钥，连接已取消$/, '已拒绝 {value0} 的主机密钥，连接已取消'],
  [
    /^(.+) 的主机密钥与 known_hosts 记录不一致，已拒绝连接$/,
    '{value0} 的主机密钥与 known_hosts 记录不一致，已拒绝连接',
  ],
  [/^(\d+) 秒内未确认$/, '{value0} 秒内未确认'],
]

/** Only localize known application messages; preserve external diagnostics and user content. */
export function translateNativeMessage(message: string): string {
  for (const [prefix, key] of [
    ['工具失败：', 'agent.toolFailed'],
    ['聊天记录尚未保存：', 'agent.historyUnsaved'],
    ['模型服务错误：', 'agent.providerError'],
  ] as const) {
    if (message.startsWith(prefix))
      return i18n.global.t(key, { error: translateLabel(message.slice(prefix.length)) })
  }
  // 完整命中已有词条时优先整句翻译；否则按 SSH 模板只翻固定文字，捕获的原因部分递归再翻一层
  if (i18n.global.te(message)) return translateLabel(message)
  for (const [pattern, key] of SSH_PATTERNS) {
    const match = pattern.exec(message)
    if (match)
      return i18n.global.t(
        key,
        Object.fromEntries(
          match.slice(1).map((value, index) => [`value${index}`, translateNativeMessage(value)])
        )
      )
  }
  return message
}
