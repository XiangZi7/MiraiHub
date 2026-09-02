import type { CodeLine, DbNode, QueryRow } from '@/types'

/** 数据库对象树 */
export const DB_TREE: DbNode[] = [
  { id: 'production', label: 'production', icon: 'lucide:database', depth: 0, expanded: false },
  { id: 'tables', label: 'Tables', icon: 'lucide:table-2', depth: 0, expanded: true },
  { id: 'users', label: 'users', icon: 'lucide:table', depth: 1, leaf: true, active: true },
  { id: 'orders', label: 'orders', icon: 'lucide:table', depth: 1, leaf: true },
  { id: 'products', label: 'products', icon: 'lucide:table', depth: 1, leaf: true },
  { id: 'views', label: 'Views', icon: 'lucide:eye', depth: 0, leaf: true },
  { id: 'procedures', label: 'Procedures', icon: 'lucide:file-code-2', depth: 0, leaf: true },
  { id: 'functions', label: 'Functions', icon: 'lucide:function-square', depth: 0, leaf: true },
]

/** SQL 编辑器内容 */
export const SQL_LINES: CodeLine[] = [
  { no: 1, tokens: [{ text: 'SELECT', kind: 'keyword' }] },
  { no: 2, tokens: [{ text: '    u.id,' }] },
  { no: 3, tokens: [{ text: '    u.username,' }] },
  { no: 4, tokens: [{ text: '    u.email,' }] },
  { no: 5, tokens: [{ text: '    u.created_at' }] },
  { no: 16, tokens: [{ text: 'FROM', kind: 'keyword' }, { text: ' users u' }] },
  { no: 17, tokens: [{ text: 'WHERE', kind: 'keyword' }, { text: ' u.id > ' }, { text: '100', kind: 'num' }] },
  { no: 13, tokens: [{ text: 'ORDER BY', kind: 'keyword' }, { text: ' u.created_at ' }, { text: 'DESC', kind: 'keyword' }] },
  { no: 18, tokens: [{ text: 'LIMIT', kind: 'keyword' }, { text: ' ' }, { text: '100', kind: 'num' }, { text: ';' }] },
]

/** 查询结果集 */
export const QUERY_ROWS: QueryRow[] = [
  { id: 101, username: 'johndoe', email: 'john@example.com', createdAt: '2024-05-22 09:41:21' },
  { id: 102, username: 'janedoe', email: 'jane@example.com', createdAt: '2024-05-22 09:40:11' },
  { id: 103, username: 'alice', email: 'alice@example.com', createdAt: '2024-05-22 09:39:02' },
  { id: 104, username: 'bob', email: 'bob@example.com', createdAt: '2024-05-22 09:38:45' },
]
