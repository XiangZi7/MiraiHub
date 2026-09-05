export type TabCloseScope = 'current' | 'others' | 'left' | 'right' | 'all'
export interface ClosableTab {
  id: string
  closable?: boolean
}
/** Take a snapshot in displayed order; a stale target must never turn into close-all. */
export function tabCloseTargets(
  tabs: readonly ClosableTab[],
  targetId: string,
  scope: TabCloseScope
): string[] {
  const targetIndex = tabs.findIndex(tab => tab.id === targetId)
  if (targetIndex < 0) return []
  return tabs
    .filter(
      (tab, index) =>
        tab.closable &&
        (scope === 'all' ||
          (scope === 'current' && index === targetIndex) ||
          (scope === 'others' && index !== targetIndex) ||
          (scope === 'left' && index < targetIndex) ||
          (scope === 'right' && index > targetIndex))
    )
    .map(tab => tab.id)
}
/** Keep the active survivor; otherwise prefer the nearest surviving tab on the right. */
export function activeAfterTabClose(
  tabs: readonly { id: string }[],
  activeId: string,
  closingIds: readonly string[]
): string {
  const closing = new Set(closingIds)
  const index = tabs.findIndex(tab => tab.id === activeId)
  if (index >= 0 && !closing.has(activeId)) return activeId
  return (
    tabs.slice(Math.max(index, 0)).find(tab => !closing.has(tab.id))?.id ??
    [...tabs.slice(0, Math.max(index, 0))]
      .reverse()
      .find(tab => !closing.has(tab.id))?.id ??
    ''
  )
}
