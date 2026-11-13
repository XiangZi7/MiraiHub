<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import * as database from '@/api/database'
import { toast } from '@/composables/useToast'
import type { DatabaseKind } from '@/types/database'
import { copyText } from '@/utils/clipboard'
import {
  diffSchemas,
  loadSchemaTables,
  type SchemaDiffItem,
} from '@/utils/schema-diff'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  /** 当前所在库，作为默认的“源” */
  databaseName: string
}>()

const emit = defineEmits<{
  close: []
  /** 把迁移 SQL 打开到新的查询标签，并切到目标库执行 */
  openSql: [sql: string, database: string]
}>()

const state = reactive({
  databases: [] as string[],
  source: props.databaseName,
  target: '',
  loading: false,
  progress: '',
  items: null as SchemaDiffItem[] | null,
  selected: new Set<number>(),
})

// 对比时临时开的会话，关闭弹窗时统一断开
const forks = new Set<string>()
let disposed = false
let generation = 0

const kindMeta: Record<
  SchemaDiffItem['kind'],
  { icon: string; tone: string; label: string }
> = {
  'add-table': {
    icon: 'lucide:table-2',
    tone: 'text-success',
    label: '新增表',
  },
  'drop-table': {
    icon: 'lucide:table-2',
    tone: 'text-danger',
    label: '删除表',
  },
  'add-column': {
    icon: 'lucide:plus',
    tone: 'text-success',
    label: '新增字段',
  },
  'drop-column': {
    icon: 'lucide:minus',
    tone: 'text-danger',
    label: '删除字段',
  },
  'modify-column': {
    icon: 'lucide:pencil',
    tone: 'text-amber',
    label: '修改字段',
  },
  'add-index': {
    icon: 'lucide:list-plus',
    tone: 'text-success',
    label: '新增索引',
  },
  'drop-index': {
    icon: 'lucide:list-minus',
    tone: 'text-danger',
    label: '删除索引',
  },
  'modify-index': {
    icon: 'lucide:pencil',
    tone: 'text-amber',
    label: '修改索引',
  },
  'modify-constraint': {
    icon: 'lucide:link',
    tone: 'text-amber',
    label: '修改约束',
  },
}

const databaseOptions = computed(() =>
  state.databases.map(name => ({ value: name, label: name }))
)
const selectedSql = computed(() =>
  (state.items ?? [])
    .filter((item, index) => state.selected.has(index) && !item.unsupported)
    .map(item => item.sql)
    .join('\n')
)

onMounted(async () => {
  try {
    state.databases = await database.listDatabases(props.sessionId)
    state.target = state.databases.find(name => name !== state.source) ?? ''
  } catch (error) {
    toast.error({
      title: t('读取数据库列表失败'),
      description: database.errorMessage(error),
    })
  }
})

onBeforeUnmount(() => {
  disposed = true
  generation += 1
  for (const id of forks) void database.disconnect(id).catch(() => {})
})

/** 为指定库开一个独立会话并读取全部表结构，不影响当前工作区的活动库。 */
async function loadDatabase(name: string, label: string) {
  const fork = await database.forkSession(props.sessionId, name)
  forks.add(fork.sessionId)
  try {
    if (disposed) throw new Error(t('结构对比已关闭'))
    const result = await loadSchemaTables(fork.sessionId, (done, total) => {
      if (!disposed) state.progress = `${label} ${done}/${total}`
    })
    if (result.truncated)
      throw new Error(t('表数量超过 120，无法生成完整的结构迁移'))
    return result
  } finally {
    await database.disconnect(fork.sessionId).catch(() => {})
    forks.delete(fork.sessionId)
  }
}
// 更换比较范围时废弃旧结果，禁止把旧 SQL 发送到新选择的目标库。
watch([() => state.source, () => state.target], () => {
  generation += 1
  state.items = null
  state.selected = new Set()
})

/** 读取两侧结构并计算差异，默认勾选非删除类变更。 */
async function compare(): Promise<void> {
  if (
    state.loading ||
    !state.source ||
    !state.target ||
    state.source === state.target
  )
    return
  const token = ++generation
  const sourceName = state.source
  const targetName = state.target
  state.loading = true
  state.items = null
  try {
    const source = await loadDatabase(sourceName, t('源'))
    const target = await loadDatabase(targetName, t('目标'))
    if (disposed || token !== generation) return
    const items = diffSchemas(
      props.databaseKind,
      source.tables,
      target.tables,
      ''
    )
    state.items = items
    state.selected = new Set(
      items.flatMap((item, index) =>
        item.kind.startsWith('drop') ||
        item.kind === 'modify-index' ||
        item.unsupported
          ? []
          : [index]
      )
    )
  } catch (error) {
    if (!disposed && token === generation)
      toast.error({
        title: t('结构对比失败'),
        description: database.errorMessage(error),
      })
  } finally {
    state.loading = false
  }
}

/** 勾选 / 取消单条差异。 */
function toggle(index: number): void {
  const next = new Set(state.selected)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  state.selected = next
}

/** 复制选中的迁移 SQL。 */
async function copySql(): Promise<void> {
  try {
    await copyText(selectedSql.value)
    toast.success(t('已复制到剪贴板'))
  } catch (error) {
    toast.error({ title: t('复制失败'), description: String(error) })
  }
}
</script>

<template>
  <AppDialog
    wide
    :title="t('结构对比')"
    :description="
      t('对比两个库的表、字段与索引，生成让目标库与源库一致的迁移 SQL。')
    "
    @close="emit('close')"
  >
    <div class="flex items-end gap-2">
      <div class="min-w-0 flex-1">
        <AppSelect
          icon="lucide:database"
          v-model="state.source"
          :label="t('源（期望结构）')"
          :options="databaseOptions"
          :disabled="state.loading"
        />
      </div>
      <AppIcon
        name="lucide:arrow-right"
        :size="14"
        class="text-txt-4 mb-2 shrink-0"
      />
      <div class="min-w-0 flex-1">
        <AppSelect
          icon="lucide:database"
          v-model="state.target"
          :label="t('目标（将被修改）')"
          :options="databaseOptions"
          :disabled="state.loading"
        />
      </div>
      <AppButton
        variant="primary"
        :disabled="
          state.loading || !state.target || state.source === state.target
        "
        @click="compare"
      >
        {{ t('开始对比') }}
      </AppButton>
    </div>

    <div class="mt-3 min-h-40">
      <div
        v-if="state.loading"
        class="flex flex-col gap-2"
      >
        <AppSkeleton :rows="6" />
        <span class="text-txt-4 text-center text-[11px]">{{
          state.progress
        }}</span>
      </div>
      <AppEmptyState
        v-else-if="state.items && !state.items.length"
        compact
        icon="lucide:circle-check"
        :title="t('两个库的结构一致')"
      />
      <TransitionGroup
        v-else-if="state.items"
        tag="ul"
        name="slide-up"
        class="flex flex-col gap-0.5"
      >
        <li
          v-for="(item, index) in state.items"
          :key="`${item.kind}:${item.table}:${item.name}`"
        >
          <label class="row-item">
            <input
              type="checkbox"
              class="accent-accent"
              :checked="state.selected.has(index)"
              :disabled="Boolean(item.unsupported)"
              @change="toggle(index)"
            />
            <AppIcon
              :name="kindMeta[item.kind].icon"
              :size="13"
              :class="['shrink-0', kindMeta[item.kind].tone]"
            />
            <span class="text-txt-3 w-14 shrink-0 text-[11px]">{{
              t(kindMeta[item.kind].label)
            }}</span>
            <span class="text-txt min-w-0 truncate font-mono text-[11.5px]">
              {{ item.table
              }}<template v-if="item.name !== item.table"
                >.{{ item.name }}</template
              >
            </span>
            <span class="flex-1" />
            <span class="text-txt-4 truncate font-mono text-[10.5px]">{{
              item.unsupported || item.detail
            }}</span>
          </label>
        </li>
      </TransitionGroup>
    </div>

    <template
      v-if="state.items?.length"
      #footer
    >
      <span class="text-txt-3 text-[11px]">{{
        t('已选 {count} 项', { count: state.selected.size })
      }}</span>
      <span class="flex-1" />
      <AppButton
        size="sm"
        :disabled="!state.selected.size"
        @click="copySql"
      >
        {{ t('复制 SQL') }}
      </AppButton>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="!state.selected.size"
        @click="emit('openSql', selectedSql, state.target)"
      >
        {{ t('在查询中打开') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
