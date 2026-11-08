<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, toRefs, useTemplateRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { errorMessage, sendContextToMain } from '@/api/agent'
import { requestAgentContext } from '@/composables/useAgentContextBus'
import { useRemoteTextDocument } from '@/composables/useRemoteTextDocument'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import { toast } from '@/composables/useToast'
import { IS_TAURI } from '@/utils/window'
import OperationDialog from './OperationDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

/** 发给 AI 助手的正文上限（UTF-8 字节）：上下文总量限 64000 字节，这里给截断说明留出余量 */
const AGENT_CONTENT_BYTES = 60000
/** AI 上下文拒收的控制字符，与 useAgentDraft 的 addContext 校验保持一致 */
const AGENT_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu

const { t } = useI18n()
const props = defineProps<RemoteEditRequest & { standalone?: boolean }>()
const emit = defineEmits<{
  close: []
  status: [dirty: boolean, busy: boolean]
}>()
const {
  state,
  dirty,
  requestClose,
  confirmDiscard,
  save,
  overwriteRemote,
  reloadRemote,
  dismissConflict,
} = useRemoteTextDocument(
    props,
    !!props.standalone,
    () => emit('close'),
    (isDirty, isBusy) => emit('status', isDirty, isBusy)
  )
const {
  document: remote,
  draft,
  busy,
  error,
  message,
  discard,
  conflict,
} = toRefs(state)
const fileName = computed(() => props.path.split('/').pop() || t('远端文件'))
const input = useTemplateRef<HTMLTextAreaElement>('input')
// 取选中内容（没有选中时取全文），替换 AI 上下文拒收的控制字符，过长时按字节截断并在正文里注明。
function agentContent(): string {
  const el = input.value
  // 选区下标基于换行归一化后的 textarea.value，不能拿去切 draft。
  const selected = el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
  const text = (selected.trim() ? selected : state.draft).replace(
    AGENT_CONTROL_CHARS,
    '\uFFFD'
  )
  // encodeInto 写满缓冲区即停，read 是不会切开字符的 UTF-16 下标。
  const { read } = new TextEncoder().encodeInto(
    text,
    new Uint8Array(AGENT_CONTENT_BYTES)
  )
  if (read === text.length) return text
  const note = t(
    '（内容过长已截断，仅包含前 {value0} 个字符，共 {value1} 个字符）',
    {
      value0: read,
      value1: text.length,
    }
  )
  return `${text.slice(0, read)}\n\n${note}`
}
// 把文件内容交给 AI 助手：主 webview 直接投递，原生子窗口经事件转交主窗口，后者的结果由主窗口提示。
async function analyzeWithAgent(): Promise<void> {
  const ask = {
    sessionId: props.sessionId,
    intent: 'explain' as const,
    name: fileName.value,
    content: agentContent(),
  }
  if (!IS_TAURI || getCurrentWindow().label === 'main') {
    if (requestAgentContext(ask))
      toast.success(t('已添加到 AI 助手，关闭此窗口即可查看'))
    else toast.error(t('没有可用的 AI 助手，请先连接终端'))
    return
  }
  try {
    await sendContextToMain(ask)
    state.error = ''
    state.message = t('已发送到主窗口的 AI 助手')
  } catch (error) {
    state.error = errorMessage(error)
  }
}
defineExpose({ requestClose })
</script>

<template>
  <OperationDialog
    :title="fileName"
    wide
    :standalone="standalone"
    :busy="busy"
    @close="requestClose"
  >
    <div class="editor-bar">
      <span
        class="editor-name"
        :title="`${connectionName} · ${remote?.path || path}`"
      >
        {{ fileName
        }}<span
          v-if="dirty"
          aria-label="未保存"
        >
          *</span
        >
      </span>
      <span
        v-if="message"
        class="text-success"
        role="status"
        >{{ message }}</span
      >
      <AppButton
        size="sm"
        :title="t('发送选中内容给 AI 助手，未选中时发送整个文件')"
        :disabled="busy || !remote || !draft.trim()"
        @click="analyzeWithAgent"
      >
        <AppIcon
          name="lucide:sparkles"
          :size="12"
        />{{ t('让 AI 分析') }}
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        :title="t('保存') + ' (Ctrl+S)'"
        :disabled="!dirty || busy"
        @click="save()"
        >{{ t('保存') }}</AppButton
      >
    </div>
    <div
      v-if="conflict"
      role="alert"
      class="border-amber/40 bg-amber/10 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
    >
      <span class="text-txt min-w-0 flex-1">
        {{ t('远端文件已被修改。覆盖保存会丢弃远端的改动，重新加载会丢弃本地草稿。') }}
      </span>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="busy"
        @click="overwriteRemote"
        >{{ t('覆盖保存') }}</AppButton
      >
      <AppButton
        size="sm"
        :disabled="busy"
        @click="reloadRemote"
        >{{ t('重新加载') }}</AppButton
      >
      <AppButton
        size="sm"
        :disabled="busy"
        @click="dismissConflict"
        >{{ t('取消') }}</AppButton
      >
    </div>
    <p
      v-if="error"
      role="alert"
      class="editor-error"
    >
      {{ error }}
    </p>
    <textarea
      ref="input"
      v-model="draft"
      class="editor-input"
      :disabled="busy || !remote"
      spellcheck="false"
      :aria-label="t('远端文件内容')"
      :placeholder="busy ? t('正在读取远端文本…') : t('打开文件后即可编辑')"
    />
  </OperationDialog>
  <AppConfirmDialog
    :open="!!discard"
    :title="t('关闭未保存的文件？')"
    :description="t('当前修改尚未保存，关闭后将丢失。')"
    :confirm-label="t('放弃修改')"
    danger
    @close="discard = ''"
    @confirm="confirmDiscard"
  />
</template>

<style scoped>
.editor-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}
.editor-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.editor-error {
  color: var(--color-danger);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.editor-input {
  flex: 1;
  width: 100%;
  min-height: 0;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-txt);
  font: 12px/1.7 var(--font-mono);
  tab-size: 2;
  white-space: pre;
}
</style>
