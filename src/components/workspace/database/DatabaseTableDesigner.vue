<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { toast } from '@/composables/useToast'
import type { DatabaseKind, DatabaseObject } from '@/types/database'
import type { DatabaseTableDetail } from '@/types/database'
import type {
  TableDesignerDraft,
  TableDesignerIndex,
  ReferentialAction,
} from '@/types/database-designer'
import {
  buildAlterTableSql,
  buildCreateTableSql,
  columnTypes,
  normalizeDataTypeLabel,
  parseStoredType,
  validateTableDraft,
} from '@/utils/database-ddl'
import { copyText } from '@/utils/clipboard'
import DatabaseTableFieldsEditor from './designer/DatabaseTableFieldsEditor.vue'
import DatabaseTableForeignKeysEditor from './designer/DatabaseTableForeignKeysEditor.vue'
import DatabaseTableIndexesEditor from './designer/DatabaseTableIndexesEditor.vue'

const { t } = useI18n()

type DesignerPanel = 'columns' | 'indexes' | 'foreignKeys' | 'options' | 'sql'

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  schema: string
  objects: readonly DatabaseObject[]
  /** 编辑模式：要设计的现有表；不传为新建表。 */
  editTable?: { schema: string, name: string } | null
}>()

const emit = defineEmits<{
  created: [schema: string, name: string]
  applied: [schema: string, name: string]
  query: [sql: string]
  dirty: [dirty: boolean]
}>()

const editing = computed(() => Boolean(props.editTable))
const currentDetail = shallowRef<DatabaseTableDetail | null>(null)
const loadingDetail = ref(false)
const extraTypes = ref<string[]>([])

function defaultDraft(schema: string): TableDesignerDraft {
  return {
    schema,
    name: 'new_table',
    comment: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    autoIncrement: null,
    columns: [
      {
        id: `column-${Date.now()}`,
        name: 'id',
        dataType: 'BIGINT',
        length: '',
        nullable: false,
        primaryKey: true,
        unique: false,
        unsigned: props.databaseKind === 'mysql',
        autoIncrement: true,
        defaultValue: '',
        comment: t('主键'),
      },
    ],
    indexes: [],
    foreignKeys: [],
  }
}

const draft = reactive<TableDesignerDraft>(defaultDraft(props.schema))
const activePanel = ref<DesignerPanel>('columns')
const creating = ref(false)
const applying = ref(false)
const referencedColumns = reactive<Record<string, string[]>>({})
const loadingReference = ref('')

const validation = computed(() =>
  validateTableDraft({ kind: props.databaseKind, draft, extraTypes: extraTypes.value })
)

function computedAlterSql(): string | null {
  const current = currentDetail.value
  if (!editing.value || !current || !validation.value.valid) return null
  try {
    return buildAlterTableSql({
      kind: props.databaseKind,
      current,
      draft,
      extraTypes: extraTypes.value,
    })
  } catch {
    return null
  }
}

const sqlPreview = computed(() => {
  if (editing.value) {
    if (!currentDetail.value) return t('-- 正在读取表结构…')
    if (!validation.value.valid)
      return t('-- 完成必填配置后将在这里生成 ALTER TABLE SQL')
    return (
      computedAlterSql() || `-- ${t('没有需要保存的修改')}`
    )
  }
  try {
    return buildCreateTableSql({ kind: props.databaseKind, draft })
  } catch {
    return t('-- 完成必填配置后将在这里生成 CREATE TABLE SQL')
  }
})
const tableObjects = computed(() =>
  props.objects.filter(object => object.kind === 'table')
)
const panelItems = computed(() => [
  {
    id: 'columns' as const,
    label: t('字段'),
    icon: 'lucide:columns-3',
    count: draft.columns.length,
  },
  {
    id: 'indexes' as const,
    label: t('索引'),
    icon: 'lucide:list-tree',
    count: draft.indexes.length,
  },
  {
    id: 'foreignKeys' as const,
    label: t('外键'),
    icon: 'lucide:link-2',
    count: draft.foreignKeys.length,
  },
  {
    id: 'options' as const,
    label: t('选项'),
    icon: 'lucide:settings-2',
    count: null,
  },
  {
    id: 'sql' as const,
    label: t('SQL 预览'),
    icon: 'lucide:code-2',
    count: null,
  },
])
const engineOptions = ['InnoDB', 'MyISAM', 'MEMORY'].map(value => ({
  value,
  label: value,
}))
const charsetOptions = ['utf8mb4', 'utf8', 'latin1', 'ascii'].map(value => ({
  value,
  label: value,
}))

const fieldsEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableFieldsEditor>>('fieldsEditor')
const indexesEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableIndexesEditor>>('indexesEditor')
const foreignKeysEditor = useTemplateRef<
  InstanceType<typeof DatabaseTableForeignKeysEditor>
>('foreignKeysEditor')

/**
 * 「添加」按钮跟着当前面板走。
 *
 * 之前每个面板各自顶着一行标题 + 说明 + 添加按钮，切到字段页要先划过
 * 头部、常规属性、面板切换、面板标题四行才见到数据；合并到工具条上省掉一行。
 */
const addAction = computed(() => {
  switch (activePanel.value) {
    case 'columns':
      return { label: t('添加字段'), run: () => fieldsEditor.value?.add() }
    case 'indexes':
      return { label: t('添加索引'), run: () => indexesEditor.value?.add() }
    case 'foreignKeys':
      return {
        label: t('添加外键'),
        run: () => foreignKeysEditor.value?.add(),
      }
    default:
      return null
  }
})

const autoIncrementInput = computed({
  get: () => (draft.autoIncrement == null ? '' : String(draft.autoIncrement)),
  set: (value: string) => {
    const trimmed = value.trim()
    draft.autoIncrement = trimmed === '' ? null : Number(trimmed)
  },
})
const hasAutoIncrementColumn = computed(() =>
  draft.columns.some(column => column.autoIncrement)
)

function currentAutoIncrementLabel(): string {
  const current = currentDetail.value?.options?.autoIncrement
  return current == null ? '—' : String(current)
}

async function loadEditTarget(): Promise<void> {
  const target = props.editTable
  if (!props.sessionId || !target) {
    currentDetail.value = null
    return
  }
  loadingDetail.value = true
  try {
    const detail = await database.tableDetail(
      props.sessionId,
      target.schema,
      target.name,
      'table'
    )
    currentDetail.value = detail
    hydrateFromDetail(detail)
  } catch (cause) {
    toast.error({
      title: t('读取表结构失败'),
      description: database.errorMessage(cause),
    })
  } finally {
    loadingDetail.value = false
  }
}

/** 把现有表结构映射进草稿：无法表示的索引/外键不进草稿，差异生成会保持原样。 */
function hydrateFromDetail(detail: DatabaseTableDetail): void {
  const kind = props.databaseKind
  const extra = new Set<string>()
  for (const column of detail.columns) {
    const label = normalizeDataTypeLabel(column.dataType, kind)
    if (!columnTypes(kind).includes(label as never)) extra.add(label)
  }
  extraTypes.value = [...extra]

  const indexes: TableDesignerIndex[] = []
  for (const index of detail.indexes) {
    if (index.primary) continue
    const representable = index.columns.every(columnName =>
      detail.columns.some(
        column => columnName.toLowerCase() === column.name.toLowerCase()
      )
    )
    if (!representable || index.subPart != null) continue
    indexes.push({
      id: `index-${index.name}-${indexes.length}`,
      name: index.name,
      kind: index.unique ? 'unique' : 'index',
      method: 'btree',
      columns: [...index.columns],
    })
  }

  const foreignKeys = detail.foreignKeys
    .filter(foreignKey => foreignKey.columns.length === 1)
    .map((foreignKey, index) => ({
      id: `fk-${foreignKey.name}-${index}`,
      name: foreignKey.name,
      column: foreignKey.columns[0] ?? '',
      referencedSchema: foreignKey.referencedSchema,
      referencedTable: foreignKey.referencedTable,
      referencedColumn: foreignKey.referencedColumns[0] ?? '',
      onDelete: (foreignKey.deleteRule || 'NO ACTION') as ReferentialAction,
      onUpdate: (foreignKey.updateRule || 'NO ACTION') as ReferentialAction,
    }))

  draft.schema = detail.schema
  draft.name = detail.name
  draft.comment = detail.options?.comment ?? ''
  draft.engine = detail.options?.engine ?? 'InnoDB'
  draft.charset = detail.options?.charset ?? 'utf8mb4'
  draft.autoIncrement = detail.options?.autoIncrement ?? null
  draft.columns = detail.columns.map((column, index) => {
    const parsed = parseStoredType(column.dataType, kind)
    return {
      id: `column-${Date.now()}-${index}`,
      name: column.name,
      dataType: normalizeDataTypeLabel(column.dataType, kind),
      length: parsed.length,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      // 编辑时唯一约束统一走索引管理，避免 MySQL MODIFY 无法移除内联唯一索引。
      unique: false,
      unsigned: parsed.unsigned,
      autoIncrement: column.autoIncrement,
      defaultValue: column.defaultValue ?? '',
      comment: column.comment ?? '',
    }
  })
  draft.indexes = indexes
  draft.foreignKeys = foreignKeys
}

onMounted(() => {
  void loadEditTarget()
})

watch(
  () => props.editTable,
  () => {
    void loadEditTarget()
  }
)

async function inspectReference(schema: string, table: string): Promise<void> {
  const key = `${schema}.${table}`
  if (!props.sessionId || !schema || !table || referencedColumns[key]) return
  loadingReference.value = key
  try {
    const columns = await database.describeObject(
      props.sessionId,
      schema,
      table
    )
    referencedColumns[key] = columns.map(column => column.name)
  } catch (cause) {
    toast.error({
      title: t('读取关联表字段失败'),
      description: database.errorMessage(cause),
    })
  } finally {
    if (loadingReference.value === key) loadingReference.value = ''
  }
}

async function copySql(): Promise<void> {
  if (!hasChanges.value) return
  await copyText(sqlPreview.value)
  toast.success(editing.value ? t('修改 SQL 已复制') : t('建表 SQL 已复制'))
}

function openSqlQuery(): void {
  if (!hasChanges.value) return
  emit('query', sqlPreview.value)
}

async function createTable(): Promise<void> {
  if (!validation.value.valid) {
    toast.warning(validation.value.errors[0] ?? t('请完善建表配置'))
    return
  }
  creating.value = true
  try {
    const execution = await database.execute(
      props.sessionId,
      sqlPreview.value,
      1
    )
    const failed = execution.statements.find(statement => statement.error)
    if (failed?.error) throw new Error(failed.error)
    emit('created', draft.schema, draft.name)
  } catch (cause) {
    toast.error({
      title: t('创建数据表失败'),
      description: database.errorMessage(cause),
    })
  } finally {
    creating.value = false
  }
}

async function applyChanges(): Promise<void> {
  const current = currentDetail.value
  if (!current) return
  if (!validation.value.valid) {
    toast.warning(validation.value.errors[0] ?? t('请完善建表配置'))
    return
  }
  const alterSql = computedAlterSql()
  // PostgreSQL 的自增计数走专用接口（identity 列校验在 Rust 侧）。
  const pgAutoIncrement =
    props.databaseKind === 'postgresql' &&
    draft.autoIncrement != null &&
    draft.autoIncrement !== current.options?.autoIncrement
      ? draft.autoIncrement
      : null
  if (!alterSql && pgAutoIncrement == null) {
    toast.info(t('没有需要保存的修改'))
    return
  }
  applying.value = true
  try {
    if (alterSql) {
      const execution = await database.execute(props.sessionId, alterSql, 1)
      const failed = execution.statements.find(statement => statement.error)
      if (failed?.error) throw new Error(failed.error)
    }
    if (pgAutoIncrement != null) {
      await database.alterTableOptions(props.sessionId, draft.schema, draft.name, {
        autoIncrement: pgAutoIncrement,
      })
    }
    emit('applied', draft.schema, draft.name)
  } catch (cause) {
    toast.error({
      title: t('保存表结构修改失败'),
      description: database.errorMessage(cause),
    })
  } finally {
    applying.value = false
  }
}

const hasChanges = computed(() => {
  if (!editing.value) return validation.value.valid
  return computedAlterSql() != null
})

/** 关闭标签的未保存提示只认真正的修改：
    新建模式与初始骨架对比（忽略自动生成的列 id），未编辑不提示。 */
function draftSnapshot(value: TableDesignerDraft): string {
  return JSON.stringify({
    schema: value.schema,
    name: value.name,
    comment: value.comment,
    engine: value.engine,
    charset: value.charset,
    autoIncrement: value.autoIncrement,
    indexes: value.indexes,
    foreignKeys: value.foreignKeys,
    columns: value.columns.map(column => ({ ...column, id: '' })),
  })
}
const initialDraftSnapshot = draftSnapshot(defaultDraft(props.schema))
const dirty = computed(() => {
  if (editing.value) return hasChanges.value
  return draftSnapshot(draft) !== initialDraftSnapshot
})
watch(dirty, value => emit('dirty', value))
</script>

<template>
  <div class="table-designer">
    <!-- 常规属性一行放下：标签横排在输入框前，标题交给标签页显示 -->
    <section
      class="general-bar"
      :aria-label="t('建表配置')"
    >
      <label class="general-field table-name">
        <span>{{ t('表名') }}</span>
        <AppInput
          v-model="draft.name"
          size="sm"
          monospace
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('表名')"
        />
      </label>
      <label class="general-field schema-field">
        <span>{{ databaseKind === 'mysql' ? t('Database') : 'Schema' }}</span>
        <AppInput
          v-model="draft.schema"
          size="sm"
          monospace
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('数据库或 Schema')"
        />
      </label>
      <template v-if="databaseKind === 'mysql'">
        <div class="general-field select-field">
          <span>{{ t('存储引擎') }}</span>
          <div class="select-box">
            <AppSelect
              v-model="draft.engine"
              :label="t('存储引擎')"
              :options="engineOptions"
              hide-label
              compact
            />
          </div>
        </div>
        <div class="general-field select-field">
          <span>{{ t('字符集') }}</span>
          <div class="select-box">
            <AppSelect
              v-model="draft.charset"
              :label="t('字符集')"
              :options="charsetOptions"
              hide-label
              compact
            />
          </div>
        </div>
      </template>
      <label class="general-field comment-field">
        <span>{{ t('表备注') }}</span>
        <AppInput
          v-model="draft.comment"
          size="sm"
          :placeholder="t('可选，用于说明表的用途')"
          :aria-label="t('表备注')"
        />
      </label>
    </section>

    <!-- 面板切换与操作同一行：添加按钮跟着面板走，保存固定在右侧 -->
    <div class="designer-toolbar">
      <nav
        class="designer-tabs"
        :aria-label="t('建表配置')"
      >
        <AppButton
          v-for="item in panelItems"
          :key="item.id"
          variant="bare"
          :class="[
            'designer-tab',
            activePanel === item.id && 'designer-tab-active',
          ]"
          @click="activePanel = item.id"
        >
          <AppIcon
            :name="item.icon"
            :size="12"
          /><span>{{ item.label }}</span
          ><span
            v-if="item.count !== null"
            class="tab-count"
            >{{ item.count }}</span
          >
        </AppButton>
      </nav>
      <div class="designer-actions">
        <AppButton
          v-if="addAction"
          size="sm"
          class="h-7"
          :disabled="loadingDetail"
          @click="addAction.run()"
          ><AppIcon
            name="lucide:plus"
            :size="11"
          />{{ addAction.label }}</AppButton
        >
        <AppButton
          v-if="activePanel === 'sql'"
          size="sm"
          class="h-7"
          :disabled="!hasChanges"
          @click="copySql"
          ><AppIcon
            name="lucide:copy"
            :size="11"
          />{{ t('复制 SQL') }}</AppButton
        >
        <AppButton
          size="sm"
          class="h-7"
          :disabled="!hasChanges"
          @click="openSqlQuery"
          ><AppIcon
            name="lucide:square-terminal"
            :size="11"
          />{{ t('在查询中打开') }}</AppButton
        >
        <AppButton
          v-if="!editing"
          variant="primary"
          size="sm"
          class="h-7"
          :disabled="creating || !validation.valid"
          @click="createTable"
          ><AppIcon
            :name="creating ? 'lucide:loader-circle' : 'lucide:check'"
            :size="12"
            :class="creating && 'animate-spin'"
          />{{ creating ? t('正在创建…') : t('创建表') }}</AppButton
        >
        <AppButton
          v-else
          variant="primary"
          size="sm"
          class="h-7"
          :disabled="applying || !hasChanges"
          @click="applyChanges"
          ><AppIcon
            :name="applying ? 'lucide:loader-circle' : 'lucide:check'"
            :size="12"
            :class="applying && 'animate-spin'"
          />{{ applying ? t('正在保存…') : t('保存修改') }}</AppButton
        >
      </div>
    </div>

    <main class="designer-body">
      <div
        v-if="loadingDetail"
        class="text-txt-3 flex items-center gap-2 p-6 text-[11px]"
      >
        <AppIcon
          name="lucide:loader-circle"
          :size="13"
          class="animate-spin"
        />
        {{ t('正在读取表结构…') }}
      </div>
      <template v-else>
        <DatabaseTableFieldsEditor
          v-show="activePanel === 'columns'"
          ref="fieldsEditor"
          v-model="draft.columns"
          :database-kind="databaseKind"
          :extra-types="extraTypes"
        />
        <DatabaseTableIndexesEditor
          v-show="activePanel === 'indexes'"
          ref="indexesEditor"
          v-model="draft.indexes"
          :columns="draft.columns"
          :database-kind="databaseKind"
        />
        <DatabaseTableForeignKeysEditor
          v-show="activePanel === 'foreignKeys'"
          ref="foreignKeysEditor"
          v-model="draft.foreignKeys"
          :columns="draft.columns"
          :schema="draft.schema"
          :tables="tableObjects"
          :referenced-columns="referencedColumns"
          :loading-reference="loadingReference"
          @inspect-table="inspectReference"
        />
        <section
          v-show="activePanel === 'options'"
          class="options-panel"
        >
          <label class="option-field">
            <span>{{
              databaseKind === 'mysql'
                ? t('自增值（AUTO_INCREMENT）')
                : t('自增值（RESTART WITH）')
            }}</span>
            <AppInput
              v-model="autoIncrementInput"
              size="sm"
              monospace
              autocomplete="off"
              inputmode="numeric"
              :placeholder="t('当前值 {value0}，留空表示不修改', { value0: currentAutoIncrementLabel() })"
              :aria-label="t('自增值')"
            />
          </label>
          <p class="options-hint">
            {{
              databaseKind !== 'mysql'
                ? t('只对 identity 自增列生效；serial 序列列保存时会提示改用 ALTER SEQUENCE。')
                : hasAutoIncrementColumn
                  ? t('下一个插入行将从这个值开始递增。')
                  : t('表当前没有自增字段；先在字段页勾选自增后，这里才会生效。')
            }}
          </p>
        </section>
        <pre
          v-show="activePanel === 'sql'"
          class="sql-preview scroll-thin"
        ><code>{{ sqlPreview }}</code></pre>
      </template>
    </main>

    <!-- 底栏只在出错时说话；没问题就安静地报个数 -->
    <footer class="designer-footer">
      <div
        v-if="!validation.valid"
        class="validation-error"
        :title="validation.errors.join('\n')"
      >
        <AppIcon
          name="lucide:circle-alert"
          :size="12"
        />{{ validation.errors[0]
        }}<span v-if="validation.errors.length > 1">{{
          t('database.moreErrors', { count: validation.errors.length - 1 })
        }}</span>
      </div>
      <span class="text-txt-4 ml-auto text-[9.5px]"
        >{{
          t('database.tableCounts', {
            columns: draft.columns.length,
            indexes: draft.indexes.length,
            keys: draft.foreignKeys.length,
          })
        }}
      </span>
    </footer>
  </div>
</template>

<style scoped>
.table-designer {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg);
}
.general-bar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 6px 12px;
  background:
    linear-gradient(110deg, rgb(255 255 255 / 2.5%), transparent 45%),
    color-mix(in oklch, var(--color-card) 66%, transparent);
}
.general-field {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.general-field > span {
  flex: none;
  color: var(--color-txt-4);
  font-size: 9.5px;
  white-space: nowrap;
}
.table-name {
  flex: 1 1 170px;
}
.schema-field {
  flex: 1 1 140px;
}
.select-field {
  flex: none;
}
.select-box {
  width: 104px;
}
.comment-field {
  flex: 2 1 220px;
}
.designer-toolbar {
  display: flex;
  height: 36px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 8px 0 4px;
  background: color-mix(in oklch, var(--color-panel) 54%, transparent);
}
.designer-tabs {
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: stretch;
  gap: 1px;
  overflow-x: auto;
  scrollbar-width: none;
}
.designer-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}
.designer-tab {
  position: relative;
  display: flex;
  flex: none;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  color: var(--color-txt-3);
  font-size: 10.5px;
  outline: none;
}
.designer-tab::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  content: '';
}
.designer-tab:hover,
.designer-tab:focus-visible {
  color: var(--color-txt);
}
.designer-tab-active {
  color: var(--color-accent);
}
.designer-tab-active::after {
  background: var(--color-accent);
  box-shadow: 0 0 8px color-mix(in oklch, var(--color-accent) 35%, transparent);
}
.tab-count {
  display: grid;
  min-width: 16px;
  height: 16px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in oklch, currentColor 9%, transparent);
  font-size: 8px;
}
.designer-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.options-panel {
  display: grid;
  max-width: 480px;
  gap: 8px;
  overflow: auto;
  padding: 14px 12px;
}
.option-field {
  display: grid;
  gap: 4px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.options-hint {
  margin: 0;
  color: var(--color-txt-4);
  font-size: 9.5px;
  line-height: 1.6;
}
.sql-preview {
  min-height: 0;
  flex: 1;
  overflow: auto;
  margin: 10px;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background: color-mix(in oklch, var(--color-panel) 78%, transparent);
  padding: 14px;
  color: var(--color-txt-2);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  box-shadow: inset 0 1px rgb(255 255 255 / 3%);
}
.designer-footer {
  display: flex;
  min-height: 30px;
  flex: none;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--color-line-soft);
  padding: 0 12px;
  background: color-mix(in oklch, var(--color-panel) 70%, transparent);
  backdrop-filter: blur(14px);
}
.validation-error {
  display: flex;
  min-width: 0;
  max-width: 60%;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--color-danger);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .designer-actions .btn:not(.btn-primary) {
    display: none;
  }
}
</style>
