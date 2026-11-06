export interface AgentPrompt { id: string; name: string; content: string }
const KEY = 'miraihub.agent-prompts.v1'
export const DEFAULT_AGENT_PROMPTS: AgentPrompt[] = [
  { id: 'diagnose', name: '/排查', content: '请排查当前目标的问题，先收集只读信息，说明证据和可能原因，再给出修复步骤。' },
  { id: 'optimize', name: '/优化SQL', content: '请分析下面的 SQL 和表结构，先查看执行计划，再给出有依据的优化建议：\n' },
  { id: 'script', name: '/写脚本', content: '请根据下面的需求编写脚本，说明用法和影响，等待我明确要求后再执行：\n' },
  { id: 'explain', name: '/解释', content: '请解释下面的内容，结合当前目标给出具体示例：\n' },
]
/** 读取用户模板；无历史配置时使用默认斜杠命令。 */
export function listAgentPrompts(): AgentPrompt[] {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return DEFAULT_AGENT_PROMPTS.map(item => ({ ...item }))
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('Invalid prompt templates')
  return parsed.filter((item): item is AgentPrompt => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.content === 'string'))
}
/** 一次保存完整模板列表，失败时保持原配置，名称必须唯一且以斜杠开头。 */
export function saveAgentPrompts(items: AgentPrompt[]): void {
  const names = new Set<string>()
  if (items.length > 50) throw new Error('Maximum 50 templates')
  for (const item of items) {
    if (!/^\/[^\s/]{1,30}$/u.test(item.name) || names.has(item.name) || !item.content.trim() || item.content.length > 16000) throw new Error('Invalid or duplicate prompt template')
    names.add(item.name)
  }
  localStorage.setItem(KEY, JSON.stringify(items))
}
