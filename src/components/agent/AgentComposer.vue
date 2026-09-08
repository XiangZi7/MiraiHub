<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentApprovalMode, AgentDraftAttachment } from '@/types/agent'
import { AGENT_FILE_ACCEPT } from '@/utils/agent-attachments'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AgentProfileSelect from './AgentProfileSelect.vue'
import AgentPermissionSelect from './AgentPermissionSelect.vue'

const props = defineProps<{
  disabled: boolean
  busy: boolean
  canSend: boolean
  awaitingApproval: boolean
  isDatabase: boolean
  attachments: AgentDraftAttachment[]
  reading: boolean
  attachmentError: string
  activeId: string
  profileOptions: { value: string; label: string; disabled?: boolean }[]
  profileDisabled: boolean
  profileError: string
}>()
const prompt = defineModel<string>({ required: true })
const approvalMode = defineModel<AgentApprovalMode>('approvalMode', {
  required: true,
})
const emit = defineEmits<{
  submit: []
  stop: []
  selectProfile: [id: string]
  attach: [files: File[]]
  removeAttachment: [id: string]
}>()
const { t } = useI18n()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
const placeholder = computed(() =>
  props.awaitingApproval
    ? '请先审批或拒绝上方操作…'
    : props.isDatabase
      ? '询问数据库，或描述要完成的操作…'
      : '描述问题，或让我帮你执行任务…'
)
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    event.stopPropagation()
    if (props.canSend) emit('submit')
  }
}
function selectFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  if (!props.disabled) emit('attach', Array.from(input.files ?? []))
  input.value = ''
}
watch(
  prompt,
  async () => {
    await nextTick()
    if (!textarea.value) return
    textarea.value.style.height = 'auto'
    textarea.value.style.height = `${Math.min(160, textarea.value.scrollHeight)}px`
  },
  { immediate: true }
)
</script>

<template>
  <footer class="agent-composer-footer">
    <form
      class="agent-composer"
      @submit.prevent="canSend && emit('submit')"
    >
      <div
        v-if="attachments.length"
        class="draft-attachments"
        :aria-label="t('待发送附件')"
      >
        <div
          v-for="file in attachments"
          :key="file.id"
          class="draft-attachment"
        >
          <AppIcon
            name="lucide:file-text"
            :size="17"
            class="shrink-0"
          />
          <div class="attachment-info">
            <span
              class="attachment-name"
              :title="file.name"
              >{{ file.name }}</span
            >
            <span class="attachment-size"
              >{{ (file.size / 1000).toFixed(1) }} KB</span
            >
          </div>
          <IconButton
            icon="lucide:x"
            :size="12"
            :title="t('移除附件')"
            :aria-label="`${t('移除附件')} ${file.name}`"
            :disabled="disabled"
            @click="emit('removeAttachment', file.id)"
          />
        </div>
      </div>
      <textarea
        ref="textarea"
        v-model="prompt"
        :placeholder="placeholder"
        rows="2"
        maxlength="8000"
        aria-label="发送给 AI 的消息"
        :disabled="disabled"
        @keydown="keydown"
      />
      <div class="composer-toolbar">
        <input
          ref="fileInput"
          type="file"
          class="file-input"
          multiple
          :accept="AGENT_FILE_ACCEPT"
          :disabled="disabled || reading"
          tabindex="-1"
          aria-hidden="true"
          @change="selectFiles"
        />
        <IconButton
          :icon="reading ? 'lucide:loader-circle' : 'lucide:plus'"
          :size="17"
          :title="t('上传文件：文本、日志、代码，每个最多 64 KB')"
          :aria-label="t('上传文件')"
          :disabled="disabled || reading"
          class="upload-button"
          @click="fileInput?.click()"
        />
        <AgentPermissionSelect
          v-model="approvalMode"
          :disabled="disabled || busy"
        />
        <div class="toolbar-spacer" />
        <AgentProfileSelect
          :active-id="activeId"
          :options="profileOptions"
          :disabled="profileDisabled || busy || awaitingApproval"
          @select="emit('selectProfile', $event)"
        />
        <button
          v-if="busy"
          type="button"
          class="composer-send"
          title="停止后续操作"
          aria-label="停止后续操作"
          @click="emit('stop')"
        >
          <AppIcon
            name="lucide:square"
            :size="14"
          />
        </button>
        <button
          v-else
          type="submit"
          class="composer-send"
          aria-label="发送消息"
          title="发送 (Enter)，换行 (Shift+Enter)"
          :disabled="!canSend"
        >
          <AppIcon
            name="lucide:arrow-up"
            :size="17"
          />
        </button>
      </div>
    </form>
    <p
      v-if="reading"
      class="composer-notice"
      role="status"
    >
      {{ t('正在读取附件…') }}
    </p>
    <p
      v-if="attachments.length"
      class="composer-notice"
    >
      {{ t('附件内容将在发送时交给所选模型，并保存到此聊天。') }}
    </p>
    <p
      v-if="attachmentError || profileError"
      class="composer-error"
      role="alert"
    >
      {{ attachmentError || profileError }}
    </p>
  </footer>
</template>

<style scoped>
.agent-composer-footer {
  flex-shrink: 0;
  padding: 10px 12px 12px;
  min-width: 0;
}
.agent-composer {
  min-width: 0;
  border: 1px solid var(--color-line);
  background: var(--color-input, #ffffff04);
  border-radius: 16px;
  padding: 10px 10px 7px;
  transition: border-color 150ms ease;
}
.agent-composer:focus-within {
  border-color: color-mix(in srgb, var(--agent-color) 55%, var(--color-line));
}
.agent-composer textarea {
  display: block;
  width: 100%;
  resize: none;
  min-height: 48px;
  max-height: 160px;
  padding: 3px 3px 9px;
  outline: none;
  font-size: 12px;
  line-height: 1.7;
  background: transparent;
  color: var(--color-txt);
}
.agent-composer textarea::placeholder {
  color: var(--color-txt-4);
}
.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.file-input {
  display: none;
}
.upload-button {
  flex-shrink: 0;
}
.toolbar-spacer {
  flex: 1;
  min-width: 0;
}
.composer-toolbar :deep(.agent-model-select) {
  flex: 0 1 auto;
}
.composer-toolbar :deep(.permission-select) {
  flex-shrink: 0;
}
.composer-send {
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--color-txt);
  color: var(--color-panel);
  cursor: pointer;
}
.composer-send:not(:disabled):hover {
  opacity: 0.8;
}
.composer-send:disabled {
  opacity: 0.25;
  cursor: default;
}
.composer-send:focus-visible {
  outline: 2px solid var(--agent-color);
  outline-offset: 3px;
}
.draft-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 150px;
  overflow-y: auto;
  padding-bottom: 7px;
}
.draft-attachment {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: 100%;
  padding: 6px 7px;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background: var(--color-card);
  color: var(--color-txt-2);
}
.attachment-info {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
  font-size: 11px;
}
.attachment-size {
  color: var(--color-txt-4);
  font-size: 10px;
}
.composer-notice,
.composer-error {
  margin-top: 6px;
  padding-inline: 3px;
  font-size: 10px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.composer-notice {
  color: var(--color-txt-4);
}
.composer-error {
  color: var(--color-danger);
}
@media (prefers-reduced-motion: reduce) {
  .agent-composer {
    transition: none;
  }
}
</style>
