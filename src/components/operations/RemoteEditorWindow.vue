<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
} from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import RemoteTextEditor from './RemoteTextEditor.vue'
import AppButton from '@/components/ui/AppButton.vue'
import * as api from '@/api/operations'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'

// 响应式状态
const state = reactive({
  // 当前原生窗口在 Rust 中绑定的目标，不从 URL 或本地存储读取
  target: null as RemoteEditRequest | null,
  // 初始化或原生窗口操作的错误
  error: '',
  // 正在释放编辑会话并关闭窗口
  closing: false,
})
const { target, error, closing } = toRefs(state)
const editor = useTemplateRef<InstanceType<typeof RemoteTextEditor>>('editor')
let alive = true
let unlisten: (() => void) | undefined
let statusQueue = Promise.resolve()
function updateStatus(dirty: boolean, busy: boolean): void {
  // Preserve update ordering when save and reload change state in quick succession.
  statusQueue = statusQueue
    .then(() => api.remoteEditorStatus(dirty, busy))
    .catch(error => {
      if (alive && !state.closing) state.error = api.errorMessage(error)
    })
}
async function finish(): Promise<void> {
  if (state.closing) return
  state.closing = true
  try {
    await statusQueue
    await api.finishRemoteEditor()
  } catch (error) {
    state.error = api.errorMessage(error)
    state.closing = false
  }
}
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
      state.error = api.errorMessage(error)
      updateStatus(false, false)
    }
  }
})
onBeforeUnmount(() => {
  alive = false
  unlisten?.()
})
</script>
<template>
  <main
    class="remote-editor-window"
    :aria-busy="closing"
  >
    <p
      v-if="error"
      role="alert"
      class="window-error"
    >
      {{ error }}
    </p>
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
      <p>{{ error ? '无法打开远端编辑窗口' : '正在打开远端编辑器…' }}</p>
      <AppButton
        :disabled="closing"
        @click="finish"
        >关闭窗口</AppButton
      >
    </div>
  </main>
</template>
<style scoped>
.remote-editor-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-window);
}
.remote-editor-window :deep(.operation-window) {
  flex: 1;
  min-height: 0;
}
.window-error {
  flex: none;
  max-height: 100px;
  overflow: auto;
  padding: 10px 18px;
  color: var(--color-danger);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.window-loading {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
}
</style>
