<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, ref } from 'vue'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { toast } from '@/composables/useToast'
import type { DatabaseKind, DatabaseObject } from '@/types/database'
import type { TableDesignerDraft } from '@/types/database-designer'
import { buildCreateTableSql, validateTableDraft } from '@/utils/database-ddl'
import { copyText } from '@/utils/clipboard'
import DatabaseTableFieldsEditor from './designer/DatabaseTableFieldsEditor.vue'
import DatabaseTableForeignKeysEditor from './designer/DatabaseTableForeignKeysEditor.vue'
import DatabaseTableIndexesEditor from './designer/DatabaseTableIndexesEditor.vue'

const { t } = useI18n()

type DesignerPanel = 'columns' | 'indexes' | 'foreignKeys' | 'sql'

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  schema: string
  objects: readonly DatabaseObject[]
}>()

const emit = defineEmits<{
  created: [schema: string, name: string]
  query: [sql: string]
}>()

const draft = reactive<TableDesignerDraft>({
  schema: props.schema,
  name: 'new_table',
  comment: '',
  engine: 'InnoDB',
  charset: 'utf8mb4',
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
})
const activePanel = ref<DesignerPanel>('columns')
const creating = ref(false)
const referencedColumns = reactive<Record<string, string[]>>({})
const loadingReference = ref('')

const validation = computed(() =>
  validateTableDraft({ kind: props.databaseKind, draft })
)
const sqlPreview = computed(() => {
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
  if (!validation.value.valid) return
  await copyText(sqlPreview.value)
  toast.success(t('建表 SQL 已复制'))
}

function openSqlQuery(): void {
  if (!validation.value.valid) return
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
          <h2>{{ t('新建数据表') }}</h2>
          <p>
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
          :disabled="!validation.valid"
          @click="openSqlQuery"
          ><AppIcon
            name="lucide:square-terminal"
            :size="11"
          />
          {{ t('在查询中打开') }}
        </AppButton>
        <AppButton
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
      <DatabaseTableFieldsEditor
        v-show="activePanel === 'columns'"
        v-model="draft.columns"
        :database-kind="databaseKind"
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
        v-show="activePanel === 'sql'"
        class="sql-panel"
      >
        <div class="sql-heading">
          <div>
            <h3>{{ t('SQL 预览') }}</h3>
            <p>{{ t('根据当前配置实时生成，可复制或转到查询页继续编辑。') }}</p>
          </div>
          <AppButton
            size="sm"
            class="h-7"
            :disabled="!validation.valid"
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
