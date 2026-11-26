<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
} from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import RemoteTextEditor from '@/components/operations/RemoteTextEditor.vue'
import AppButton from '@/components/ui/AppButton.vue'
import DocumentWindowFrame from '@/components/ui/DocumentWindowFrame.vue'
import * as api from '@/api/operations'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import { toast } from '@/composables/useToast'

const { t } = useI18n()

// 响应式状态
const state = reactive({
  // 当前原生窗口在 Rust 中绑定的目标，不从 URL 或本地存储读取
  target: null as RemoteEditRequest | null,
  // 初始化失败时显示失败状态，异常详情统一交给公共通知。
  loadFailed: false,
  // 正在释放编辑会话并关闭窗口
  closing: false,
  // 编辑器上报的未保存与忙碌状态，驱动标题栏圆点与保存按钮
  dirty: false,
  busy: false,
})
const { target, loadFailed, closing, dirty, busy } = toRefs(state)
const fileName = computed(
  () => state.target?.path.split('/').pop() || t('远端文件')
)
/** 文件所在目录，标题栏里弱化展示，给文件名作上下文 */
const dirPath = computed(() => {
  const path = state.target?.path || ''
  const dir = path
    .slice(0, path.length - fileName.value.length)
    .replace(/\/$/, '')
  return dir || '/'
})
const editor = useTemplateRef<InstanceType<typeof RemoteTextEditor>>('editor')
let alive = true
let unlisten: (() => void) | undefined
let statusQueue = Promise.resolve()
/** 按发生顺序向原生窗口同步未保存与忙碌状态，避免连续保存和重载覆盖关闭保护。 */
function updateStatus(dirty: boolean, busy: boolean): void {
  state.dirty = dirty
  state.busy = busy
  statusQueue = statusQueue
    .then(() => api.remoteEditorStatus(dirty, busy))
    .catch(error => {
      if (alive && !state.closing)
        toast.error({
          title: t('操作失败'),
          description: api.errorMessage(error),
        })
    })
}
/** 等待状态同步后释放远端编辑会话并关闭窗口；失败时允许用户再次关闭。 */
async function finish(): Promise<void> {
  if (state.closing) return
  state.closing = true
  try {
    await statusQueue
    await api.finishRemoteEditor()
  } catch (error) {
    state.closing = false
    toast.error({ title: t('操作失败'), description: api.errorMessage(error) })
  }
}
// 挂载时订阅原生关闭请求，再读取编辑目标；卸载后的异步结果不再回写状态。
onMounted(async () => {
  try {
    const stop = await getCurrentWindow().listen(
      'remote-editor-close-requested',
      () => {
        if (state.closing) return
        if (editor.value) editor.value.requestClose()
        else void finish()
      }
    )
    if (!alive) {
      stop()
      return
    }
    unlisten = stop
    const target = await api.remoteEditorTarget()
    if (alive && !state.closing) state.target = target
  } catch (error) {
    if (alive) {
      state.loadFailed = true
      toast.error({
        title: t('无法打开远端编辑窗口'),
        description: api.errorMessage(error),
      })
      updateStatus(false, false)
    }
  }
})
// 卸载后停止原生窗口订阅，并阻止未完成的初始化继续更新页面。
onBeforeUnmount(() => {
  alive = false
  unlisten?.()
})
</script>
<template>
  <DocumentWindowFrame
    :title="fileName"
    :meta="target ? dirPath + ' · ' + target.connectionName : undefined"
    :aria-busy="closing"
    :dirty="dirty"
  >
    <template #actions>
      <!-- 保存沿用当前文档的冲突和关闭保护。 -->
      <AppButton
        v-if="target"
        size="sm"
        variant="bare"
        :disabled="!dirty || busy || closing"
        @click="editor?.save()"
      >
        {{ t('保存') }}
      </AppButton>
    </template>
    <!-- 编辑器主体：CodeMirror 文档、行号与状态栏。 -->
    <RemoteTextEditor
      v-if="target"
      ref="editor"
      v-bind="target"
      standalone
      @close="finish"
      @status="updateStatus"
    />
    <div
      v-else
      class="window-loading"
    >
      <p>
        {{ loadFailed ? t('无法打开远端编辑窗口') : t('正在打开远端编辑器…') }}
      </p>
      <AppButton
        :disabled="closing"
        @click="finish"
      >
        {{ t('关闭窗口') }}
      </AppButton>
    </div>
  </DocumentWindowFrame>
</template>
<style scoped>
.window-loading {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
}
</style>
