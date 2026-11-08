<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import { useDatabaseAi } from '@/composables/useDatabaseAi'
import { toast } from '@/composables/useToast'
import type { DatabaseKind, DatabaseObject } from '@/types/database'
import type { DatabaseTableDetail } from '@/types/database'
import type {
  TableDesignerDraft,
  TableDesignerColumn,
  TableDesignerIndex,
  TableIndexKind,
  ReferentialAction,
  TableDesignerTrigger,
  TriggerEvent,
} from '@/types/database-designer'
import {
  buildAlterTableStatements,
  buildCreateTableStatements,
  columnTypes,
  droppableTriggerFunctions,
  summarizeTableChanges,
  designerColumnFromStored,
  designerIndexFromStored,
  normalizeDataTypeLabel,
  sqliteTableChecks,
  validateTableDraft,
} from '@/utils/database-ddl'
import { copyText } from '@/utils/clipboard'
import { tableDesignerSnapshot } from '@/utils/database-designer'
import DatabaseTableChecksEditor from './designer/DatabaseTableChecksEditor.vue'
import DatabaseTableDdlPreview from './designer/DatabaseTableDdlPreview.vue'
import DatabaseTableTriggersEditor from './designer/DatabaseTableTriggersEditor.vue'
import DatabaseTableFieldsEditor from './designer/DatabaseTableFieldsEditor.vue'
import DatabaseTableForeignKeysEditor from './designer/DatabaseTableForeignKeysEditor.vue'
import DatabaseTableIndexesEditor from './designer/DatabaseTableIndexesEditor.vue'
import DatabaseTableOptionsEditor from './designer/DatabaseTableOptionsEditor.vue'

const { t } = useI18n()

type DesignerPanel =
  | 'columns'
  | 'indexes'
  | 'foreignKeys'
  | 'checks'
  | 'triggers'
  | 'options'
  | 'sql'

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  schema: string
  objects: readonly DatabaseObject[]
  /** 编辑模式：要设计的现有表；不传为新建表。 */
  editTable?: { schema: string; name: string } | null
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
const loadError = ref('')
const extraTypes = ref<string[]>([])

/** 新建表时的默认草稿：一个自增主键 id。 */
function defaultDraft(schema: string): TableDesignerDraft {
  return {
    schema,
    name: 'new_table',
    comment: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: '',
    rowFormat: '',
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
    checks: [],
    triggers: [],
    partition: null,
  }
}

const draft = reactive<TableDesignerDraft>(defaultDraft(props.schema))
const baseline = ref(tableDesignerSnapshot(draft))
// 基线版本：每次重新记录基线时递增，结构未变（快照相同）时也能刷新基线字段。
const baselineVersion = ref(0)
const activePanel = ref<DesignerPanel>('columns')
const creating = ref(false)
const applying = ref(false)
const referencedColumns = reactive<Record<string, string[]>>({})
const loadingReference = ref('')

const validation = computed(() =>
  validateTableDraft({
    kind: props.databaseKind,
    draft,
    extraTypes: extraTypes.value,
  })
)

const alterResult = computed(() => {
  const current = currentDetail.value
  if (!editing.value || !current || !validation.value.valid || !dirty.value)
    return { sql: '', statements: [] as string[], error: '' }
  try {
    const statements = buildAlterTableStatements({
      kind: props.databaseKind,
      current,
      draft,
      extraTypes: extraTypes.value,
    })
    return { sql: joinStatements(statements), statements, error: '' }
  } catch (cause) {
    return {
      sql: '',
      statements: [] as string[],
      error: database.errorMessage(cause),
    }
  }
})

/** 新建表的语句列表；配置不完整时为空。 */
const createStatements = computed(() => {
  if (editing.value) return [] as string[]
  try {
    return buildCreateTableStatements({
      kind: props.databaseKind,
      draft,
      extraTypes: extraTypes.value,
    })
  } catch {
    return [] as string[]
  }
})

/** 把语句列表拼成可读、可直接粘贴执行的 SQL 文本。 */
function joinStatements(statements: readonly string[]): string {
  return statements.map(statement => `${statement};`).join('\n\n')
}

/** 保存前展示的变更摘要。 */
const changeSummary = computed(() => {
  if (editing.value && !currentDetail.value) return []
  if (!validation.value.valid) return []
  return summarizeTableChanges(
    props.databaseKind,
    editing.value ? currentDetail.value : null,
    draft
  )
})

const sqlPreview = computed(() => {
  if (editing.value) {
    if (loadError.value) return `-- ${loadError.value}`
    if (!currentDetail.value) return t('-- 正在读取表结构…')
    if (!validation.value.valid)
      return t('-- 完成必填配置后将在这里生成 ALTER TABLE SQL')
    return (
      alterResult.value.sql ||
      `-- ${alterResult.value.error || t('没有需要保存的修改')}`
    )
  }
  if (!createStatements.value.length)
    return t('-- 完成必填配置后将在这里生成 CREATE TABLE SQL')
  return joinStatements(createStatements.value)
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
    id: 'checks' as const,
    label: t('检查约束'),
    icon: 'lucide:shield-check',
    count: draft.checks?.length ?? 0,
  },
  {
    id: 'triggers' as const,
    label: t('触发器'),
    icon: 'lucide:zap',
    count: draft.triggers?.length ?? 0,
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

const fieldsEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableFieldsEditor>>('fieldsEditor')
const indexesEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableIndexesEditor>>(
    'indexesEditor'
  )
const foreignKeysEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableForeignKeysEditor>>(
    'foreignKeysEditor'
  )
const checksEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableChecksEditor>>('checksEditor')
const triggersEditor =
  useTemplateRef<InstanceType<typeof DatabaseTableTriggersEditor>>(
    'triggersEditor'
  )

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
    case 'checks':
      return {
        label: t('添加检查约束'),
        run: () => checksEditor.value?.add(),
      }
    case 'triggers':
      return {
        label: t('添加触发器'),
        run: () => triggersEditor.value?.add(),
      }
    default:
      return null
  }
})

let loadVersion = 0
/**
 * 读取表详情。SQLite 后端不返回检查约束，这里从建表 DDL 里解析出表级 CHECK，
 * 让设计器能展示和编辑（保存时通过重建表生效）；DDL 解析不了时保持只读。
 */
async function readTableDetail(
  schema: string,
  name: string
): Promise<DatabaseTableDetail> {
  const detail = await database.tableDetail(props.sessionId, schema, name, 'table')
  if (props.databaseKind !== 'sqlite') return detail
  return { ...detail, checks: sqliteTableChecks(detail.ddl) }
}

/** 读取要编辑的现有表结构并灌入草稿，同时重置撤销历史。 */
async function loadEditTarget(): Promise<void> {
  const version = ++loadVersion
  const target = props.editTable
  loadError.value = ''
  currentDetail.value = null
  if (!props.sessionId || !target) {
    loadingDetail.value = false
    return
  }
  loadingDetail.value = true
  try {
    const detail = await readTableDetail(target.schema, target.name)
    if (version !== loadVersion) return
    currentDetail.value = detail
    hydrateFromDetail(detail)
    baseline.value = tableDesignerSnapshot(draft)
    baselineVersion.value++
    resetHistory()
  } catch (cause) {
    if (version !== loadVersion) return
    loadError.value = database.errorMessage(cause)
    toast.error({
      title: t('读取表结构失败'),
      description: database.errorMessage(cause),
    })
  } finally {
    if (version === loadVersion) loadingDetail.value = false
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
  Object.assign(draft, draftFromDetail(detail))
}

/** 由表结构生成一份独立草稿；加载编辑目标与 MySQL 失败后推导逆向语句时共用。 */
function draftFromDetail(detail: DatabaseTableDetail): TableDesignerDraft {
  const kind = props.databaseKind
  const indexes = detail.indexes.flatMap((index, position) => {
    const item = designerIndexFromStored(
      index,
      detail.columns,
      kind,
      `index-${index.name}-${position}`
    )
    return item ? [item] : []
  })

  const foreignKeys = detail.foreignKeys.map((foreignKey, index) => ({
    id: `fk-${foreignKey.name}-${index}`,
    name: foreignKey.name,
    columns: [...foreignKey.columns],
    referencedSchema: foreignKey.referencedSchema,
    referencedTable: foreignKey.referencedTable,
    referencedColumns: [...foreignKey.referencedColumns],
    onDelete: (foreignKey.deleteRule || 'NO ACTION') as ReferentialAction,
    onUpdate: (foreignKey.updateRule || 'NO ACTION') as ReferentialAction,
  }))

  return {
    schema: detail.schema,
    name: detail.name,
    comment: detail.options?.comment ?? '',
    engine: detail.options?.engine ?? '',
    charset: detail.options?.charset ?? '',
    collation: detail.options?.collation ?? '',
    rowFormat: detail.options?.rowFormat?.toUpperCase() ?? '',
    autoIncrement: detail.options?.autoIncrement ?? null,
    columns: detail.columns.map((column, index) =>
      designerColumnFromStored(
        column,
        kind,
        detail,
        `column-${Date.now()}-${index}`
      )
    ),
    indexes,
    foreignKeys,
    // 后端没读到（如 SQLite）时保持 undefined，差异生成就不会去动库里的对象。
    checks: detail.checks?.map((check, index) => ({
      id: `check-${check.name}-${index}`,
      name: check.name,
      expression: check.expression,
    })),
    triggers: detail.triggers?.map(
      (trigger, index): TableDesignerTrigger => ({
        id: `trigger-${trigger.name}-${index}`,
        name: trigger.name,
        timing: trigger.timing.toUpperCase() === 'AFTER' ? 'AFTER' : 'BEFORE',
        events: trigger.events.map(
          event => event.toUpperCase() as TriggerEvent
        ),
        level:
          trigger.level?.toUpperCase() === 'STATEMENT' ? 'STATEMENT' : 'ROW',
        body: trigger.body,
        functionName: trigger.function ?? '',
      })
    ),
    keepTriggerFunctions: [],
    partition: null,
    partitionChanges: [],
  }
}

/** 本次删除的 PostgreSQL 触发器里，可随触发器一起删除的专属触发函数。 */
const droppableFunctions = computed(() =>
  editing.value
    ? droppableTriggerFunctions(props.databaseKind, currentDetail.value, draft)
    : []
)

/** 勾选 / 取消“同时删除触发器函数”；取消的函数记入保留列表，SQL 预览随之更新。 */
function setDropTriggerFunction(name: string, drop: boolean): void {
  const keep = new Set(draft.keepTriggerFunctions ?? [])
  if (drop) keep.delete(name)
  else keep.add(name)
  draft.keepTriggerFunctions = [...keep]
}

onMounted(() => {
  void loadEditTarget()
})

watch(
  () => [props.sessionId, props.editTable],
  () => {
    void loadEditTarget()
  }
)

/** 读取引用表字段并缓存，供外键的引用字段下拉联动。 */
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

/** 复制当前 SQL 预览。 */
async function copySql(): Promise<void> {
  if (!hasChanges.value) return
  await copyText(sqlPreview.value)
  toast.success(editing.value ? t('修改 SQL 已复制') : t('建表 SQL 已复制'))
}

/** 把 SQL 送到查询页，由用户自行执行。 */
function openSqlQuery(): void {
  if (!hasChanges.value) return
  emit('query', sqlPreview.value)
}

/** 保存前确认对话框是否打开。 */
const confirmOpen = ref(false)
/** 最近一次执行失败的详情，在 SQL 预览中展示；MySQL 部分生效时附带已执行语句与建议的逆向语句。 */
const lastFailure = ref<{
  statement: string
  error: string
  rolledBack: boolean
  executed: number
  executedStatements: string[]
  reverseStatements: string[]
} | null>(null)
const transactional = computed(() => props.databaseKind !== 'mysql')

/** 点击创建 / 保存：先校验，再弹出变更摘要确认。 */
function requestSave(): void {
  if (!validation.value.valid) {
    toast.warning(validation.value.errors[0] ?? t('请完善建表配置'))
    return
  }
  if (editing.value) {
    if (!currentDetail.value) return
    if (alterResult.value.error) {
      toast.warning(alterResult.value.error)
      return
    }
    if (!alterResult.value.statements.length) {
      toast.info(t('没有需要保存的修改'))
      return
    }
  } else if (!createStatements.value.length) {
    toast.warning(t('请完善建表配置'))
    return
  }
  confirmOpen.value = true
}

/** 确认后执行：按语句列表走 executeDdl，PostgreSQL / SQLite 在事务中执行。 */
async function confirmSave(): Promise<void> {
  confirmOpen.value = false
  if (editing.value) await applyChanges()
  else await createTable()
}

/**
 * 执行 DDL 语句列表；失败时记录出错语句并切到 SQL 预览展示。
 * 返回 true 表示全部成功。
 */
async function runStatements(
  statements: string[],
  failureTitle: string
): Promise<boolean> {
  lastFailure.value = null
  try {
    const result = await database.executeDdl(props.sessionId, statements)
    if (!result.error) return true
    lastFailure.value = {
      statement: result.failedStatement ?? '',
      error: result.error,
      rolledBack: result.rolledBack,
      executed: result.executed,
      executedStatements: result.rolledBack
        ? []
        : statements
            .filter(statement => statement.trim())
            .slice(0, result.executed),
      reverseStatements: [],
    }
    activePanel.value = 'sql'
    toast.error({
      title: failureTitle,
      description: result.rolledBack
        ? t('第 {value0} 条语句执行失败，已回滚全部修改：{value1}', {
            value0: (result.failedIndex ?? 0) + 1,
            value1: result.error,
          })
        : t('第 {value0} 条语句执行失败，此前 {value1} 条已生效：{value2}', {
            value0: (result.failedIndex ?? 0) + 1,
            value1: result.executed,
            value2: result.error,
          }),
    })
    return false
  } catch (cause) {
    toast.error({
      title: failureTitle,
      description: database.errorMessage(cause),
    })
    return false
  }
}

/** 执行建表语句。 */
async function createTable(): Promise<void> {
  creating.value = true
  try {
    const ok = await runStatements(
      [...createStatements.value],
      t('创建数据表失败')
    )
    if (!ok) return
    baseline.value = tableDesignerSnapshot(draft)
    baselineVersion.value++
    emit('dirty', false)
    emit('created', draft.schema, draft.name)
  } finally {
    creating.value = false
  }
}

/** 执行修改表结构的语句；非事务方言部分成功时刷新库中结构，保留草稿以便继续修正。 */
async function applyChanges(): Promise<void> {
  const current = currentDetail.value
  if (!current) return
  applying.value = true
  try {
    const ok = await runStatements(
      [...alterResult.value.statements],
      t('保存表结构修改失败')
    )
    if (!ok) {
      if (lastFailure.value?.executed && !lastFailure.value.rolledBack) {
        await refreshCurrentDetail()
        const after = currentDetail.value
        if (lastFailure.value && after && after !== current)
          lastFailure.value.reverseStatements = suggestReverseStatements(
            current,
            after
          )
      }
      return
    }
    baseline.value = tableDesignerSnapshot(draft)
    baselineVersion.value++
    emit('dirty', false)
    emit('applied', draft.schema, draft.name)
  } finally {
    applying.value = false
  }
}

/**
 * MySQL 部分执行失败后，按“刷新后的结构 → 保存前的结构”反向求差，给出建议的逆向语句。
 * 只作展示供用户手动执行；被删字段的数据无法找回，生成失败时返回空列表。
 */
function suggestReverseStatements(
  before: DatabaseTableDetail,
  after: DatabaseTableDetail
): string[] {
  try {
    const target = draftFromDetail(before)
    // 已生效的字段改名：反向草稿以新名作为原名，否则会被当成删列再加列。
    const afterNames = new Set(after.columns.map(column => column.name))
    const renamed = new Map<string, string>()
    for (const column of draft.columns) {
      const name = column.name.trim()
      if (
        column.originalName &&
        column.originalName !== name &&
        afterNames.has(name) &&
        !afterNames.has(column.originalName)
      )
        renamed.set(column.originalName, name)
    }
    target.columns = target.columns.map(column => ({
      ...column,
      originalName: renamed.get(column.name) ?? column.originalName,
    }))
    return buildAlterTableStatements({
      kind: props.databaseKind,
      current: after,
      draft: target,
      extraTypes: extraTypes.value,
    })
  } catch {
    return []
  }
}

/** 复制建议的逆向语句。 */
async function copyReverseSql(): Promise<void> {
  const statements = lastFailure.value?.reverseStatements ?? []
  if (!statements.length) return
  await copyText(joinStatements(statements))
  toast.success(t('逆向语句已复制'))
}

/** 把建议的逆向语句送到查询页，由用户确认后手动执行。 */
function openReverseQuery(): void {
  const statements = lastFailure.value?.reverseStatements ?? []
  if (statements.length) emit('query', joinStatements(statements))
}

/** 只刷新库中现有结构（不覆盖草稿），让后续差异基于已生效的部分。 */
async function refreshCurrentDetail(): Promise<void> {
  const target = props.editTable
  if (!target) return
  try {
    currentDetail.value = await readTableDetail(target.schema, target.name)
  } catch {
    // 刷新失败时保留旧结构，用户可手动点刷新。
  }
}

const hasChanges = computed(() => {
  if (
    loadingDetail.value ||
    loadError.value ||
    creating.value ||
    applying.value
  )
    return false
  if (!editing.value) return createStatements.value.length > 0
  return Boolean(alterResult.value.sql)
})

// 是否需要关闭确认与 SQL 能否执行分开：无效输入同样是未保存修改。
const dirty = computed(() => {
  if (editing.value && (loadingDetail.value || !currentDetail.value))
    return false
  return tableDesignerSnapshot(draft) !== baseline.value
})
watch(dirty, value => emit('dirty', value), { immediate: true, flush: 'sync' })

/** 还原到最近一次读取 / 保存的状态。 */
function resetDraft(): void {
  if (currentDetail.value) hydrateFromDetail(currentDetail.value)
  else Object.assign(draft, defaultDraft(props.schema))
}

/** 字段编辑器回传：联动索引外键，并维护自增计数器。 */
function updateColumns(columns: TableDesignerColumn[]): void {
  const previouslyIncrementing = draft.columns.some(
    column => column.autoIncrement
  )
  cascadeColumnChanges(draft.columns, columns)
  draft.columns = columns
  const incrementing = columns.filter(column => column.autoIncrement)
  if (!incrementing.length) draft.autoIncrement = null
  else if (
    !previouslyIncrementing &&
    incrementing.length === 1 &&
    currentDetail.value?.columns.some(
      column => column.name === incrementing[0].name && column.autoIncrement
    )
  ) {
    draft.autoIncrement = currentDetail.value.options?.autoIncrement ?? null
  }
}

/**
 * 字段改名、删除时同步索引和外键，避免改个名字就让索引“包含不存在的字段”。
 * 按编辑器 ID 对应前后字段；新名字和其他字段撞名时不动，交给校验提示。
 */
function cascadeColumnChanges(
  previous: readonly TableDesignerColumn[],
  next: readonly TableDesignerColumn[]
): void {
  const nextById = new Map(next.map(column => [column.id, column]))
  const nextNames = new Set(next.map(column => column.name))
  const renames = new Map<string, string>()
  const removed = new Set<string>()
  for (const column of previous) {
    const updated = nextById.get(column.id)
    if (!updated) {
      if (!nextNames.has(column.name)) removed.add(column.name)
    } else if (
      updated.name !== column.name &&
      updated.name &&
      next.filter(item => item.name === updated.name).length === 1
    )
      renames.set(column.name, updated.name)
  }
  if (!renames.size && !removed.size) return

  draft.indexes = draft.indexes.flatMap(index => {
    const options = index.columnOptions ?? {}
    const columns: string[] = []
    const columnOptions: NonNullable<TableDesignerIndex['columnOptions']> = {}
    for (const column of index.columns) {
      if (options[column]?.expression) {
        columns.push(column)
        columnOptions[column] = options[column]
        continue
      }
      if (removed.has(column)) continue
      const name = renames.get(column) ?? column
      columns.push(name)
      if (options[column]) columnOptions[name] = options[column]
    }
    if (!columns.length) return []
    return [{ ...index, columns, columnOptions }]
  })
  // 多列外键：删掉被移除字段对应的那一对，全空时整条外键移除。
  draft.foreignKeys = draft.foreignKeys.flatMap(foreignKey => {
    const keep = foreignKey.columns
      .map((column, index) => ({ column, index }))
      .filter(item => !removed.has(item.column))
    if (!keep.length) return []
    return [
      {
        ...foreignKey,
        columns: keep.map(item => renames.get(item.column) ?? item.column),
        referencedColumns: keep.map(
          item => foreignKey.referencedColumns[item.index] ?? ''
        ),
      },
    ]
  })
}

// ---------- 撤销 / 重做 ----------
/** 草稿的完整快照（含编辑器 id，恢复后行身份不变）。 */
const historyPast: string[] = []
const historyFuture: string[] = []
let historyCurrent = JSON.stringify(draft)
let historyStamp = 0
let restoring = false
const historyVersion = ref(0)
const canUndo = computed(
  () => historyVersion.value >= 0 && historyPast.length > 0
)
const canRedo = computed(
  () => historyVersion.value >= 0 && historyFuture.length > 0
)

/** 清空撤销历史（读取表结构、复制结构后调用）。 */
function resetHistory(): void {
  historyPast.length = 0
  historyFuture.length = 0
  historyCurrent = JSON.stringify(draft)
  historyStamp = 0
  historyVersion.value++
}

watch(
  () => JSON.stringify(draft),
  value => {
    if (restoring || value === historyCurrent) return
    const now = Date.now()
    // 连续输入 600ms 内合并成一步，避免每个字符一步。
    if (now - historyStamp > 600 || !historyPast.length) {
      historyPast.push(historyCurrent)
      if (historyPast.length > 100) historyPast.shift()
    }
    historyStamp = now
    historyCurrent = value
    historyFuture.length = 0
    historyVersion.value++
  }
)

/** 把草稿恢复为指定快照。 */
function restoreSnapshot(snapshot: string): void {
  restoring = true
  const value = JSON.parse(snapshot) as TableDesignerDraft
  draft.checks = undefined
  draft.triggers = undefined
  draft.partition = null
  draft.partitionChanges = undefined
  Object.assign(draft, value)
  historyCurrent = snapshot
  historyStamp = 0
  historyVersion.value++
  void nextTick(() => {
    restoring = false
  })
}

/** 撤销一步。 */
function undo(): void {
  const previous = historyPast.pop()
  if (previous === undefined) return
  historyFuture.push(historyCurrent)
  restoreSnapshot(previous)
}

/** 重做一步。 */
function redo(): void {
  const next = historyFuture.pop()
  if (next === undefined) return
  historyPast.push(historyCurrent)
  restoreSnapshot(next)
}

/** Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做；多行文本框内保留原生撤销。 */
function onDesignerKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (event.target instanceof HTMLTextAreaElement) return
  if (editorDisabled.value || confirmOpen.value) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault()
    undo()
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault()
    redo()
  }
}

// ---------- 从模板 / 现有表复制结构 ----------
const copyingStructure = ref(false)
const templateOptions = computed(() => [
  { value: 'template:basic', label: t('模板：基础表（主键 + 时间戳）') },
  { value: 'template:log', label: t('模板：日志表') },
  ...tableObjects.value.map(object => ({
    value: `table:${object.schema}.${object.name}`,
    label: `${t('复制表')}：${object.schema}.${object.name}`,
  })),
])

/** 生成模板字段。 */
function templateColumn(
  name: string,
  dataType: string,
  patch: Partial<TableDesignerColumn> = {}
): TableDesignerColumn {
  return {
    id: `column-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    dataType,
    length: '',
    nullable: true,
    primaryKey: false,
    unique: false,
    unsigned: false,
    autoIncrement: false,
    defaultValue: '',
    comment: '',
    ...patch,
  }
}

/** 应用内置模板，覆盖当前草稿的字段与索引。 */
function applyTemplate(name: string): void {
  const kind = props.databaseKind
  const timestampType =
    kind === 'postgresql' ? 'TIMESTAMP' : kind === 'mysql' ? 'DATETIME' : 'TEXT'
  const id = templateColumn('id', kind === 'sqlite' ? 'INTEGER' : 'BIGINT', {
    nullable: false,
    primaryKey: true,
    unsigned: kind === 'mysql',
    autoIncrement: true,
    comment: t('主键'),
  })
  const timestamp = (column: string) =>
    templateColumn(column, timestampType, {
      nullable: false,
      defaultValue: 'CURRENT_TIMESTAMP',
    })
  const base = defaultDraft(draft.schema)
  base.name = draft.name
  base.columns =
    name === 'log'
      ? [
          id,
          templateColumn('level', 'VARCHAR', { length: '16', nullable: false }),
          templateColumn('message', 'TEXT'),
          timestamp('created_at'),
        ]
      : [id, timestamp('created_at'), timestamp('updated_at')]
  Object.assign(draft, base)
}

/** 从模板或现有表复制结构到新建表草稿；约束、索引、触发器名加后缀避免与原表冲突。 */
async function copyStructure(value: string): Promise<void> {
  if (!value || editing.value) return
  if (value.startsWith('template:')) {
    applyTemplate(value.slice('template:'.length))
    return
  }
  const object = tableObjects.value.find(
    item => `table:${item.schema}.${item.name}` === value
  )
  if (!object) return
  copyingStructure.value = true
  try {
    const detail = await readTableDetail(object.schema, object.name)
    hydrateFromDetail(detail)
    const suffix = '_copy'
    draft.schema = props.schema || detail.schema
    draft.name = `${detail.name}${suffix}`
    draft.autoIncrement = null
    draft.columns = draft.columns.map(column => ({
      ...column,
      originalName: undefined,
    }))
    draft.indexes = draft.indexes.map(index => ({
      ...index,
      name: `${index.name}${suffix}`,
    }))
    draft.foreignKeys = draft.foreignKeys.map(foreignKey => ({
      ...foreignKey,
      name: `${foreignKey.name}${suffix}`,
    }))
    draft.checks = (draft.checks ?? []).map(check => ({
      ...check,
      name: `${check.name}${suffix}`,
    }))
    draft.triggers = (draft.triggers ?? []).map(trigger => ({
      ...trigger,
      name: `${trigger.name}${suffix}`,
      functionName: '',
    }))
    toast.success(t('已复制表结构，请检查后创建'))
  } catch (cause) {
    toast.error({
      title: t('读取表结构失败'),
      description: database.errorMessage(cause),
    })
  } finally {
    copyingStructure.value = false
  }
}

const editorDisabled = computed(
  () =>
    loadingDetail.value ||
    Boolean(loadError.value) ||
    creating.value ||
    applying.value
)

/** 各标签页是否有校验错误，用于标签上的红点。 */
const panelErrors = computed<Partial<Record<DesignerPanel, boolean>>>(() => {
  const has = (record?: Record<string, string[]>) =>
    Object.values(record ?? {}).some(list => list.length > 0)
  return {
    columns: has(validation.value.columnErrors),
    indexes: has(validation.value.indexErrors),
    foreignKeys: has(validation.value.foreignKeyErrors),
    checks: has(validation.value.checkErrors),
    triggers: has(validation.value.triggerErrors),
    sql: Boolean(alterResult.value.error || lastFailure.value),
  }
})

// 基线字段：读取 / 保存时记录，用于在字段表格里标出改过的单元格。
const baselineColumns = shallowRef<TableDesignerColumn[]>([])
watch(
  baselineVersion,
  () => {
    baselineColumns.value = JSON.parse(
      JSON.stringify(draft.columns)
    ) as TableDesignerColumn[]
  },
  { immediate: true, flush: 'sync' }
)

// ---------- AI 辅助 ----------
type DesignerAiMode = 'generate' | 'comments' | 'review'
interface DesignerAiReviewItem {
  level: 'error' | 'warning' | 'info'
  target: string
  message: string
}
const ai = useDatabaseAi()
const aiMenu = reactive({ open: false, x: 0, y: 0 })
const aiTrigger = shallowRef<HTMLElement | null>(null)
const aiMode = ref<DesignerAiMode | null>(null)
const aiInstruction = ref('')
const aiProposal = shallowRef<{
  name: string
  comment: string
  columns: TableDesignerColumn[]
  indexes: TableDesignerIndex[]
} | null>(null)
const aiComments = shallowRef<{
  table: string
  columns: { id: string; name: string; comment: string }[]
} | null>(null)
const aiReview = shallowRef<DesignerAiReviewItem[] | null>(null)
const aiMenuItems = computed(() => [
  {
    id: 'generate',
    label: t('AI 生成表结构'),
    icon: 'lucide:wand-sparkles',
    iconTone: 'violet' as const,
  },
  {
    id: 'comments',
    label: t('AI 补全注释'),
    icon: 'lucide:message-square-text',
    iconTone: 'violet' as const,
    disabled: !draft.columns.length,
  },
  {
    id: 'review',
    label: t('AI 审查设计'),
    icon: 'lucide:scan-search',
    iconTone: 'violet' as const,
    disabled: !draft.columns.length,
  },
])
const aiTitle = computed(
  () =>
    ({
      generate: t('AI 生成表结构'),
      comments: t('AI 补全注释'),
      review: t('AI 审查设计'),
    })[aiMode.value ?? 'generate']
)

/** 点击 AI 按钮：在按钮下方展开 AI 功能菜单，再次点击收起。 */
function toggleAiMenu(event: MouseEvent): void {
  if (aiMenu.open) {
    aiMenu.open = false
    return
  }
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  aiTrigger.value = element
  aiMenu.x = rect.left
  aiMenu.y = rect.bottom + 4
  aiMenu.open = true
}

/** 选择 AI 功能：生成需先填写描述，补全注释与审查直接发起请求。 */
function chooseAi(id: string): void {
  aiMenu.open = false
  aiMode.value = id as DesignerAiMode
  aiProposal.value = null
  aiComments.value = null
  aiReview.value = null
  if (id !== 'generate') void runAi()
}

/** 关闭 AI 对话框并中止进行中的请求。 */
function closeAi(): void {
  ai.cancel()
  aiMode.value = null
}

/** 把当前草稿压缩成发给模型的 JSON，只保留结构要素，省 token。 */
function draftForAi(): string {
  return JSON.stringify({
    table: draft.name,
    comment: draft.comment,
    columns: draft.columns.map(column => ({
      name: column.name,
      type: column.length
        ? `${column.dataType}(${column.length})`
        : column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      unique: column.unique,
      autoIncrement: column.autoIncrement,
      default: column.defaultValue || undefined,
      comment: column.comment || undefined,
    })),
    indexes: draft.indexes.map(index => ({
      name: index.name,
      kind: index.kind,
      columns: index.columns,
    })),
    foreignKeys: draft.foreignKeys.map(foreignKey => ({
      columns: foreignKey.columns,
      references: `${foreignKey.referencedTable}(${foreignKey.referencedColumns.join(', ')})`,
    })),
  })
}

/** 按模式拼出给模型的指令，明确要求的 JSON 输出格式。 */
function aiPrompt(mode: DesignerAiMode): string {
  const types = columnTypes(props.databaseKind).join(', ')
  if (mode === 'generate')
    return [
      `Design a ${props.databaseKind} table from this description: ${aiInstruction.value.trim()}`,
      'If CURRENT SQL has columns, treat it as the starting point and return the complete revised table.',
      `Use only these column types: ${types}. Put length/precision (e.g. "64" or "10,2") in "length", without parentheses in "type".`,
      'Use snake_case names. Every column and the table must have a comment in the requested language.',
      'Return JSON: {"name":"table_name","comment":"...","columns":[{"name":"","type":"","length":"","nullable":true,"primaryKey":false,"unique":false,"autoIncrement":false,"default":"","comment":""}],"indexes":[{"name":"","kind":"index|unique","columns":[""]}]}',
      'Do not list the primary key in "indexes".',
    ].join('\n')
  if (mode === 'comments')
    return [
      'Write concise comments for the table and every column in CURRENT SQL, inferred from names and types.',
      'Return JSON: {"table":"table comment","columns":{"column_name":"comment"}}',
    ].join('\n')
  return [
    `Review this ${props.databaseKind} table design: naming conventions, data type choices, missing indexes (for foreign keys and likely filter columns), primary key, nullability, and normalization.`,
    'Return at most 12 concrete findings, most important first, as JSON: {"items":[{"level":"error|warning|info","target":"column or index name, or table","message":"problem and the suggested fix"}]}',
  ].join('\n')
}

/** 从模型回复中取出 JSON 对象：优先 ```json 代码块，否则取第一个到最后一个花括号之间的内容。 */
function parseAiJson(text: string): Record<string, unknown> {
  const block = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)?.[1] ?? text
  const start = block.indexOf('{')
  const end = block.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(t('AI 返回的内容无法解析'))
  return JSON.parse(block.slice(start, end + 1)) as Record<string, unknown>
}

/** 校验 AI 给出的默认值：只放行数字、引号字符串、NULL/布尔与常见无参函数，其余按字符串字面量转义，避免把 SQL 片段拼进 DDL。 */
function aiDefaultValue(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  if (/^-?\d+(\.\d+)?$/u.test(value)) return value
  if (/^'(?:[^']|'')*'$/u.test(value)) return value
  if (
    /^(NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIMESTAMP|NOW\(\)|CURRENT_TIMESTAMP\(\d\)|UUID\(\)|GEN_RANDOM_UUID\(\))$/iu.test(
      value
    )
  )
    return value.toUpperCase()
  return `'${value.replace(/'/gu, "''")}'`
}

/** 把模型给出的字段转成设计器字段；类型统一大写，类型里带的括号长度拆到长度列。 */
function aiColumn(raw: Record<string, unknown>): TableDesignerColumn | null {
  const name = String(raw.name ?? '').trim()
  if (!name) return null
  let dataType = String(raw.type ?? 'VARCHAR')
    .trim()
    .toUpperCase()
  let length = String(raw.length ?? '').trim()
  const inline = /^([^(]+)\((.*)\)$/u.exec(dataType)
  if (inline) {
    dataType = inline[1].trim()
    length ||= inline[2].trim()
  }
  const primaryKey = raw.primaryKey === true
  const autoIncrement = raw.autoIncrement === true
  return templateColumn(
    name,
    normalizeDataTypeLabel(dataType, props.databaseKind),
    {
      length: /^\d+(,\d+)?$/u.test(length.replace(/\s+/gu, ''))
        ? length.replace(/\s+/gu, '')
        : '',
      nullable: !primaryKey && raw.nullable !== false,
      primaryKey,
      unique: raw.unique === true && !primaryKey,
      unsigned: props.databaseKind === 'mysql' && autoIncrement,
      autoIncrement,
      defaultValue: autoIncrement ? '' : aiDefaultValue(raw.default),
      comment: String(raw.comment ?? '').trim(),
    }
  )
}

/** 把模型给出的索引转成设计器索引；引用了不存在字段的索引项会被丢弃。 */
function aiIndexes(
  items: unknown,
  names: ReadonlySet<string>
): TableDesignerIndex[] {
  return (Array.isArray(items) ? items : []).flatMap(
    (item, position): TableDesignerIndex[] => {
      const raw = item as Record<string, unknown>
      const columns = (Array.isArray(raw.columns) ? raw.columns : [])
        .map(String)
        .filter(name => names.has(name))
      if (!columns.length) return []
      const kind: TableIndexKind = raw.kind === 'unique' ? 'unique' : 'index'
      return [
        {
          id: `index-ai-${Date.now()}-${position}`,
          name: String(raw.name ?? '').trim() || `idx_${columns.join('_')}`,
          kind,
          method: 'btree',
          columns,
          columnOptions: {},
        },
      ]
    }
  )
}

/** 发起当前模式的 AI 请求，并把结果解析成可预览的提案；失败统一走通知。 */
async function runAi(): Promise<void> {
  const mode = aiMode.value
  if (!mode) return
  if (mode === 'generate' && !aiInstruction.value.trim()) {
    toast.warning(t('请先描述要创建的表'))
    return
  }
  aiProposal.value = null
  aiComments.value = null
  aiReview.value = null
  try {
    const result = await ai.run({
      mode: 'design',
      instruction: aiPrompt(mode),
      sql: draftForAi(),
    })
    if (!result || aiMode.value !== mode) return
    const data = parseAiJson(result.text)
    if (mode === 'generate') {
      const columns = (Array.isArray(data.columns) ? data.columns : [])
        .map(item => aiColumn(item as Record<string, unknown>))
        .filter((item): item is TableDesignerColumn => Boolean(item))
      if (!columns.length) throw new Error(t('AI 返回的内容无法解析'))
      aiProposal.value = {
        name: String(data.name ?? '').trim() || draft.name,
        comment: String(data.comment ?? '').trim(),
        columns,
        indexes: aiIndexes(
          data.indexes,
          new Set(columns.map(column => column.name))
        ),
      }
    } else if (mode === 'comments') {
      const map = (data.columns ?? {}) as Record<string, unknown>
      aiComments.value = {
        table: draft.comment.trim() ? '' : String(data.table ?? '').trim(),
        columns: draft.columns.flatMap(column => {
          const comment = String(map[column.name] ?? '').trim()
          return !column.comment.trim() && comment
            ? [{ id: column.id, name: column.name, comment }]
            : []
        }),
      }
    } else {
      aiReview.value = (Array.isArray(data.items) ? data.items : []).map(
        item => {
          const raw = item as Record<string, unknown>
          const level = String(raw.level)
          return {
            level: level === 'error' || level === 'warning' ? level : 'info',
            target: String(raw.target ?? ''),
            message: String(raw.message ?? ''),
          }
        }
      )
    }
  } catch (cause) {
    toast.error({
      title: t('AI 请求失败'),
      description:
        cause instanceof SyntaxError
          ? t('AI 返回的内容无法解析')
          : database.errorMessage(cause),
    })
  }
}

/** 应用 AI 生成的表结构：新建表时整体替换；编辑已有表时旧字段只合并类型/长度/注释且全部保留，避免生成 DROP COLUMN 丢数据。 */
function applyAiProposal(): void {
  const proposal = aiProposal.value
  if (!proposal) return
  if (!editing.value) draft.name = proposal.name
  if (proposal.comment) draft.comment = proposal.comment
  const previous = new Map(draft.columns.map(column => [column.name, column]))
  const byOriginal = new Map(
    draft.columns
      .filter(column => column.originalName)
      .map(column => [column.originalName as string, column])
  )
  const matched = new Set<string>()
  const columns = proposal.columns.map(column => {
    const old = previous.get(column.name) ?? byOriginal.get(column.name)
    if (!old || matched.has(old.id)) return column
    matched.add(old.id)
    // 只覆盖 AI 明确给出的属性；AI 未给出的长度、默认值、备注和 unsigned 等沿用原值
    return {
      ...old,
      name: column.name,
      dataType: column.dataType,
      length: column.length || old.length,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      unique: column.unique,
      autoIncrement: column.autoIncrement,
      unsigned: old.unsigned || column.unsigned,
      defaultValue: column.autoIncrement
        ? ''
        : column.defaultValue || old.defaultValue,
      comment: column.comment || old.comment,
    }
  })
  // 编辑已有表时，AI 结果里缺失的原有字段一律保留，避免悄悄生成 DROP COLUMN 丢数据
  if (editing.value) {
    const taken = new Set(columns.map(column => column.name))
    columns.push(
      ...draft.columns.filter(
        column =>
          column.originalName && !matched.has(column.id) && !taken.has(column.name)
      )
    )
  }
  const names = new Set(columns.map(column => column.name))
  const kept = draft.indexes.filter(index =>
    index.columns.every(
      name => names.has(name) || index.columnOptions?.[name]?.expression
    )
  )
  const keptNames = new Set(kept.map(index => index.name))
  draft.columns = columns
  // 外键引用的本地字段已不存在时一并移除，避免草稿校验失败或执行时报依赖错误
  draft.foreignKeys = draft.foreignKeys.filter(key =>
    key.columns.every(name => names.has(name))
  )
  draft.indexes = [
    ...kept,
    ...proposal.indexes.filter(index => !keptNames.has(index.name)),
  ]
  activePanel.value = 'columns'
  closeAi()
  toast.success(t('已应用 AI 生成的表结构，可撤销'))
}

/** 应用 AI 注释：只填写原本为空的表备注和字段备注。 */
function applyAiComments(): void {
  const result = aiComments.value
  if (!result) return
  let filled = 0
  if (result.table && !draft.comment.trim()) {
    draft.comment = result.table
    filled++
  }
  const comments = new Map(result.columns.map(item => [item.id, item.comment]))
  draft.columns = draft.columns.map(column => {
    const comment = comments.get(column.id)
    if (!comment || column.comment.trim()) return column
    filled++
    return { ...column, comment }
  })
  closeAi()
  toast.success(t('已补全 {value0} 处注释', { value0: filled }))
}
</script>

<template>
  <div
    class="table-designer"
    @keydown="onDesignerKeydown"
  >
    <!-- 常规属性一行放下：标签横排在输入框前，标题交给标签页显示 -->
    <fieldset
      class="general-bar"
      :disabled="editorDisabled"
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
      <div
        v-if="!editing"
        class="general-field w-60 flex-none"
      >
        <AppSelect
          model-value=""
          :label="t('从模板或现有表复制结构')"
          :placeholder="
            copyingStructure ? t('正在读取表结构…') : t('从模板或现有表复制结构')
          "
          :options="templateOptions"
          :disabled="copyingStructure"
          hide-label
          compact
          searchable
          @update:model-value="copyStructure"
        />
      </div>
      <label class="general-field comment-field">
        <span>{{ t('表备注') }}</span>
        <AppInput
          v-model="draft.comment"
          size="sm"
          :placeholder="t('可选，用于说明表的用途')"
          :aria-label="t('表备注')"
        />
      </label>
    </fieldset>

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
            'designer-tab motion-safe:transition-colors',
            activePanel === item.id && 'designer-tab-active',
          ]"
          :aria-current="activePanel === item.id ? 'page' : undefined"
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
          ><span
            v-if="panelErrors[item.id]"
            class="bg-danger absolute top-1.5 right-1 size-1.5 rounded-full"
            :aria-label="t('存在错误')"
            role="img"
          />
        </AppButton>
      </nav>
      <div class="designer-actions">
        <AppButton
          size="sm"
          class="text-violet h-7"
          :disabled="editorDisabled"
          :aria-expanded="aiMenu.open"
          aria-haspopup="menu"
          @click="toggleAiMenu"
          ><AppIcon
            :name="ai.loading.value ? 'lucide:loader-circle' : 'lucide:sparkles'"
            :size="11"
            :class="ai.loading.value && 'motion-safe:animate-spin'"
          />AI<AppIcon
            name="lucide:chevron-down"
            :size="10"
        /></AppButton>
        <AppButton
          size="sm"
          class="h-7"
          :disabled="!canUndo || editorDisabled"
          :title="t('撤销 (Ctrl+Z)')"
          :aria-label="t('撤销 (Ctrl+Z)')"
          @click="undo"
          ><AppIcon
            name="lucide:undo-2"
            :size="11"
        /></AppButton>
        <AppButton
          size="sm"
          class="h-7"
          :disabled="!canRedo || editorDisabled"
          :title="t('重做 (Ctrl+Y)')"
          :aria-label="t('重做 (Ctrl+Y)')"
          @click="redo"
          ><AppIcon
            name="lucide:redo-2"
            :size="11"
        /></AppButton>
        <AppButton
          size="sm"
          class="h-7"
          :disabled="!dirty || editorDisabled"
          @click="resetDraft"
        >
          {{ t('还原修改') }}
        </AppButton>
        <AppButton
          v-if="editing"
          size="sm"
          class="h-7"
          :disabled="dirty || loadingDetail || applying"
          @click="loadEditTarget"
        >
          <AppIcon
            name="lucide:refresh-cw"
            :size="11"
          />{{ t('刷新') }}
        </AppButton>
        <AppButton
          v-if="addAction"
          size="sm"
          class="h-7"
          :disabled="editorDisabled"
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
          :disabled="creating || !hasChanges"
          @click="requestSave"
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
          @click="requestSave"
          ><AppIcon
            :name="applying ? 'lucide:loader-circle' : 'lucide:check'"
            :size="12"
            :class="applying && 'animate-spin'"
          />{{ applying ? t('正在保存…') : t('保存修改') }}</AppButton
        >
      </div>
      <slot name="toolbar" />
    </div>

    <fieldset
      class="designer-body"
      :disabled="editorDisabled"
    >
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
      <div
        v-else-if="loadError"
        class="validation-error p-6"
        role="alert"
      >
        {{ loadError }}
      </div>
      <template v-else>
        <DatabaseTableFieldsEditor
          v-show="activePanel === 'columns'"
          ref="fieldsEditor"
          class="panel-fade-in"
          :baseline="editing ? baselineColumns : undefined"
          :model-value="draft.columns"
          @update:model-value="updateColumns"
          :database-kind="databaseKind"
          :extra-types="extraTypes"
          :editing="editing"
          :session-id="sessionId"
          :table-collation="draft.collation"
          :errors="validation.columnErrors"
        />
        <DatabaseTableIndexesEditor
          v-show="activePanel === 'indexes'"
          ref="indexesEditor"
          class="panel-fade-in"
          v-model="draft.indexes"
          :columns="draft.columns"
          :database-kind="databaseKind"
          :errors="validation.indexErrors"
        />
        <DatabaseTableForeignKeysEditor
          v-show="activePanel === 'foreignKeys'"
          ref="foreignKeysEditor"
          class="panel-fade-in"
          v-model="draft.foreignKeys"
          :columns="draft.columns"
          :schema="draft.schema"
          :tables="tableObjects"
          :referenced-columns="referencedColumns"
          :loading-reference="loadingReference"
          :database-kind="databaseKind"
          :errors="validation.foreignKeyErrors"
          @inspect-table="inspectReference"
        />
        <template v-if="activePanel === 'checks'">
          <DatabaseTableChecksEditor
            v-if="draft.checks"
            ref="checksEditor"
            class="panel-fade-in"
            v-model="draft.checks"
            :database-kind="databaseKind"
            :editing="editing"
            :errors="validation.checkErrors"
          />
          <p
            v-else
            class="text-txt-4 p-6 text-[11px]"
          >
            {{ t('当前数据库未返回检查约束信息，暂不支持在此编辑。') }}
          </p>
        </template>
        <template v-if="activePanel === 'triggers'">
          <DatabaseTableTriggersEditor
            v-if="draft.triggers"
            ref="triggersEditor"
            class="panel-fade-in"
            v-model="draft.triggers"
            :database-kind="databaseKind"
            :errors="validation.triggerErrors"
          />
          <p
            v-else
            class="text-txt-4 p-6 text-[11px]"
          >
            {{ t('当前数据库未返回触发器信息，暂不支持在此编辑。') }}
          </p>
          <div
            v-if="droppableFunctions.length"
            class="border-line-soft bg-card/60 mx-3 mb-3 grid shrink-0 gap-2 rounded-lg border p-3"
          >
            <p
              class="text-txt-3 flex items-center gap-1.5 text-[10.5px] font-semibold"
            >
              <AppIcon
                name="lucide:trash-2"
                :size="12"
              />
              {{ t('已删除触发器的专属函数') }}
            </p>
            <AppCheckbox
              v-for="item in droppableFunctions"
              :key="item.function"
              :model-value="!draft.keepTriggerFunctions?.includes(item.function)"
              :label="
                t('同时删除触发器函数 {value0}', { value0: item.function })
              "
              :description="
                t('该函数仅被触发器 {value0} 使用，取消勾选则保留函数。', {
                  value0: item.trigger,
                })
              "
              @update:model-value="
                setDropTriggerFunction(item.function, Boolean($event))
              "
            />
          </div>
        </template>
        <DatabaseTableOptionsEditor
          v-show="activePanel === 'options'"
          class="panel-fade-in"
          v-model:engine="draft.engine"
          v-model:charset="draft.charset"
          v-model:collation="draft.collation"
          v-model:row-format="draft.rowFormat"
          v-model:comment="draft.comment"
          v-model:auto-increment="draft.autoIncrement"
          v-model:partition="draft.partition"
          v-model:partition-changes="draft.partitionChanges"
          :session-id="sessionId"
          :database-kind="databaseKind"
          :columns="draft.columns"
          :current="currentDetail"
          :editing="editing"
        />
        <DatabaseTableDdlPreview
          v-if="activePanel === 'sql'"
          class="panel-fade-in"
          :sql="hasChanges ? sqlPreview : ''"
          :error="
            lastFailure
              ? t('执行失败的语句：{value0}\n错误：{value1}', {
                  value0: lastFailure.statement,
                  value1: lastFailure.error,
                })
              : !hasChanges && !loadingDetail
                ? sqlPreview.replace(/^--\s*/u, '')
                : ''
          "
          :changes="changeSummary"
          :editing="editing"
          :transactional="transactional"
          :executed-statements="lastFailure?.executedStatements"
          :reverse-statements="lastFailure?.reverseStatements"
          @copy="copySql"
          @copy-reverse="copyReverseSql"
          @query-reverse="openReverseQuery"
        />
      </template>
    </fieldset>

    <AppDialog
      v-if="confirmOpen"
      :title="editing ? t('确认保存表结构修改') : t('确认创建数据表')"
      :description="
        transactional
          ? t('保存时在事务中执行，任一语句失败将整体回滚。')
          : t('MySQL 的 DDL 会隐式提交，失败前已执行的语句无法回滚。')
      "
      wide
      @close="confirmOpen = false"
    >
      <div class="grid gap-3 p-4">
        <p
          v-if="!transactional"
          role="note"
          class="bg-orange/10 text-orange flex items-start gap-1.5 rounded-md px-2.5 py-2 text-[11px] leading-relaxed"
        >
          <AppIcon
            name="lucide:triangle-alert"
            :size="13"
            class="mt-0.5 shrink-0"
          />
          {{
            t(
              'MySQL 不支持 DDL 事务：每条语句执行后立即生效，中途失败时之前的语句不会回滚。失败后会列出已生效的语句，并尽量给出逆向语句供手动恢复。'
            )
          }}
        </p>
        <ul class="scroll-thin grid max-h-48 gap-1 overflow-y-auto text-[11px]">
          <li
            v-for="(change, index) in changeSummary"
            :key="index"
            class="text-txt-2 flex items-center gap-1.5"
          >
            <span
              class="rounded px-1.5 py-0.5 text-[10px]"
              :class="{
                'bg-success/10 text-success': change.action === 'add',
                'bg-orange/10 text-orange': change.action === 'modify',
                'bg-danger/10 text-danger': change.action === 'remove',
                'bg-blue/10 text-blue': change.action === 'rename',
              }"
              >{{
                {
                  add: t('新增'),
                  modify: t('修改'),
                  remove: t('删除'),
                  rename: t('重命名'),
                }[change.action]
              }}</span
            >
            {{ t(change.target) }}
            <code class="font-mono">{{ change.name }}</code>
            <span
              v-if="change.detail"
              class="text-txt-4"
              >（{{ change.detail }}）</span
            >
          </li>
        </ul>
        <p class="text-txt-4 text-[10px]">
          {{
            t('共 {value0} 条语句将被执行，可在 SQL 预览中查看完整内容。', {
              value0: editing
                ? alterResult.statements.length
                : createStatements.length,
            })
          }}
        </p>
      </div>
      <template #footer>
        <AppButton
          size="sm"
          @click="confirmOpen = false"
          >{{ t('取消') }}</AppButton
        >
        <AppButton
          variant="primary"
          size="sm"
          @click="confirmSave"
          >{{ editing ? t('保存修改') : t('创建表') }}</AppButton
        >
      </template>
    </AppDialog>

    <AppContextMenu
      :open="aiMenu.open"
      :x="aiMenu.x"
      :y="aiMenu.y"
      :items="aiMenuItems"
      :label="t('AI 辅助')"
      :trigger="aiTrigger"
      @close="aiMenu.open = false"
      @select="chooseAi"
    />

    <AppDialog
      v-if="aiMode"
      :title="aiTitle"
      :description="
        aiMode === 'generate'
          ? t('用自然语言描述表的用途和字段，生成后先预览再应用。')
          : aiMode === 'comments'
            ? t('只会填写当前为空的表备注和字段备注。')
            : t('从命名、类型选择、索引和范式角度检查当前设计。')
      "
      wide
      @close="closeAi"
    >
      <div class="grid gap-3 p-4 text-[11px]">
        <template v-if="aiMode === 'generate'">
          <AppTextarea
            v-model="aiInstruction"
            :label="t('表结构描述')"
            :rows="3"
            :placeholder="t('例如：订单表，包含用户、金额、状态、下单时间，按用户和状态查询')"
            @keydown.ctrl.enter.prevent="runAi"
          />
          <div class="flex justify-end">
            <AppButton
              variant="primary"
              size="sm"
              :disabled="ai.loading.value || !aiInstruction.trim()"
              @click="runAi"
              ><AppIcon
                :name="ai.loading.value ? 'lucide:loader-circle' : 'lucide:sparkles'"
                :size="11"
                :class="ai.loading.value && 'motion-safe:animate-spin'"
              />{{ aiProposal ? t('重新生成') : t('生成') }}</AppButton
            >
          </div>
        </template>

        <div
          v-if="ai.loading.value"
          class="text-txt-3 flex items-center gap-2"
          role="status"
        >
          <AppIcon
            name="lucide:loader-circle"
            :size="13"
            class="motion-safe:animate-spin"
          />{{ t('AI 正在分析…') }}
        </div>

        <div
          v-if="aiProposal"
          class="border-line-soft pop-in grid gap-2 rounded-lg border p-2.5"
        >
          <p class="text-txt-2 flex items-center gap-1.5">
            <code class="font-mono">{{ aiProposal.name }}</code>
            <span class="text-txt-4 truncate">{{ aiProposal.comment }}</span>
          </p>
          <div class="scroll-thin max-h-64 overflow-auto">
            <table class="w-full text-left text-[10.5px]">
              <thead class="text-txt-4 bg-card sticky top-0">
                <tr>
                  <th class="px-1.5 py-1 font-normal">{{ t('字段名') }}</th>
                  <th class="px-1.5 py-1 font-normal">{{ t('类型') }}</th>
                  <th class="px-1.5 py-1 font-normal">{{ t('属性') }}</th>
                  <th class="px-1.5 py-1 font-normal">{{ t('备注') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="column in aiProposal.columns"
                  :key="column.id"
                  class="border-line-soft hover:bg-violet/4 border-t"
                >
                  <td class="px-1.5 py-1 font-mono">{{ column.name }}</td>
                  <td class="px-1.5 py-1 font-mono">
                    {{ column.dataType
                    }}{{ column.length ? `(${column.length})` : '' }}
                  </td>
                  <td class="text-txt-3 px-1.5 py-1">
                    {{
                      [
                        column.primaryKey && 'PK',
                        column.autoIncrement && 'AI',
                        column.unique && 'UQ',
                        !column.nullable && 'NOT NULL',
                        column.defaultValue && `= ${column.defaultValue}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </td>
                  <td class="text-txt-3 px-1.5 py-1">{{ column.comment }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul
            v-if="aiProposal.indexes.length"
            class="text-txt-3 grid gap-0.5"
          >
            <li
              v-for="index in aiProposal.indexes"
              :key="index.id"
            >
              <span class="text-txt-4">{{
                index.kind === 'unique' ? t('唯一索引') : t('索引')
              }}</span>
              <code class="ml-1 font-mono"
                >{{ index.name }} ({{ index.columns.join(', ') }})</code
              >
            </li>
          </ul>
          <p
            v-if="draft.columns.length > 1"
            class="text-amber text-[10px]"
          >
            {{ t('应用后将用生成的字段替换当前字段列表，可使用撤销恢复。') }}
          </p>
        </div>

        <div
          v-if="aiComments"
          class="border-line-soft pop-in grid gap-1 rounded-lg border p-2.5"
        >
          <p
            v-if="!aiComments.table && !aiComments.columns.length"
            class="text-txt-4"
          >
            {{ t('没有需要补全的注释') }}
          </p>
          <p v-if="aiComments.table">
            <span class="text-txt-4">{{ t('表备注') }}：</span
            >{{ aiComments.table }}
          </p>
          <div class="scroll-thin max-h-64 overflow-auto">
            <p
              v-for="item in aiComments.columns"
              :key="item.id"
              class="flex gap-2 py-0.5"
            >
              <code class="text-txt-2 w-36 shrink-0 truncate font-mono">{{
                item.name
              }}</code
              ><span class="text-txt-3">{{ item.comment }}</span>
            </p>
          </div>
        </div>

        <div
          v-if="aiReview"
          class="pop-in scroll-thin grid max-h-80 gap-1.5 overflow-auto"
        >
          <p
            v-if="!aiReview.length"
            class="text-success flex items-center gap-1.5"
          >
            <AppIcon
              name="lucide:circle-check"
              :size="12"
            />{{ t('未发现明显问题') }}
          </p>
          <div
            v-for="(item, index) in aiReview"
            :key="index"
            class="border-line-soft flex items-start gap-2 rounded-md border px-2 py-1.5"
          >
            <span
              class="mt-px shrink-0 rounded px-1.5 py-0.5 text-[9.5px]"
              :class="{
                'bg-danger/10 text-danger': item.level === 'error',
                'bg-amber/10 text-amber': item.level === 'warning',
                'bg-blue/10 text-blue': item.level === 'info',
              }"
              >{{
                { error: t('问题'), warning: t('建议'), info: t('提示') }[
                  item.level
                ]
              }}</span
            >
            <div class="min-w-0">
              <code
                v-if="item.target"
                class="text-txt-2 font-mono"
                >{{ item.target }}</code
              >
              <p class="text-txt-3">{{ item.message }}</p>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <AppButton
          size="sm"
          @click="closeAi"
          >{{ t('关闭') }}</AppButton
        >
        <AppButton
          v-if="aiMode !== 'generate' && !ai.loading.value"
          size="sm"
          @click="runAi"
          ><AppIcon
            name="lucide:refresh-cw"
            :size="11"
          />{{ t('重新生成') }}</AppButton
        >
        <AppButton
          v-if="aiProposal"
          variant="primary"
          size="sm"
          @click="applyAiProposal"
          >{{ t('应用到设计器') }}</AppButton
        >
        <AppButton
          v-if="aiComments && (aiComments.table || aiComments.columns.length)"
          variant="primary"
          size="sm"
          @click="applyAiComments"
          >{{ t('填入注释') }}</AppButton
        >
      </template>
    </AppDialog>

    <!-- 底栏只在出错时说话；没问题就安静地报个数 -->
    <footer class="designer-footer">
      <div
        v-if="!validation.valid || alterResult.error"
        class="validation-error"
        :title="validation.errors.join('\n')"
      >
        <AppIcon
          name="lucide:circle-alert"
          :size="12"
        />{{ validation.errors[0] || alterResult.error
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
  min-width: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 6px 12px;
  background:
    linear-gradient(110deg, var(--glass-highlight), transparent 45%),
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
.comment-field {
  flex: 2 1 220px;
}
.designer-toolbar {
  display: flex;
  min-height: 36px;
  flex-wrap: wrap;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 4px 8px 4px 4px;
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
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
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
