<script setup lang="ts">
import { computed, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { snippetVariables, renderSnippet } from '@/utils/terminal-snippets'
const props = defineProps<{ command: string }>()
const emit = defineEmits<{ close: []; insert: [command: string]; batch: [command: string] }>()
const { t } = useI18n()
const variables = snippetVariables(props.command)
// 响应式状态
const state = reactive({
  // 每个占位符对应的用户输入
  values: Object.fromEntries(variables.map(name => [name, ''])) as Record<string, string>,
})
const { values } = toRefs(state)
const rendered = computed(() => { try { return renderSnippet(props.command, state.values) } catch { return '' } })
</script>
<template>
  <AppDialog :title="t('填写片段变量')" @close="emit('close')">
    <div class="grid gap-3 p-4">
      <label v-for="name in variables" :key="name" class="grid gap-1 text-xs">{{ name }}<input v-model="values[name]" class="field" autocomplete="off" /></label>
      <pre class="bg-canvas text-txt-2 max-h-48 overflow-auto rounded p-3 font-mono text-xs whitespace-pre-wrap">{{ rendered || command }}</pre>
      <div class="flex justify-end gap-2">
        <AppButton :disabled="!rendered" @click="emit('batch', rendered)">{{ t('发送到多台主机') }}</AppButton>
        <AppButton variant="primary" :disabled="!rendered" @click="emit('insert', rendered)">{{ t('填入终端') }}</AppButton>
      </div>
    </div>
  </AppDialog>
</template>
