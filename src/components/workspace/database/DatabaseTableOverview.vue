<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type { DatabaseObject } from '@/types/database'

const props = defineProps<{
  objects: readonly DatabaseObject[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  open: [object: DatabaseObject]
  refresh: []
}>()

const tables = computed(() =>
  props.objects.filter(object => object.kind === 'table')
)
const showSchema = computed(
  () => new Set(tables.value.map(table => table.schema)).size > 1
)
</script>

<template>
  <section
    class="scroll-thin min-h-0 min-w-0 flex-1 overflow-auto"
    aria-label="当前数据库的表"
    :aria-busy="loading"
  >
    <div
      v-if="loading"
      role="status"
      class="text-txt-3 flex items-center justify-center gap-2 p-8 text-xs"
    >
      <AppIcon
        name="lucide:loader-circle"
        :size="14"
        class="animate-spin"
      />
      正在加载表列表…
    </div>
    <div
      v-else-if="error"
      role="alert"
      class="text-txt-3 flex flex-col items-center gap-3 p-8 text-xs"
    >
      <p>表列表加载失败，请重试</p>
      <AppButton
        size="sm"
        @click="emit('refresh')"
        >重新加载</AppButton
      >
    </div>
    <table
      v-else
      class="w-full table-fixed border-collapse text-left text-xs"
    >
      <colgroup>
        <col class="w-2/5" />
        <col />
      </colgroup>
      <thead class="bg-panel text-txt-3 sticky top-0 z-10">
        <tr>
          <th
            scope="col"
            class="border-line-soft border-r border-b px-3 py-2 font-medium"
          >
            表名
          </th>
          <th
            scope="col"
            class="border-line-soft border-b px-3 py-2 font-medium"
          >
            备注
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="table in tables"
          :key="databaseObjectKey(table)"
          class="even:bg-panel/40 hover:bg-hover/60 focus-within:bg-hover/60"
          @dblclick="emit('open', table)"
        >
          <td class="border-line-soft border-r px-3 py-2">
            <button
              type="button"
              class="text-txt-2 hover:text-accent focus-visible:outline-accent flex max-w-full items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2"
              :title="`打开表 ${table.schema}.${table.name}`"
              @click.stop="emit('open', table)"
              @dblclick.stop
            >
              <AppIcon
                name="lucide:table-2"
                :size="13"
                class="text-blue shrink-0"
              />
              <span class="truncate font-mono">{{
                showSchema ? `${table.schema}.${table.name}` : table.name
              }}</span>
            </button>
          </td>
          <td class="text-txt-3 px-3 py-2 wrap-anywhere whitespace-pre-wrap">
            {{ table.comment || '—' }}
          </td>
        </tr>
        <tr v-if="!tables.length">
          <td
            colspan="2"
            class="text-txt-4 p-8 text-center"
          >
            当前数据库暂无数据表
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
