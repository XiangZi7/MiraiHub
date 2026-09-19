<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppDialog from '@/components/ui/AppDialog.vue'
import type { ColumnTagConfig } from '@/types/database'
import DatabaseColumnTagEditor from './DatabaseColumnTagEditor.vue'

const { t } = useI18n()

/**
 * 浏览器预览用的页内浮层。桌面版走 Rust 创建的原生子窗口（ColumnTagsPage），
 * 这里只是让不启动 Tauri 也能检查表单 UI。
 */
defineProps<{
  open: boolean
  column: string
  initial?: ColumnTagConfig | null
  sampleValues?: readonly string[]
}>()

const emit = defineEmits<{
  close: []
  submit: [config: ColumnTagConfig | null]
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="database-tag-dialog">
      <div
        v-if="open"
        class="fixed inset-0 z-100"
      >
        <AppDialog
          :title="t('标签化显示：{value0}', { value0: column })"
          :description="
            t('把匹配的单元格值显示为彩色标签，只改变显示，不会修改数据。')
          "
          wide
          @close="emit('close')"
        >
          <div class="-mx-4 -my-3.5 flex h-[70vh] flex-col">
            <DatabaseColumnTagEditor
              :column="column"
              :initial="initial ?? null"
              :sample-values="sampleValues ?? []"
              @cancel="emit('close')"
              @submit="emit('submit', $event)"
            />
          </div>
        </AppDialog>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.database-tag-dialog-enter-active,
.database-tag-dialog-leave-active {
  transition: opacity 120ms ease;
}

.database-tag-dialog-enter-from,
.database-tag-dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .database-tag-dialog-enter-active,
  .database-tag-dialog-leave-active {
    transition: none;
  }
}
</style>
