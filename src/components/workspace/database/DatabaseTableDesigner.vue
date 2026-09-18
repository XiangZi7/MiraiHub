<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
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
</script>

<template>
  <div class="table-designer">
    <header class="designer-header">
      <div class="title-group">
        <span class="title-icon"
          ><AppIcon
            name="lucide:table-properties"
            :size="17"
        /></span>
        <div>
          <h2>{{ editing ? t('设计表') : t('新建数据表') }}</h2>
          <p v-if="editing">
            {{ draft.schema }} · <span class="text-txt-2">{{ draft.name }}</span>
          </p>
          <p v-else>
            {{
              databaseKind === 'mysql' ? t('MySQL 数据库') : 'PostgreSQL Schema'
            }}
            · {{ schema }}
          </p>
        </div>
      </div>
      <div class="header-actions">
        <AppButton
          size="sm"
          class="h-7"
          :disabled="!hasChanges"
          @click="openSqlQuery"
          ><AppIcon
            name="lucide:square-terminal"
            :size="11"
          />
          {{ t('在查询中打开') }}
        </AppButton>
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
    </header>

    <section class="general-card">
      <label class="field-label table-name">
        {{ t('表名') }}
        <AppInput
          v-model="draft.name"
          size="sm"
          monospace
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('表名')"
      /></label>
      <label class="field-label">
        {{ t('数据库 / Schema') }}
        <AppInput
          v-model="draft.schema"
          size="sm"
          monospace
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('数据库或 Schema')"
      /></label>
      <div
        v-if="databaseKind === 'mysql'"
        class="field-label"
      >
        <span> {{ t('存储引擎') }} </span
        ><AppSelect
          v-model="draft.engine"
          :label="t('存储引擎')"
          :options="engineOptions"
          hide-label
          compact
        />
      </div>
      <div
        v-if="databaseKind === 'mysql'"
        class="field-label"
      >
        <span> {{ t('字符集') }} </span
        ><AppSelect
          v-model="draft.charset"
          :label="t('字符集')"
          :options="charsetOptions"
          hide-label
          compact
        />
      </div>
      <label class="field-label comment-field">
        {{ t('表备注') }}
        <AppInput
          v-model="draft.comment"
          size="sm"
          :placeholder="t('可选，用于说明表的用途')"
          :aria-label="t('表备注')"
      /></label>
    </section>

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
          v-model="draft.columns"
          :database-kind="databaseKind"
          :extra-types="extraTypes"
        />
        <DatabaseTableIndexesEditor
          v-show="activePanel === 'indexes'"
          v-model="draft.indexes"
          :columns="draft.columns"
          :database-kind="databaseKind"
        />
        <DatabaseTableForeignKeysEditor
          v-show="activePanel === 'foreignKeys'"
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
          <div class="options-heading">
            <div>
              <h3>{{ t('表选项') }}</h3>
              <p>{{ t('修改自增计数器等表级选项，随“保存修改”一起应用。') }}</p>
            </div>
          </div>
          <div class="options-grid">
            <template v-if="databaseKind === 'mysql'">
              <label class="field-label">
                <span>{{ t('自增值（AUTO_INCREMENT）') }}</span>
                <AppInput
                  v-model="autoIncrementInput"
                  size="sm"
                  monospace
                  autocomplete="off"
                  inputmode="numeric"
                  :placeholder="t('当前值 {value0}，留空表示不修改', { value0: currentAutoIncrementLabel() })"
                  :aria-label="t('自增值')"
              /></label>
              <p class="options-hint">
                {{
                  hasAutoIncrementColumn
                    ? t('下一个插入行将从这个值开始递增。')
                    : t('表当前没有自增字段；先在字段页勾选自增后，这里才会生效。')
                }}
              </p>
            </template>
            <template v-else>
              <label class="field-label">
                <span>{{ t('自增值（RESTART WITH）') }}</span>
                <AppInput
                  v-model="autoIncrementInput"
                  size="sm"
                  monospace
                  autocomplete="off"
                  inputmode="numeric"
                  :placeholder="t('当前值 {value0}，留空表示不修改', { value0: currentAutoIncrementLabel() })"
                  :aria-label="t('自增值')"
              /></label>
              <p class="options-hint">
                {{ t('只对 identity 自增列生效；serial 序列列保存时会提示改用 ALTER SEQUENCE。') }}
              </p>
            </template>
            <p class="options-note">
              {{ t('存储引擎、字符集与表备注在上方常规区域修改。') }}
            </p>
          </div>
        </section>
        <section
          v-show="activePanel === 'sql'"
          class="sql-panel"
        >
          <div class="sql-heading">
            <div>
              <h3>{{ editing ? t('ALTER TABLE 预览') : t('SQL 预览') }}</h3>
              <p>
                {{
                  editing
                    ? t('与当前表结构对比实时生成，可复制或转到查询页继续编辑。')
                    : t('根据当前配置实时生成，可复制或转到查询页继续编辑。')
                }}
              </p>
            </div>
            <AppButton
              size="sm"
              class="h-7"
              :disabled="!hasChanges"
              @click="copySql"
              ><AppIcon
                name="lucide:copy"
                :size="11"
              />
              {{ t('复制 SQL') }}
            </AppButton>
          </div>
          <pre class="sql-preview scroll-thin"><code>{{ sqlPreview }}</code></pre>
        </section>
      </template>
    </main>

    <footer class="designer-footer">
      <div
        v-if="validation.valid"
        class="validation validation-ok"
      >
        <AppIcon
          name="lucide:circle-check"
          :size="12"
        />
        {{ t('database.validTable') }}
      </div>
      <div
        v-else
        class="validation validation-error"
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
.designer-header {
  display: flex;
  min-height: 62px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 9px 14px;
  background: color-mix(in oklch, var(--color-panel) 70%, transparent);
  backdrop-filter: blur(18px) saturate(145%);
}
.title-group,
.header-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.title-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid
    color-mix(in oklch, var(--color-accent) 32%, var(--color-line));
  border-radius: 9px;
  background: color-mix(in oklch, var(--color-accent) 9%, transparent);
  color: var(--color-accent);
  box-shadow: inset 0 1px rgb(255 255 255 / 5%);
}
.title-group h2 {
  color: var(--color-txt);
  font-size: 13px;
  font-weight: 600;
}
.title-group p {
  margin-top: 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.general-card {
  display: grid;
  flex: none;
  grid-template-columns:
    minmax(180px, 1.2fr) minmax(150px, 1fr)
    120px 120px minmax(180px, 1.4fr);
  gap: 8px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 10px 12px;
  background:
    linear-gradient(110deg, rgb(255 255 255 / 2.5%), transparent 45%),
    color-mix(in oklch, var(--color-card) 66%, transparent);
}
.field-label {
  display: grid;
  gap: 4px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.designer-tabs {
  display: flex;
  height: 36px;
  flex: none;
  align-items: stretch;
  gap: 1px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 10px;
  background: color-mix(in oklch, var(--color-panel) 54%, transparent);
}
.designer-tab {
  position: relative;
  display: flex;
  min-width: 82px;
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
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
}
.options-heading {
  display: flex;
  min-height: 58px;
  flex: none;
  align-items: center;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 9px 12px;
}
.options-heading h3 {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
}
.options-heading p {
  margin-top: 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.options-grid {
  display: grid;
  max-width: 560px;
  gap: 10px;
  padding: 14px 12px;
}
.options-hint,
.options-note {
  margin: 0;
  color: var(--color-txt-4);
  font-size: 9.5px;
  line-height: 1.6;
}
.options-note {
  grid-column: 1 / -1;
}
.sql-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.sql-heading {
  display: flex;
  min-height: 58px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 9px 12px;
}
.sql-heading h3 {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
}
.sql-heading p {
  margin-top: 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.sql-preview {
  min-height: 0;
  flex: 1;
  overflow: auto;
  margin: 12px;
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
  min-height: 34px;
  flex: none;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--color-line-soft);
  padding: 0 12px;
  background: color-mix(in oklch, var(--color-panel) 70%, transparent);
  backdrop-filter: blur(14px);
}
.validation {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  font-size: 9.5px;
}
.validation-ok {
  color: var(--color-accent);
}
.validation-error {
  max-width: 48%;
  overflow: hidden;
  color: var(--color-danger);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .general-card {
    grid-template-columns: 1fr 1fr 100px 100px;
  }
  .comment-field {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .general-card {
    grid-template-columns: 1fr 1fr;
  }
  .table-name,
  .comment-field {
    grid-column: 1 / -1;
  }
  .designer-header {
    align-items: flex-start;
  }
  .header-actions .btn {
    display: none;
  }
}
</style>
