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
import AppIcon from '@/components/ui/AppIcon.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { toast } from '@/composables/useToast'
import type { DatabaseKind, DatabaseObject } from '@/types/database'
import type { DatabaseTableDetail } from '@/types/database'
import type {
  TableDesignerDraft,
  TableDesignerColumn,
  TableDesignerIndex,
  ReferentialAction,
  TableDesignerTrigger,
  TriggerEvent,
} from '@/types/database-designer'
import {
  buildAlterTableStatements,
  buildCreateTableStatements,
  columnTypes,
  summarizeTableChanges,
  designerColumnFromStored,
  designerIndexFromStored,
  normalizeDataTypeLabel,
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
    const detail = await database.tableDetail(
      props.sessionId,
      target.schema,
      target.name,
      'table'
    )
    if (version !== loadVersion) return
    currentDetail.value = detail
    hydrateFromDetail(detail)
    baseline.value = tableDesignerSnapshot(draft)
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

  draft.schema = detail.schema
  draft.name = detail.name
  draft.comment = detail.options?.comment ?? ''
  draft.engine = detail.options?.engine ?? ''
  draft.charset = detail.options?.charset ?? ''
  draft.collation = detail.options?.collation ?? ''
  draft.rowFormat = detail.options?.rowFormat?.toUpperCase() ?? ''
  draft.autoIncrement = detail.options?.autoIncrement ?? null
  draft.columns = detail.columns.map((column, index) =>
    designerColumnFromStored(
      column,
      kind,
      detail,
      `column-${Date.now()}-${index}`
    )
  )
  draft.indexes = indexes
  draft.foreignKeys = foreignKeys
  // 后端没读到（如 SQLite）时保持 undefined，差异生成就不会去动库里的对象。
  draft.checks = detail.checks?.map((check, index) => ({
    id: `check-${check.name}-${index}`,
    name: check.name,
    expression: check.expression,
  }))
  draft.triggers = detail.triggers?.map(
    (trigger, index): TableDesignerTrigger => ({
      id: `trigger-${trigger.name}-${index}`,
      name: trigger.name,
      timing: trigger.timing.toUpperCase() === 'AFTER' ? 'AFTER' : 'BEFORE',
      events: trigger.events.map(event => event.toUpperCase() as TriggerEvent),
      level: trigger.level?.toUpperCase() === 'STATEMENT' ? 'STATEMENT' : 'ROW',
      body: trigger.body,
      functionName: trigger.function ?? '',
    })
  )
  draft.partition = null
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
/** 最近一次执行失败的详情，在 SQL 预览中展示。 */
const lastFailure = ref<{
  statement: string
  error: string
  rolledBack: boolean
  executed: number
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
      if (lastFailure.value?.executed && !lastFailure.value.rolledBack)
        await refreshCurrentDetail()
      return
    }
    baseline.value = tableDesignerSnapshot(draft)
    emit('dirty', false)
    emit('applied', draft.schema, draft.name)
  } finally {
    applying.value = false
  }
}

/** 只刷新库中现有结构（不覆盖草稿），让后续差异基于已生效的部分。 */
async function refreshCurrentDetail(): Promise<void> {
  const target = props.editTable
  if (!target) return
  try {
    currentDetail.value = await database.tableDetail(
      props.sessionId,
      target.schema,
      target.name,
      'table'
    )
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
    const detail = await database.tableDetail(
      props.sessionId,
      object.schema,
      object.name,
      'table'
    )
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
          v-model="draft.indexes"
          :columns="draft.columns"
          :database-kind="databaseKind"
          :errors="validation.indexErrors"
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
          :database-kind="databaseKind"
          :errors="validation.foreignKeyErrors"
          @inspect-table="inspectReference"
        />
        <template v-if="activePanel === 'checks'">
          <DatabaseTableChecksEditor
            v-if="draft.checks"
            ref="checksEditor"
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
        </template>
        <DatabaseTableOptionsEditor
          v-show="activePanel === 'options'"
          v-model:engine="draft.engine"
          v-model:charset="draft.charset"
          v-model:collation="draft.collation"
          v-model:row-format="draft.rowFormat"
          v-model:comment="draft.comment"
          v-model:auto-increment="draft.autoIncrement"
          v-model:partition="draft.partition"
          :session-id="sessionId"
          :database-kind="databaseKind"
          :columns="draft.columns"
          :current="currentDetail"
          :editing="editing"
        />
        <DatabaseTableDdlPreview
          v-if="activePanel === 'sql'"
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
          @copy="copySql"
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
