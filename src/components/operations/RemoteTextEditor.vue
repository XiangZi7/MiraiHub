<script setup lang="ts">
import { computed, toRefs } from 'vue'
import { useRemoteTextDocument } from '@/composables/useRemoteTextDocument'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import OperationDialog from './OperationDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
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
const fileName = computed(() => props.path.split('/').pop() || '远端文件')
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
    <div class="editor-toolbar">
      <AppIcon
        name="lucide:file-text"
        :size="18"
        class="text-txt-3 shrink-0"
      />
      <div class="editor-target">
        <div class="editor-title">
          <strong>{{ fileName }}</strong
          ><span
            v-if="dirty"
            class="dirty-dot"
            title="未保存"
          />
        </div>
        <span
          :title="`${remote?.endpoint || connectionName} · ${remote?.path || path}`"
          >{{ connectionName }} · {{ remote?.path || path }}</span
        >
      </div>
      <IconButton
        icon="lucide:rotate-cw"
        title="重新加载"
        :size="15"
        :disabled="busy || reviewing"
        @click="requestReload"
      />
      <IconButton
        icon="lucide:copy"
        title="复制草稿"
        :size="15"
        :disabled="!remote"
        @click="copyDraft"
      />
      <AppButton
        variant="primary"
        size="sm"
        title="预览修改并保存 (Ctrl+S)"
        :disabled="!dirty || busy || reviewing"
        @click="review"
        >保存</AppButton
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
      <p class="text-amber text-[12px]">
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
    <footer class="editor-status">
      <span :class="dirty && 'text-amber'">{{
        busy ? '处理中…' : !remote ? '未加载' : dirty ? '未保存' : '已同步'
      }}</span>
      <span class="editor-format"
        >UTF-8{{ remote?.bom ? ' BOM' : '' }} ·
        {{ remote?.lineEnding || 'LF' }} · {{ lines }} 行 ·
        {{ (bytes / 1024).toFixed(1) }} KB</span
      >
      <details class="editor-help">
        <summary>保存说明</summary>
        <p>
          支持 1 MB 以内的 UTF-8
          普通文件。保存前检查冲突并备份原内容；保留基本权限、所有者及换行格式。特殊
          ACL、扩展属性和硬链接关系不保留。
        </p>
      </details>
    </footer>
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
  flex: 1;
  min-width: 0;
}
.editor-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.editor-title strong {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-amber);
  flex: none;
}
.editor-target > span {
  display: block;
  margin-top: 3px;
  font: 11px var(--font-mono);
  color: var(--color-txt-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.editor-status {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
  font-size: 10px;
  color: var(--color-txt-3);
}
.editor-format {
  margin-left: auto;
}
.editor-input,
.editor-review textarea {
  width: 100%;
  resize: none;
  min-height: 100px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  outline: none;
  box-shadow: none;
  background: color-mix(in oklch, var(--color-terminal) 40%, transparent);
  color: var(--color-txt);
  font: 12px/1.8 var(--font-mono);
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
  min-height: 100px;
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
  position: relative;
  font-size: 10px;
}
.editor-help summary {
  cursor: pointer;
}
.editor-help p {
  position: absolute;
  right: 0;
  bottom: 24px;
  width: min(340px, 80vw);
  padding: 12px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: oklch(19% 0.01 285);
  color: var(--color-txt-2);
  line-height: 1.7;
  box-shadow: var(--shadow-pop);
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
