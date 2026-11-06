import type { DatabaseTableDetail } from '@/types/database'

export interface ErNode {
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface ErEdge {
  from: string
  to: string
  label: string
}

export const ER_NODE_WIDTH = 220
export const ER_HEADER_HEIGHT = 30
export const ER_ROW_HEIGHT = 20
/** 单张表最多展示的字段数，超出部分折叠成“+N” */
export const ER_MAX_ROWS = 12

/**
 * 简单分层布局：被引用越多的表越靠左（层级 = 引用链深度），
 * 同层内按名称排列，再按列高度堆叠。足够让外键连线大致从右指向左。
 */
export function layoutErDiagram(tables: readonly DatabaseTableDetail[]): {
  nodes: ErNode[]
  edges: ErEdge[]
} {
  const names = new Set(tables.map(table => table.name))
  const edges: ErEdge[] = []
  for (const table of tables)
    for (const key of table.foreignKeys)
      if (names.has(key.referencedTable) && key.referencedTable !== table.name)
        edges.push({ from: table.name, to: key.referencedTable, label: key.columns.join(', ') })

  // 层级 = 沿外键指向的最长路径；用访问栈防环
  const depth = new Map<string, number>()
  const visit = (name: string, stack: Set<string>): number => {
    const cached = depth.get(name)
    if (cached !== undefined) return cached
    if (stack.has(name)) return 0
    stack.add(name)
    const parents = edges.filter(edge => edge.from === name).map(edge => edge.to)
    const level = parents.length ? Math.max(...parents.map(parent => visit(parent, stack))) + 1 : 0
    stack.delete(name)
    depth.set(name, level)
    return level
  }
  for (const table of tables) visit(table.name, new Set())

  const columns = new Map<number, DatabaseTableDetail[]>()
  for (const table of tables) {
    const level = depth.get(table.name) ?? 0
    columns.set(level, [...(columns.get(level) ?? []), table])
  }

  const nodes: ErNode[] = []
  for (const [level, group] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    let y = 20
    for (const table of group) {
      const rows = Math.min(table.columns.length, ER_MAX_ROWS) + (table.columns.length > ER_MAX_ROWS ? 1 : 0)
      const height = ER_HEADER_HEIGHT + rows * ER_ROW_HEIGHT + 8
      nodes.push({ name: table.name, x: 20 + level * (ER_NODE_WIDTH + 90), y, width: ER_NODE_WIDTH, height })
      y += height + 28
    }
  }
  return { nodes, edges }
}
