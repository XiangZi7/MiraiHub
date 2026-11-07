
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
  baseline,
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
      length: length.replace(/\s+/gu, ''),
      nullable: !primaryKey && raw.nullable !== false,
      primaryKey,
      unique: raw.unique === true && !primaryKey,
      unsigned: props.databaseKind === 'mysql' && autoIncrement,
      autoIncrement,
      defaultValue: autoIncrement ? '' : String(raw.default ?? '').trim(),
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

/** 应用 AI 生成的表结构：同名字段沿用原行（保留改名关系），并入新索引；可用撤销回退。 */
function applyAiProposal(): void {
  const proposal = aiProposal.value
  if (!proposal) return
  if (!editing.value) draft.name = proposal.name
  if (proposal.comment) draft.comment = proposal.comment
  const previous = new Map(draft.columns.map(column => [column.name, column]))
  const columns = proposal.columns.map(column => {
    const old = previous.get(column.name)
    return old
      ? { ...old, ...column, id: old.id, originalName: old.originalName }
      : column
  })
  const names = new Set(columns.map(column => column.name))
  const kept = draft.indexes.filter(index =>
    index.columns.every(
      name => names.has(name) || index.columnOptions?.[name]?.expression
    )
  )
  const keptNames = new Set(kept.map(index => index.name))
  draft.columns = columns
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
