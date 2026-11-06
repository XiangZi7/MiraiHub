import type { DatabaseKind } from '@/types/database'

/** 统一后的执行计划节点：两种方言的 JSON 结构差异很大，视图只认这一种。 */
export interface PlanNode {
  label: string
  /** 访问对象，如表名 / 索引名 */
  target?: string
  detail?: string
  /** 估算行数 */
  rows?: number
  /** 估算代价（PG total cost；MySQL query_cost / prefix_cost） */
  cost?: number
  /** 全表扫描等需要提示用户关注的节点 */
  warning?: boolean
  children: PlanNode[]
}

/** 将 PostgreSQL `EXPLAIN (FORMAT JSON)` 的 Plan 对象递归转换为统一节点。 */
function fromPostgres(plan: Record<string, unknown>): PlanNode {
  const type = String(plan['Node Type'] ?? 'Node')
  const target =
    (plan['Relation Name'] as string | undefined) ??
    (plan['Index Name'] as string | undefined)
  const filter = (plan['Filter'] ?? plan['Index Cond'] ?? plan['Hash Cond']) as
    | string
    | undefined
  return {
    label: type,
    target,
    detail: filter,
    rows: Number(plan['Plan Rows'] ?? 0) || undefined,
    cost: Number(plan['Total Cost'] ?? 0) || undefined,
    warning: type === 'Seq Scan',
    children: ((plan['Plans'] as Record<string, unknown>[] | undefined) ?? []).map(
      fromPostgres
    ),
  }
}

/** MySQL 的计划是嵌套对象而非节点数组，按已知容器键逐层展开。 */
function fromMysql(value: Record<string, unknown>, label = 'query_block'): PlanNode {
  const children: PlanNode[] = []
  const table = value['table'] as Record<string, unknown> | undefined
  const costInfo = (value['cost_info'] ?? table?.['cost_info']) as
    | Record<string, string>
    | undefined
  for (const [key, child] of Object.entries(value)) {
    if (key === 'table' || key === 'cost_info' || !child || typeof child !== 'object')
      continue
    if (Array.isArray(child)) {
      for (const item of child)
        if (item && typeof item === 'object')
          children.push(fromMysql(item as Record<string, unknown>, key))
    } else children.push(fromMysql(child as Record<string, unknown>, key))
  }
  if (table) {
    const access = String(table['access_type'] ?? '')
    return {
      label: access ? `${access.toUpperCase()} scan` : 'table',
      target: table['table_name'] as string | undefined,
      detail: [table['key'] && `key: ${table['key']}`, table['attached_condition']]
        .filter(Boolean)
        .join(' · '),
      rows: Number(table['rows_examined_per_scan'] ?? 0) || undefined,
      cost: Number(costInfo?.['prefix_cost'] ?? costInfo?.['read_cost'] ?? 0) || undefined,
      warning: access === 'ALL',
      children,
    }
  }
  return {
    label,
    cost: Number(costInfo?.['query_cost'] ?? 0) || undefined,
    children,
  }
}

/** SQLite 的 QUERY PLAN 是扁平的 (id, parent, detail) 列表，按 parent 组装成树。 */
function fromSqlite(rows: { id: number; parent: number; detail: string }[]): PlanNode {
  const nodes = new Map<number, PlanNode>()
  const root: PlanNode = { label: 'QUERY PLAN', children: [] }
  for (const row of rows) {
    const scan = /^(SCAN|SEARCH)/u.test(row.detail)
    nodes.set(row.id, {
      label: row.detail.split(' ').slice(0, 1).join(' ') || 'step',
      target: row.detail.match(/^(?:SCAN|SEARCH)\s+(\S+)/u)?.[1],
      detail: row.detail,
      warning: scan && row.detail.startsWith('SCAN') && !/USING/u.test(row.detail),
      children: [],
    })
  }
  for (const row of rows) (nodes.get(row.parent) ?? root).children.push(nodes.get(row.id)!)
  return root
}

/** 把后端返回的 EXPLAIN JSON 文本解析成统一计划树；结构无法识别时抛错。 */
export function parseExplainPlan(kind: DatabaseKind, json: string): PlanNode {
  const value = JSON.parse(json) as unknown
  if (kind === 'sqlite')
    return fromSqlite(value as { id: number; parent: number; detail: string }[])
  if (kind === 'postgresql') {
    const root = (Array.isArray(value) ? value[0] : value) as Record<string, unknown>
    const plan = root?.['Plan'] as Record<string, unknown> | undefined
    if (!plan) throw new Error('Unrecognized plan')
    return fromPostgres(plan)
  }
  const block = (value as Record<string, unknown>)?.['query_block']
  if (!block || typeof block !== 'object') throw new Error('Unrecognized plan')
  return fromMysql(block as Record<string, unknown>)
}

/** 计划树中的最大代价，视图用它换算每个节点的代价占比条。 */
export function maxPlanCost(node: PlanNode): number {
  return Math.max(node.cost ?? 0, ...node.children.map(maxPlanCost))
}
