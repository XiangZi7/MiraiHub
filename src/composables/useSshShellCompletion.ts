import {
  computed,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import { useDebounceFn } from '@vueuse/core'
import * as ssh from '@/api/ssh'
import type { ShellSuggestion } from '@/types/ssh'

interface UseSshShellCompletionOptions {
  sessionId: Ref<string>
  inputLine: Ref<string>
  enabled: Ref<boolean>
}

/** 管理当前输入行的远端补全，接受或关闭后等待用户继续输入，避免子目录自动反复弹出。 */
export function useSshShellCompletion(options: UseSshShellCompletionOptions) {
  const state = reactive({
    suggestions: [] as ShellSuggestion[],
    activeIndex: 0,
    loading: false,
    cwd: '',
    dismissedLine: '',
    resultLine: '',
  })

  const { suggestions, activeIndex, loading, cwd } = toRefs(state)
  let requestId = 0

  const open = computed(
    () =>
      options.enabled.value &&
      state.suggestions.length > 0 &&
      state.resultLine === options.inputLine.value &&
      state.dismissedLine !== options.inputLine.value
  )

  const activeSuggestion = computed(() => state.suggestions[state.activeIndex])

  /** 输入停稳后查询候选，关闭弹层或切换输入、连接后丢弃排队和迟到的结果。 */
  const requestSuggestions = useDebounceFn(async () => {
    const id = options.sessionId.value
    const line = options.inputLine.value
    const token = currentToken(line)
    if (
      !id ||
      !options.enabled.value ||
      !token ||
      state.dismissedLine === line
    ) {
      clear()
      return
    }

    const currentRequest = ++requestId
    state.loading = true

    try {
      const items = await ssh.completeShell(id, line, state.cwd)
      if (
        currentRequest !== requestId ||
        id !== options.sessionId.value ||
        line !== options.inputLine.value ||
        !options.enabled.value ||
        state.dismissedLine === line
      )
        return

      state.suggestions = items
      state.resultLine = line
      state.activeIndex = 0
      state.dismissedLine = ''
    } catch {
      if (currentRequest === requestId) state.suggestions = []
    } finally {
      if (currentRequest === requestId) state.loading = false
    }
  }, 140)

  /** 清空旧候选并使在途请求失效，避免新输入仍能选中上一行的内容。 */
  function clear(): void {
    requestId += 1
    state.suggestions = []
    state.activeIndex = 0
    state.loading = false
    state.resultLine = ''
  }

  /** 记住接受或取消后的完整输入行，排队请求也不能重新打开这一行的弹层。 */
  function close(): void {
    state.dismissedLine = options.inputLine.value
    clear()
  }

  /** 仅在当前候选范围内循环移动键盘选中项。 */
  function move(step: 1 | -1): void {
    if (!state.suggestions.length) return

    state.activeIndex =
      (state.activeIndex + step + state.suggestions.length) %
      state.suggestions.length
  }

  /** 跟随简单的 `cd path` 更新补全目录；复杂 shell 表达式仍交给远端 shell 自己处理。 */
  async function trackSubmittedCommand(line: string): Promise<void> {
    const match = line.trim().match(/^cd(?:\s+(.+))?$/)
    if (!match || !options.sessionId.value) return

    let target = (match[1] ?? '').trim()
    if (
      (target.startsWith('"') && target.endsWith('"')) ||
      (target.startsWith("'") && target.endsWith("'"))
    )
      target = target.slice(1, -1)

    if (target && !target.startsWith('/') && !target.startsWith('~'))
      target = state.cwd ? `${state.cwd.replace(/\/$/, '')}/${target}` : target

    try {
      const listing = await ssh.listDirectory(options.sessionId.value, target)
      state.cwd = listing.path
    } catch {
      // 与真正 shell 中失败的 cd 保持一致：补全目录继续沿用旧值。
    }
  }

  // 输入一变就撤销旧候选；接受目录后由 close 标记新行，只有继续键入才重新查询。
  watch(
    [options.inputLine, options.enabled],
    ([line, enabled]) => {
      clear()
      if (!enabled || !currentToken(line) || state.dismissedLine === line)
        return
      state.dismissedLine = ''
      void requestSuggestions()
    },
    { flush: 'sync' }
  )

  watch(
    options.sessionId,
    async id => {
      clear()
      state.dismissedLine = ''
      state.cwd = ''
      if (!id) return

      try {
        const listing = await ssh.listDirectory(id, '')
        if (id === options.sessionId.value) state.cwd = listing.path
      } catch {
        // 补全不可用不影响终端本身连接。
      }
    },
    { immediate: true }
  )

  onBeforeUnmount(clear)

  return {
    suggestions,
    activeIndex,
    activeSuggestion,
    loading,
    cwd,
    open,
    close,
    move,
    clear,
    trackSubmittedCommand,
  }
}

/** 仅补全光标末尾的非空 token，结尾空格表示用户已经结束当前参数。 */
function currentToken(line: string): string {
  if (/\s$/.test(line)) return ''
  return line.match(/\S+$/)?.[0] ?? ''
}
