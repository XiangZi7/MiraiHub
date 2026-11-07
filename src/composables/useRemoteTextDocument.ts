import { i18n } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import * as api from '@/api/operations'
import { isAppError } from '@/api/ssh'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import { textMetrics } from '@/utils/text-metrics'

export function useRemoteTextDocument(
  request: RemoteEditRequest,
  standalone: boolean,
  onClose: () => void,
  onStatus: (dirty: boolean, busy: boolean) => void
) {
  // 响应式状态
  const state = reactive({
    // 最近一次从远端读取或保存的内容
    document: null as api.TextDocument | null,
    // 用户编辑的草稿，仅保留在当前窗口内存中
    draft: '',
    // 读取或保存期间锁定编辑操作
    busy: false,
    // 最近一次读写错误
    error: '',
    // 保存结果或窗口关闭提示
    message: '',
    // 待确认的放弃草稿动作
    discard: '' as '' | 'close',
    // 保存时发现远端文件已被他人修改，等待用户选择覆盖、重新加载或取消
    conflict: false,
  })

  const dirty = computed(
    () => !!state.document && state.draft !== state.document.text
  )
  let alive = true
  // 从远端读取文件内容，替换当前文档与草稿
  async function load(): Promise<void> {
    if (state.busy) return
    state.busy = true
    state.error = ''
    state.message = ''
    state.conflict = false
    try {
      const doc = await api.openText(request.sessionId, request.path)
      if (!alive) {
        void api.closeText(doc.id).catch(() => {})
        return
      }
      const previous = state.document
      state.document = doc
      state.draft = doc.text
      if (previous) void api.closeText(previous.id).catch(() => {})
    } catch (error) {
      if (alive) state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }
  // 保存草稿；force 为 true 时跳过远端变更检测直接覆盖
  async function save(force = false): Promise<void> {
    if (!dirty.value || !state.document || state.busy) return
    if (textMetrics(state.draft).bytes > 1024 * 1024) {
      state.error = i18n.global.t('草稿超过 1 MB，请缩短后再保存')
      return
    }
    const text = state.draft
    state.busy = true
    state.error = ''
    state.message = ''
    state.conflict = false
    try {
      const doc = await api.saveText(state.document.id, text, force)
      state.document = doc
      state.draft = doc.text
      state.message = i18n.global.t('已保存')
    } catch (error) {
      if (isAppError(error) && error.kind === 'conflict') state.conflict = true
      else state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }
  // 冲突时用户选择覆盖远端修改
  function overwriteRemote(): void {
    void save(true)
  }
  // 冲突时放弃本地草稿并重新读取远端内容
  function reloadRemote(): void {
    state.conflict = false
    void load()
  }
  // 关闭冲突提示，保留草稿稍后处理
  function dismissConflict(): void {
    state.conflict = false
  }
  function requestClose(): void {
    if (state.busy) {
      state.message = i18n.global.t('正在读取或保存，请稍后再关闭窗口。')
      return
    }
    if (!state.busy) {
      if (dirty.value) state.discard = 'close'
      else onClose()
    }
  }
  function confirmDiscard(): void {
    const action = state.discard
    state.discard = ''
    if (action === 'close') onClose()
  }
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      if (!state.discard && !state.conflict) void save()
    }
  })
  useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
    if (!standalone && (dirty.value || state.busy)) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  onMounted(() => {
    void load()
  })
  watch(
    () => [dirty.value, state.busy] as const,
    ([dirty, busy]) => onStatus(dirty, busy),
    { flush: 'sync' }
  )
  onBeforeUnmount(() => {
    alive = false
    if (state.document) void api.closeText(state.document.id).catch(() => {})
  })

  return {
    state,
    dirty,
    requestClose,
    confirmDiscard,
    save,
    overwriteRemote,
    reloadRemote,
    dismissConflict,
  }
}
