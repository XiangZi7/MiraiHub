<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, toRefs } from 'vue'
import { useRemoteTextDocument } from '@/composables/useRemoteTextDocument'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import OperationDialog from './OperationDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'

const { t } = useI18n()
const props = defineProps<RemoteEditRequest & { standalone?: boolean }>()
const emit = defineEmits<{
  close: []
  status: [dirty: boolean, busy: boolean]
}>()
const {
  state,
  requestClose,
  confirmDiscard,
  saveAndClose,
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
  discard,
  conflict,
} = toRefs(state)
const fileName = computed(() => props.path.split('/').pop() || t('远端文件'))
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
    <div
      v-if="conflict"
      role="alert"
      class="border-amber/40 bg-amber/10 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
    >
      <span class="text-txt min-w-0 flex-1">
        {{
          t(
            '远端文件已被修改。覆盖保存会丢弃远端的改动，重新加载会丢弃本地草稿。'
          )
        }}
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
    :description="t('当前文件有未保存的修改，是否保存后关闭？')"
    :confirm-label="t('保存并关闭')"
    @close="discard = ''"
    @confirm="saveAndClose"
  >
    <template #actions>
      <AppButton
        size="sm"
        @click="discard = ''"
        >{{ t('取消') }}</AppButton
      >
      <AppButton
        size="sm"
        @click="confirmDiscard"
        >{{ t('放弃修改') }}</AppButton
      >
      <AppButton
        variant="primary"
        size="sm"
        @click="saveAndClose"
        >{{ t('保存并关闭') }}</AppButton
      >
    </template>
  </AppConfirmDialog>
</template>

<style scoped>
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
