import type { ConnectionGroupView, SavedConnection } from '@/types/connection'

export const CONNECTION_SORT_OPTIONS = [
  { value: 'name-asc', label: '名称 A → Z' },
  { value: 'name-desc', label: '名称 Z → A' },
  { value: 'host', label: '主机地址' },
  { value: 'recent', label: '最近使用' },
] as const
export type ConnectionSort = (typeof CONNECTION_SORT_OPTIONS)[number]['value']

export function connectionList(
  groups: readonly ConnectionGroupView[],
  keyword: string,
  sort: ConnectionSort
): ConnectionGroupView[] {
  const terms = keyword.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  const compareText = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const compare = (a: SavedConnection, b: SavedConnection) => {
    if (sort === 'recent') {
      const difference = (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
      if (difference) return difference
    }
    if (sort === 'host') {
      const difference = compareText(a.host, b.host) || a.port - b.port
      if (difference) return difference
    }
    return compareText(a.name, b.name) * (sort === 'name-desc' ? -1 : 1)
  }
  const visibleGroups = groups
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => {
          const text = [
            group.name,
            item.name,
            item.host,
            item.port,
            item.username,
            item.description,
            ...item.tags,
          ]
            .join(' ')
            .toLocaleLowerCase()
          return terms.every(term => text.includes(term))
        })
        .sort(compare),
    }))
    .filter(
      group =>
        !terms.length ||
        group.items.length ||
        terms.every(term => group.name.toLocaleLowerCase().includes(term))
    )

  return visibleGroups
}
