import { i18n } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import * as api from '@/api/operations'
import { isAppError } from '@/api/ssh'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import { textMetrics } from '@/utils/text-metrics'
import { toast } from '@/composables/useToast'

/** 管理远端文本草稿、保存冲突与关闭确认，保存完成后才允许关闭编辑窗口。 */
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
    // 待确认的放弃草稿动作
    discard: '' as '' | 'close',
    // 用户选择保存并关闭，发生冲突时保留意图直到处理完成或取消。
    closeAfterSave: false,
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
  // 保存草稿；force 跳过远端变更检测，关闭意图仅在保存成功并解除忙碌状态后执行。
  async function save(force = false): Promise<void> {
    if (!dirty.value || !state.document || state.busy) return
    if (textMetrics(state.draft).bytes > 1024 * 1024) {
      state.closeAfterSave = false
      state.error = i18n.global.t('草稿超过 1 MB，请缩短后再保存')
      return
    }
    const text = state.draft
    state.busy = true
    state.error = ''
    state.conflict = false
    let saved = false
    try {
      const doc = await api.saveText(state.document.id, text, force)
      state.document = doc
      state.draft = doc.text
      saved = true
      toast.success(i18n.global.t('已保存'))
    } catch (error) {
      if (isAppError(error) && error.kind === 'conflict') state.conflict = true
      else {
        state.closeAfterSave = false
        state.error = api.errorMessage(error)
      }
    } finally {
      state.busy = false
    }
    if (saved && state.closeAfterSave) {
      state.closeAfterSave = false
      onClose()
    }
  }
  // 冲突时用户选择覆盖远端修改
  function overwriteRemote(): void {
    void save(true)
  }
  // 冲突时放弃本地草稿并重新读取远端内容
  function reloadRemote(): void {
    state.closeAfterSave = false
    state.conflict = false
    void load()
  }
  // 关闭冲突提示，保留草稿稍后处理
  function dismissConflict(): void {
    state.closeAfterSave = false
    state.conflict = false
  }
  // 关闭时只检查当前草稿；有改动则打开二次确认，读写期间保留窗口。
  function requestClose(): void {
    if (state.busy) {
      toast.info(i18n.global.t('正在读取或保存，请稍后再关闭窗口。'))
      return
    }
    if (dirty.value) state.discard = 'close'
    else onClose()
  }
  // 二次确认选择保存并关闭；写入失败保留草稿，冲突交给现有覆盖/重载流程处理。
  async function saveAndClose(): Promise<void> {
    if (state.discard !== 'close' || state.busy) return
    state.discard = ''
    if (!dirty.value) {
      onClose()
      return
    }
    state.closeAfterSave = true
    await save()
  }
  // 用户明确放弃草稿后关闭，不写入远端文件。
  function confirmDiscard(): void {
    if (state.busy) return
    const action = state.discard
    state.discard = ''
    state.closeAfterSave = false
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
    saveAndClose,
    save,
    overwriteRemote,
    reloadRemote,
    dismissConflict,
  }
}
