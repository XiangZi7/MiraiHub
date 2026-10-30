<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import type { DatabaseExecution, DatabaseKind } from '@/types/database'
import SqlEditor from './SqlEditor.vue'
import DatabaseQueryResizeHandle from './DatabaseQueryResizeHandle.vue'
import DatabaseQueryResults from './DatabaseQueryResults.vue'

const props = defineProps<{
  databaseKind: DatabaseKind
  databaseName: string
  execution: DatabaseExecution | null
  loading: boolean
  error: string
  suggestions: string[]
}>()
const sql = defineModel<string>({ required: true })
const ratio = defineModel<number>('ratio', { required: true })
const emit = defineEmits<{
  run: [sql?: string]
  save: []
  askAgent: [content: string, intent: 'explain' | 'optimize']
}>()
const editor = useTemplateRef<InstanceType<typeof SqlEditor>>('editor')
const style = computed(() => {
  const value = Math.min(
    85,
    Math.max(15, Number.isFinite(ratio.value) ? ratio.value : 58)
  )
  return { gridTemplateRows: `${value}fr 10px ${100 - value}fr` }
})
defineExpose({ runnableSql: () => editor.value?.runnableSql() ?? sql.value })
</script>

<template>
  <div
    class="grid min-h-0 min-w-0 flex-1 overflow-hidden"
    :style="style"
  >
    <SqlEditor
      ref="editor"
      v-model="sql"
      :database-kind="props.databaseKind"
      :disabled="loading"
      :suggestions="suggestions"
      @run="emit('run', $event)"
      @save="emit('save')"
      @ask-agent="(content, intent) => emit('askAgent', content, intent)"
    />
    <DatabaseQueryResizeHandle v-model="ratio" />
    <DatabaseQueryResults
      :execution="execution"
      :loading="loading"
      :error="error"
      :database-kind="databaseKind"
      :database-name="databaseName"
    />
  </div>
</template>
