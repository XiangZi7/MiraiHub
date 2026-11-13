<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, reactive, toRefs } from 'vue'
import { useRemoteTextDocument } from '@/composables/useRemoteTextDocument'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import { codeLanguage } from '@/utils/code-language'
import { formatBytes } from '@/utils/format'
import { textMetrics } from '@/utils/text-metrics'
import CodeEditor from '@/components/operations/CodeEditor.vue'
import OperationDialog from '@/components/operations/OperationDialog.vue'
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
  dirty,
  requestClose,
  confirmDiscard,
  saveAndClose,
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
  discard,
  conflict,
} = toRefs(state)
const fileName = computed(() => props.path.split('/').pop() || t('远端文件'))

/** 状态栏的光标位置，由编辑器内核上报 */
const cursor = reactive({ line: 1, column: 1 })
/** 状态栏的语言名，按文件名识别，与编辑器高亮用同一份映射 */
const languageLabel = computed(() => t(codeLanguage(props.path).label))
/** 草稿的行数与 UTF-8 字节数，随输入实时更新 */
const metrics = computed(() => {
  const result = textMetrics(draft.value)
  return {
    ...result,
    bytes:
      result.bytes +
      (remote.value?.lineEnding === 'CRLF' ? result.lines - 1 : 0) +
      (remote.value?.bom ? 3 : 0),
  }
})
/** 行尾格式来自远端文档元数据，CRLF 之外一律按 LF 展示 */
const lineEnding = computed(() =>
  remote.value?.lineEnding === 'CRLF' ? 'CRLF' : 'LF'
)
/** 编码固定 UTF-8，仅区分是否带 BOM */
const encoding = computed(() => (remote.value?.bom ? 'UTF-8 BOM' : 'UTF-8'))

defineExpose({
  requestClose,
  save,
})
</script>

<template>
  <!-- 远端文档编辑与冲突处理区域 -->
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
    <!-- 按实际文件语言提供代码高亮与编辑交互 -->
    <CodeEditor
      v-model="draft"
      :path="path"
      :disabled="busy || !remote"
      :placeholder="busy ? t('正在读取远端文本…') : t('打开文件后即可编辑')"
      @cursor="(line, column) => Object.assign(cursor, { line, column })"
    />
    <footer class="editor-statusbar">
      <span>{{
        t('第 {line} 行，第 {column} 列', {
          line: cursor.line,
          column: cursor.column,
        })
      }}</span>
      <span>{{ formatBytes(metrics.bytes) }}</span>
      <div class="editor-statusbar-right">
        <span>{{ languageLabel }}</span>
        <span>{{ encoding }}</span>
        <span>{{ lineEnding }}</span>
        <span :class="dirty && 'editor-dirty'">{{
          dirty ? t('未保存') : t('已保存')
        }}</span>
      </div>
    </footer>
  </OperationDialog>
  <!-- 关闭前保护未保存的远端草稿 -->
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
/* 编辑器状态栏使用 24px 高度、发丝线顶边和等宽 11px 文字；
   负边距抵掉对话框正文的 18px 内衬，让栏贴到窗口底边。 */
.editor-statusbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  height: 24px;
  margin: -14px -18px -18px;
  padding: 0 14px;
  border-top: 1px solid var(--color-line-soft);
  color: var(--color-txt-3);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
.editor-statusbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.editor-dirty {
  color: var(--color-accent);
}
@media (max-width: 700px) {
  .editor-statusbar {
    margin: -10px -12px -12px;
  }
}
</style>
