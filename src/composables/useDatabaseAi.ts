import { getCurrentScope, inject, onScopeDispose, reactive, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import * as agent from '@/api/agent'
import type { SqlAssistInput, SqlAssistResult } from '@/types/agent'
import { EXPLAIN_AGENT_TARGET } from '@/utils/explain-plan'

/** 本次运行累计的内联补全用量，编辑器角标读取这里。 */
export const sqlAiUsage = reactive({ inlineRequests: 0, inlineTokens: 0 })

/** 兼容 OpenAI / Responses / Anthropic 三种用量字段，取总 token 数。 */
function usageTokens(usage: Record<string, unknown> | null): number {
  if (!usage) return 0
  const total = Number(usage.total_tokens)
  if (Number.isFinite(total) && total > 0) return total
  return (
    (Number(usage.prompt_tokens ?? usage.input_tokens) || 0) +
    (Number(usage.completion_tokens ?? usage.output_tokens) || 0)
  )
}

/**
 * 发起可中止的一次性 SQL AI 请求；新请求会中止旧请求，迟到的响应会被丢弃。
 * 目标由 DatabaseView 通过 EXPLAIN_AGENT_TARGET 注入，因此必须在 setup 中调用。
 */
export function useDatabaseAi() {
  const { locale } = useI18n()
  const target = inject(EXPLAIN_AGENT_TARGET, undefined)
  const text = shallowRef('')
  const loading = shallowRef(false)
  const tokens = shallowRef(0)
  let activeId = ''

  /** 中止进行中的请求；关闭浮层、用户继续输入或组件卸载时调用。 */
  function cancel(): void {
    if (!activeId) return
    const id = activeId
    activeId = ''
    loading.value = false
    void agent.cancelSqlAssist(id).catch(() => {})
  }

  /** 发送请求并流式更新 text；被中止时返回 null，失败时抛给调用方提示。 */
  async function run(
    input: Omit<SqlAssistInput, 'language'>
  ): Promise<SqlAssistResult | null> {
    cancel()
    const current = target?.value
    if (!current?.sessionId) throw new Error('database session unavailable')
    const id = crypto.randomUUID()
    activeId = id
    text.value = ''
    tokens.value = 0
    loading.value = true
    try {
      const result = await agent.sqlAssist(
        current,
        id,
        {
          ...input,
          language: locale.value.startsWith('zh')
            ? 'Simplified Chinese'
            : 'English',
        },
        value => {
          if (id === activeId) text.value = value
        }
      )
      if (id !== activeId) return null
      text.value = result.text
      tokens.value = usageTokens(result.usage)
      if (input.mode === 'inline') {
        sqlAiUsage.inlineRequests++
        sqlAiUsage.inlineTokens += tokens.value
      }
      return result
    } catch (error) {
      if (id !== activeId) return null
      throw error
    } finally {
      if (id === activeId) {
        activeId = ''
        loading.value = false
      }
    }
  }

  if (getCurrentScope()) onScopeDispose(cancel)
  return { text, loading, tokens, run, cancel }
}
