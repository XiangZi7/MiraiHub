<script setup lang="ts">
import { toRefs } from 'vue'
import { useRemoteTextDocument } from '@/composables/useRemoteTextDocument'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import OperationDialog from './OperationDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
const props = defineProps<RemoteEditRequest & { standalone?: boolean }>()
const emit = defineEmits<{
  close: []
  status: [dirty: boolean, busy: boolean]
}>()
const {
  state,
  dirty,
  lines,
  bytes,
  requestClose,
  requestReload,
  confirmDiscard,
  review,
  save,
  copyDraft,
} = useRemoteTextDocument(
  props,
  !!props.standalone,
  () => emit('close'),
  (dirty, busy) => emit('status', dirty, busy)
)
const {
  document: remote,
  draft,
  busy,
  error,
  message,
  reviewing,
  reviewedText,
  discard,
} = toRefs(state)
defineExpose({ requestClose })
</script>
<template>
  <OperationDialog
    title="远端文本编辑器"
    wide
    :standalone="standalone"
    :busy="busy"
    @close="requestClose"
  >
    <div class="editor-target">
      <strong>{{ remote?.endpoint || connectionName }}</strong
      ><code>{{ remote?.path || path }}</code>
    </div>
    <div class="editor-toolbar">
      <span
        >{{
          busy ? '处理中' : !remote ? '未加载' : dirty ? '未保存' : '已同步'
        }}
        · UTF-8{{ remote?.bom ? ' BOM' : '' }} ·
        {{ remote?.lineEnding || 'LF' }} · {{ lines }} 行 ·
        {{ (bytes / 1024).toFixed(1) }} KB</span
      >
      <div class="flex-1" />
      <AppButton
        size="sm"
        :disabled="busy || reviewing"
        @click="requestReload"
        >重新加载</AppButton
      ><AppButton
        size="sm"
        :disabled="!remote"
        @click="copyDraft"
        >复制草稿</AppButton
      ><AppButton
        variant="primary"
        size="sm"
        :disabled="!dirty || busy || reviewing"
        @click="review"
        >预览并保存 · Ctrl+S</AppButton
      >
    </div>
    <p
      v-if="error"
      role="alert"
      class="editor-notice text-danger"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="editor-notice text-success"
    >
      {{ message }}
    </p>
    <template v-if="reviewing && remote">
      <p class="text-warning text-[12px]">
        核对以下完整内容后，确认保存到上方服务器与路径。
      </p>
      <div class="editor-review">
        <label
          >打开时的内容<textarea
            :value="remote.text"
            readonly
            spellcheck="false"
            aria-label="保存前的远端内容"
          /></label
        ><label
          >即将保存的内容<textarea
            :value="reviewedText"
            readonly
            spellcheck="false"
            aria-label="即将保存的内容"
          />
        </label>
      </div>
      <div class="flex justify-end gap-2">
        <AppButton
          :disabled="busy"
          @click="reviewing = false"
          >返回编辑</AppButton
        ><AppButton
          variant="primary"
          :disabled="busy"
          @click="save"
          >{{ busy ? '正在检查并保存…' : '确认保存到远端' }}</AppButton
        >
      </div>
    </template>
    <textarea
      v-else
      v-model="draft"
      class="editor-input"
      :disabled="busy || !remote"
      spellcheck="false"
      aria-label="远端文件内容"
      :placeholder="busy ? '正在读取远端文本…' : '打开文件后即可编辑'"
    />
    <p class="editor-help">
      支持 1 MB 以内的 UTF-8
      普通文件。保存前检查冲突并保留原内容备份，使用原子替换；保留基本权限、所有者及换行格式。特殊
      ACL、扩展属性和硬链接关系不保留。
    </p>
  </OperationDialog>
  <AppConfirmDialog
    :open="!!discard"
    :title="discard === 'close' ? '关闭未保存的文件？' : '放弃草稿并重新加载？'"
    description="当前修改尚未保存。可以取消并复制草稿，避免丢失编辑内容。"
    confirm-label="放弃修改"
    danger
    @close="discard = ''"
    @confirm="confirmDiscard"
  />
</template>
<style scoped>
.editor-target {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
}
.editor-target strong {
  color: var(--color-accent);
}
.editor-target code {
  overflow-wrap: anywhere;
  color: var(--color-txt-3);
}
.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.editor-toolbar > span {
  font-size: 10px;
  color: var(--color-txt-3);
}
.editor-input,
.editor-review textarea {
  width: 100%;
  resize: none;
  min-height: 180px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-base);
  color: var(--color-txt);
  font:
    12px/1.8 'JetBrains Mono',
    monospace;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}
.editor-input {
  flex: 1;
}
.editor-review {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 180px;
}
.editor-review label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  color: var(--color-txt-3);
}
.editor-review textarea {
  flex: 1;
}
.editor-help {
  font-size: 10px;
  line-height: 1.7;
  color: var(--color-txt-4);
}
.editor-notice {
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  max-height: 130px;
  overflow: auto;
}
@media (max-width: 700px) {
  .editor-review {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
