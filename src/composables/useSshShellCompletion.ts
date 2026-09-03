import { computed, onBeforeUnmount, reactive, toRefs, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import * as ssh from '@/api/ssh'
import type { ShellSuggestion } from '@/types/ssh'

interface UseSshShellCompletionOptions {
  sessionId: Ref<string>
  inputLine: Ref<string>
  enabled: Ref<boolean>
}

export function useSshShellCompletion(options: UseSshShellCompletionOptions) {
  const state = reactive({
    suggestions: [] as ShellSuggestion[],
    activeIndex: 0,
    loading: false,
    cwd: '',
    dismissedLine: '',
  })

  const { suggestions, activeIndex, loading, cwd } = toRefs(state)
  let requestId = 0

  const open = computed(() => (
    options.enabled.value
    && state.suggestions.length > 0
    && state.dismissedLine !== options.inputLine.value
  ))

  const activeSuggestion = computed(() => state.suggestions[state.activeIndex])

  const requestSuggestions = useDebounceFn(async () => {
    const id = options.sessionId.value
    const line = options.inputLine.value
    const token = currentToken(line)
    if (!id || !options.enabled.value || !token) {
      clear()
      return
    }

    const currentRequest = ++requestId
    state.loading = true

    try {
      const items = await ssh.completeShell(id, line, state.cwd)
      if (currentRequest !== requestId || id !== options.sessionId.value || line !== options.inputLine.value)
        return

      state.suggestions = items
      state.activeIndex = 0
      state.dismissedLine = ''
    }
    catch {
      if (currentRequest === requestId)
        state.suggestions = []
    }
    finally {
      if (currentRequest === requestId)
        state.loading = false
    }
  }, 140)

  function clear(): void {
    requestId += 1
    state.suggestions = []
    state.activeIndex = 0
    state.loading = false
  }

  function close(): void {
    state.dismissedLine = options.inputLine.value
  }

  function move(step: 1 | -1): void {
    if (!state.suggestions.length)
      return

    state.activeIndex = (state.activeIndex + step + state.suggestions.length) % state.suggestions.length
  }

  /** 跟随简单的 `cd path` 更新补全目录；复杂 shell 表达式仍交给远端 shell 自己处理。 */
  async function trackSubmittedCommand(line: string): Promise<void> {
    const match = line.trim().match(/^cd(?:\s+(.+))?$/)
    if (!match || !options.sessionId.value)
      return

    let target = (match[1] ?? '').trim()
    if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'")))
      target = target.slice(1, -1)

    if (target && !target.startsWith('/') && !target.startsWith('~'))
      target = state.cwd ? `${state.cwd.replace(/\/$/, '')}/${target}` : target

    try {
      const listing = await ssh.listDirectory(options.sessionId.value, target)
      state.cwd = listing.path
    }
    catch {
      // 与真正 shell 中失败的 cd 保持一致：补全目录继续沿用旧值。
    }
  }

  watch(
    [options.inputLine, options.enabled],
    ([line, enabled]) => {
      if (!enabled || !currentToken(line)) {
        clear()
        return
      }
      state.dismissedLine = ''
      void requestSuggestions()
    },
  )

  watch(options.sessionId, async (id) => {
    clear()
    state.cwd = ''
    if (!id)
      return

    try {
      const listing = await ssh.listDirectory(id, '')
      if (id === options.sessionId.value)
        state.cwd = listing.path
    }
    catch {
      // 补全不可用不影响终端本身连接。
    }
  }, { immediate: true })

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

function currentToken(line: string): string {
  if (/\s$/.test(line))
    return ''
  return line.match(/\S+$/)?.[0] ?? ''
}

