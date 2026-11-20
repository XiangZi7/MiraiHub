import {
  computed,
  markRaw,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import { useDebounceFn } from '@vueuse/core'
import * as ssh from '@/api/ssh'
import type { ShellSuggestion } from '@/types/ssh'
import {
  filterShellSuggestions,
  shellCompletionToken,
  type ShellCompletionToken,
} from '@/utils/shell-completion'

interface UseSshShellCompletionOptions {
  sessionId: Ref<string>
  inputLine: Ref<string>
  enabled: Ref<boolean>
}
interface CachedSuggestions {
  line: string
  token: ShellCompletionToken
  items: readonly ShellSuggestion[]
  expires: number
}

/** 管理当前行补全；前缀收窄时立即复用候选，远端查询防抖且不应用过期连接或目录的结果。 */
export function useSshShellCompletion(options: UseSshShellCompletionOptions) {
  // 响应式状态
  const state = reactive({
    // 属于当前输入行的只读候选
    suggestions: markRaw([]) as ShellSuggestion[],
    // 键盘当前选中的候选
    activeIndex: 0,
    // 是否正在刷新远端候选
    loading: false,
    // 当前 shell 的工作目录，优先使用 OSC 7 报告
    cwd: '',
    // 接受或取消后的输入行，继续输入前不自动重开
    dismissedLine: '',
    // 候选所属输入行，防止快速输入时接受上一行的内容
    resultLine: '',
  })
  const { suggestions, activeIndex, loading, cwd } = toRefs(state)
  const cache = new Map<string, CachedSuggestions>()
  let requestId = 0
  let cwdRequestId = 0
  let previousCwd = ''
  let disposed = false
  const open = computed(
    () =>
      options.enabled.value &&
      state.suggestions.length > 0 &&
      state.resultLine === options.inputLine.value &&
      state.dismissedLine !== options.inputLine.value
  )
  const activeSuggestion = computed(() => state.suggestions[state.activeIndex])

  /** 只在同一参数、同一目录及未过期的较短前缀间复用候选，不把另一条命令的结果混入。 */
  function cachedSuggestions(
    line: string,
    token: ShellCompletionToken
  ): ShellSuggestion[] | undefined {
    const now = Date.now()
    const exact = cache.get(line)
    if (exact && exact.expires > now) return [...exact.items]
    const directory = token.value.slice(0, token.value.lastIndexOf('/') + 1)
    for (const entry of [...cache.values()].reverse()) {
      if (
        entry.expires <= now ||
        entry.token.commandPosition !== token.commandPosition ||
        entry.token.home !== token.home ||
        entry.line.slice(0, entry.token.start) !== line.slice(0, token.start) ||
        entry.token.value.slice(0, entry.token.value.lastIndexOf('/') + 1) !==
          directory ||
        !token.value
          .toLocaleLowerCase()
          .startsWith(entry.token.value.toLocaleLowerCase())
      )
        continue
      return filterShellSuggestions(entry.items, token)
    }
  }

  /** 更新当前行候选时保留仍有效的选中项，列表键和弹层实例不会随每个按键重建。 */
  function display(items: ShellSuggestion[], line: string): void {
    const selected = state.suggestions[state.activeIndex]?.value
    state.suggestions = markRaw(items)
    state.resultLine = line
    state.activeIndex = Math.max(
      0,
      items.findIndex(item => item.value === selected)
    )
  }

  /** 查询当前输入快照；结果只缓存于原会话和原目录，迟到结果不能覆盖更新后的输入。 */
  async function fetchSuggestions(tokenId: number): Promise<void> {
    const id = options.sessionId.value
    const line = options.inputLine.value
    const directory = state.cwd
    const token = shellCompletionToken(line)
    if (
      disposed ||
      tokenId !== requestId ||
      !id ||
      !options.enabled.value ||
      !token ||
      state.dismissedLine === line
    )
      return
    state.loading = true
    try {
      const items = filterShellSuggestions(
        await ssh.completeShell(id, line, directory),
        token
      )
      if (disposed || id !== options.sessionId.value || directory !== state.cwd)
        return
      cache.delete(line)
      cache.set(line, {
        line,
        token,
        items: markRaw(items),
        expires: Date.now() + 2000,
      })
      if (cache.size > 64) cache.delete(cache.keys().next().value!)
      if (
        tokenId !== requestId ||
        line !== options.inputLine.value ||
        !options.enabled.value ||
        state.dismissedLine === line
      )
        return
      display(items, line)
    } catch {
      // 自动建议失败保留同一行的缓存候选，SSH 原生 Tab 补全仍可使用。
    } finally {
      if (tokenId === requestId) state.loading = false
    }
  }
  // 连续输入只刷新最新快照；未调用的旧任务也由 requestId 防止在关闭或卸载后执行。
  const requestSuggestions = useDebounceFn(fetchSuggestions, 100)

  /** 撤销当前候选和排队查询；缓存保留给下一次合法输入，不延续旧行的选中项。 */
  function clear(): void {
    requestId += 1
    state.suggestions = markRaw([])
    state.activeIndex = 0
    state.loading = false
    state.resultLine = ''
  }

  /** 接受或 Esc 取消后保持关闭，用户继续输入或主动请求补全才重新打开。 */
  function close(): void {
    state.dismissedLine = options.inputLine.value
    clear()
  }

  /** Ctrl+Space 主动重新查询当前参数，不需要先多输入一个字符才能补齐下一层目录。 */
  function request(): void {
    if (!options.enabled.value || !options.sessionId.value) return
    const line = options.inputLine.value
    const token = shellCompletionToken(line)
    if (!token) return
    state.dismissedLine = ''
    display(cachedSuggestions(line, token) ?? [], line)
    void fetchSuggestions(++requestId)
  }

  /** 在有效候选范围内循环移动键盘选中项。 */
  function move(step: 1 | -1): void {
    if (!state.suggestions.length) return
    state.activeIndex =
      (state.activeIndex + step + state.suggestions.length) %
      state.suggestions.length
  }

  /** 应用可信的 shell 工作目录快照；目录变化清空缓存，重复报告也使旧 cd 探测失效。 */
  function setWorkingDirectory(path: string): void {
    if (!path.startsWith('/') || /[\x00-\x1f\x7f]/u.test(path)) return
    cwdRequestId += 1
    if (path === state.cwd) return
    previousCwd = state.cwd
    cache.clear()
    state.cwd = path
  }

  /** 接受标准 OSC 7 的 file URL，复杂命令或失败 cd 后也能跟随实际 shell 目录。 */
  function updateWorkingDirectory(value: string): boolean {
    try {
      const url = new URL(value)
      if (url.protocol !== 'file:') return false
      const path = decodeURIComponent(url.pathname)
      if (!path.startsWith('/') || /[\x00-\x1f\x7f]/u.test(path)) return false
      setWorkingDirectory(path)
      return true
    } catch {
      return false
    }
  }

  /** 没有 shell integration 时跟随简单 cd；引用路径和 cd - 可用，复合表达式不猜测，迟到探测不串会话。 */
  async function trackSubmittedCommand(line: string): Promise<void> {
    const match = line.trim().match(/^cd(?:\s+(.+))?$/u)
    const id = options.sessionId.value
    if (!match || !id) return
    const argument = (match[1] ?? '').trim().replace(/^--(?:\s+|$)/u, '')
    let target = ''
    if (argument === '-') {
      if (!previousCwd) return
      target = previousCwd
    } else if (argument) {
      const token = shellCompletionToken(`cd ${argument}`)
      if (!token || token.start !== 3) return
      target =
        token.home || token.value.startsWith('/')
          ? token.value
          : state.cwd
            ? `${state.cwd.replace(/\/$/, '')}/${token.value}`
            : token.value
    }
    const revision = ++cwdRequestId
    try {
      const listing = await ssh.listDirectory(id, target)
      if (
        !disposed &&
        id === options.sessionId.value &&
        revision === cwdRequestId
      )
        setWorkingDirectory(listing.path)
    } catch {
      // 失败 cd 不改变目录；有 OSC 7 时由远端实际报告覆盖启发式结果。
    }
  }

  // 当前行变化立即筛选同目录缓存；只有没有精确缓存时才防抖刷新，不先清空可用候选。
  watch(
    [options.inputLine, options.enabled, () => state.cwd],
    ([line, enabled]) => {
      const token = shellCompletionToken(line)
      const revision = ++requestId
      state.loading = false
      if (
        !enabled ||
        !options.sessionId.value ||
        !token ||
        state.dismissedLine === line
      ) {
        display([], '')
        return
      }
      state.dismissedLine = ''
      display(cachedSuggestions(line, token) ?? [], line)
      if ((cache.get(line)?.expires ?? 0) <= Date.now())
        void requestSuggestions(revision)
    },
    { flush: 'sync' }
  )

  // 重连或切换连接时清空会话缓存与目录，初始目录响应不能覆盖之后的 shell 报告。
  watch(
    options.sessionId,
    async id => {
      clear()
      cache.clear()
      state.dismissedLine = ''
      state.cwd = ''
      previousCwd = ''
      const revision = ++cwdRequestId
      if (!id) return
      try {
        const listing = await ssh.listDirectory(id, '')
        if (
          !disposed &&
          id === options.sessionId.value &&
          revision === cwdRequestId
        )
          setWorkingDirectory(listing.path)
      } catch {
        // 补全不可用不影响终端连接与原生 shell 输入。
      }
    },
    { immediate: true, flush: 'sync' }
  )

  // 防抖任务和在途请求在卸载后只能自行结束，不再缓存或改变组件状态。
  onBeforeUnmount(() => {
    disposed = true
    cwdRequestId += 1
    cache.clear()
    clear()
  })

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
    request,
    updateWorkingDirectory,
    trackSubmittedCommand,
  }
}
