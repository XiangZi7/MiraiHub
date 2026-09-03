/**
 * 远端目录浏览。
 *
 * 维护当前路径与前进/后退历史 —— 文件管理器的基本交互，
 * 每个用它的组件各写一份历史栈没有意义。
 */

import { computed, reactive, toRefs, watch, type Ref } from 'vue'
import * as ssh from '@/api/ssh'
import type { SshRemoteFile } from '@/types/ssh'

export function useRemoteFiles(sessionId: Ref<string>) {
  // 响应式状态
  const state = reactive({
    // 当前目录的绝对路径
    path: '',
    entries: [] as SshRemoteFile[],
    loading: false,
    error: '',
    // 选中的文件路径
    selected: '',
    // 浏览历史与游标。前进/后退在同一个栈上移动游标，
    // 而不是维护 back/forward 两个栈 —— 后者在"回退几步再跳新目录"时容易出错
    history: [] as string[],
    cursor: -1,
  })

  const { path, entries, loading, error, selected } = toRefs(state)

  /** 目录在前、文件在后，各自按名称排序 —— 与主流文件管理器一致 */
  const sortedEntries = computed(() =>
    state.entries.slice().sort((a, b) => {
      const aDir = a.kind === 'directory'
      const bDir = b.kind === 'directory'

      if (aDir !== bDir)
        return aDir ? -1 : 1

      return a.name.localeCompare(b.name)
    }),
  )

  /** 路径面包屑。根目录返回空数组，模板里单独渲染那个 `/` */
  const breadcrumbs = computed(() => {
    const segments = state.path.split('/').filter(Boolean)

    return segments.map((name, index) => ({
      name,
      // 逐级拼出可点击的绝对路径
      path: `/${segments.slice(0, index + 1).join('/')}`,
    }))
  })

  const canGoBack = computed(() => state.cursor > 0)
  const canGoForward = computed(() => state.cursor < state.history.length - 1)

  /**
   * 列出目录。
   *
   * `record` 控制是否写入历史：前进/后退本身不该再产生新历史条目，
   * 否则按几次后退就再也回不到最前面了。
   */
  async function load(target: string, record = true): Promise<void> {
    if (!sessionId.value)
      return

    state.loading = true
    state.error = ''

    try {
      const listing = await ssh.listDirectory(sessionId.value, target)

      state.path = listing.path
      state.entries = listing.entries
      state.selected = ''

      if (record)
        pushHistory(listing.path)
    }
    catch (err) {
      state.error = ssh.errorMessage(err)
      // 保留原来的列表：进不去新目录时，让用户还能看到刚才那个，
      // 而不是连当前位置也一起清空
    }
    finally {
      state.loading = false
    }
  }

  /** 写入历史。从中间跳转时截掉后面的"未来"分支 */
  function pushHistory(target: string): void {
    if (state.history[state.cursor] === target)
      return

    state.history = [...state.history.slice(0, state.cursor + 1), target]
    state.cursor = state.history.length - 1
  }

  /** 进入某个目录项：目录就进去，软链跟着走，普通文件不处理 */
  async function enter(file: SshRemoteFile): Promise<void> {
    if (file.kind === 'directory' || file.kind === 'symlink')
      await load(file.path)
  }

  /** 上一级。已在根目录时无事发生 */
  async function goUp(): Promise<void> {
    if (state.path === '/' || !state.path)
      return

    const parent = state.path.replace(/\/[^/]+\/?$/, '') || '/'
    await load(parent)
  }

  async function goBack(): Promise<void> {
    if (!canGoBack.value)
      return

    state.cursor -= 1
    await load(state.history[state.cursor], false)
  }

  async function goForward(): Promise<void> {
    if (!canGoForward.value)
      return

    state.cursor += 1
    await load(state.history[state.cursor], false)
  }

  /** 重新列一次当前目录 */
  async function refresh(): Promise<void> {
    await load(state.path || '', false)
  }

  /** 会话变化时重置并回到家目录 */
  watch(
    sessionId,
    async (id) => {
      state.path = ''
      state.entries = []
      state.error = ''
      state.selected = ''
      state.history = []
      state.cursor = -1

      // 传空串让后端解析成家目录 —— 前端不该猜远端用户的 home 在哪
      if (id)
        await load('')
    },
    { immediate: true },
  )

  return {
    path,
    entries,
    sortedEntries,
    loading,
    error,
    selected,
    breadcrumbs,
    canGoBack,
    canGoForward,
    load,
    enter,
    goUp,
    goBack,
    goForward,
    refresh,
  }
}
