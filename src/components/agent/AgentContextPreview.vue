<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AgentDraftAttachment } from '@/types/agent'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { bytesToSize } from '@/utils/agent-attachments'

defineProps<{ attachment: AgentDraftAttachment; disabled?: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="context-preview">
    <details class="context-details">
      <summary class="context-heading">
        <AppIcon
          name="lucide:scan-text"
          :size="15"
        /><span>{{ t('已附加：{name}', { name: attachment.name }) }}</span
        ><small>{{ bytesToSize(attachment.size) }}</small
        ><AppIcon
          name="lucide:chevron-down"
          :size="12"
        />
      </summary>
      <pre
        class="context-content">{{ attachment.content.slice(0, 4000) }}<template v-if="attachment.content.length > 4000">{{ '\n' + t('预览已截断，发送时包含完整选区。') }}</template></pre>
    </details>
    <IconButton
      icon="lucide:x"
      :size="12"
      :title="t('移除上下文')"
      :disabled="disabled"
      @click="emit('remove')"
    />
  </div>
</template>

<style scoped>
.context-preview {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 5px 6px;
  border: 1px solid
    color-mix(in srgb, var(--agent-color) 20%, var(--color-line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--agent-color) 6%, transparent);
}
.context-details {
  flex: 1;
  min-width: 0;
}
.context-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  list-style: none;
  cursor: pointer;
  font-size: var(--agent-small-font, 11px);
  color: var(--agent-color);
}
.context-heading::-webkit-details-marker {
  display: none;
}
.context-heading span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-heading small {
  white-space: nowrap;
  color: var(--color-txt-3);
}
.context-content {
  padding: 8px;
  margin: 5px 0 0;
  max-height: 130px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: 5px;
  background: var(--color-terminal);
  color: var(--color-txt-2);
  font: 11px/1.7 var(--font-mono);
  scrollbar-width: thin;
}
.context-heading:focus-visible {
  outline: 1px solid var(--agent-color);
  outline-offset: 1px;
  border-radius: 4px;
}
</style>
