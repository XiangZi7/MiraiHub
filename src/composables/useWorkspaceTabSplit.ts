import {
  computed,
  inject,
  provide,
  shallowReactive,
  shallowRef,
  watch,
  type InjectionKey,
} from 'vue'
import type { SplitOrientation } from './useSplitPanes'
import type { TabDragEvent } from './useTabReorder'
import { splitDropAtPoint, type SplitDropPosition } from '@/utils/split-drop'

export interface WorkspaceTabGroup {
  type: 'group'
  id: string
  tabIds: string[]
  activeId: string
}
export interface WorkspaceSplitBranch {
  type: 'split'
  id: string
  orientation: SplitOrientation
  children: [WorkspaceSplitNode, WorkspaceSplitNode]
  ratios: [number, number]
}
export type WorkspaceSplitNode = WorkspaceTabGroup | WorkspaceSplitBranch
interface WorkspaceTabSplitOptions {
  tabs: () => readonly { id: string }[]
  activeId: () => string
  enabled: () => boolean
}
interface TabDropTarget {
  groupId: string
  position: SplitDropPosition
  index?: number
}

function createGroup(
  tabIds: string[] = [],
  activeId = tabIds[0] ?? ''
): WorkspaceTabGroup {
  return { type: 'group', id: crypto.randomUUID(), tabIds, activeId }
}
function groupsOf(node: WorkspaceSplitNode): WorkspaceTabGroup[] {
  return node.type === 'group' ? [node] : node.children.flatMap(groupsOf)
}
function cloneTree(node: WorkspaceSplitNode): WorkspaceSplitNode {
  return node.type === 'group'
    ? { ...node, tabIds: [...node.tabIds] }
    : {
        ...node,
        ratios: [...node.ratios],
        children: [cloneTree(node.children[0]), cloneTree(node.children[1])],
      }
}
function replaceNode(
  node: WorkspaceSplitNode,
  id: string,
  replacement: WorkspaceSplitNode
): WorkspaceSplitNode {
  if (node.id === id) return replacement
  if (node.type === 'split')
    node.children = [
      replaceNode(node.children[0], id, replacement),
      replaceNode(node.children[1], id, replacement),
    ]
  return node
}
function prune(node: WorkspaceSplitNode): WorkspaceSplitNode | null {
  if (node.type === 'group') return node.tabIds.length ? node : null
  const leading = prune(node.children[0]),
    trailing = prune(node.children[1])
  if (!leading) return trailing
  if (!trailing) return leading
  node.children = [leading, trailing]
  return node
}

/** 每个叶节点持有独立 Tabs，分支允许任意嵌套；组件和会话由页面缓存，布局仅移动 DOM。 */
export function useWorkspaceTabSplit(options: WorkspaceTabSplitOptions) {
  const initial = createGroup(
    options.tabs().map(tab => tab.id),
    options.activeId()
  )
  const tree = shallowRef<WorkspaceSplitNode>(initial)
  const groups = computed(() => groupsOf(tree.value))
  const focusedGroupId = shallowRef(initial.id)
  const targets = shallowReactive(new Map<string, HTMLElement>())
  const dropTarget = shallowRef<TabDropTarget | null>(null)
  const split = computed(() => groups.value.length > 1)

  function groupForTab(id: string): WorkspaceTabGroup | undefined {
    return groups.value.find(group => group.tabIds.includes(id))
  }
  function commit(root: WorkspaceSplitNode): void {
    tree.value =
      prune(root) ??
      (root.type === 'group'
        ? { ...root, tabIds: [], activeId: '' }
        : createGroup())
    if (!groups.value.some(group => group.id === focusedGroupId.value))
      focusedGroupId.value = groups.value[0]!.id
  }
  function activate(id: string): void {
    const group = groupForTab(id)
    if (!group) return
    focusedGroupId.value = group.id
    if (group.activeId === id) return
    const root = cloneTree(tree.value)
    groupsOf(root).find(item => item.id === group.id)!.activeId = id
    commit(root)
  }
  function isVisible(id: string): boolean {
    return (
      options.enabled() && groups.value.some(group => group.activeId === id)
    )
  }
  function targetFor(id: string): HTMLElement | undefined {
    const group = id
      ? groupForTab(id)
      : groups.value.find(
          group => group.id === focusedGroupId.value && !group.tabIds.length
        )
    return group?.activeId === id ? targets.get(group.id) : undefined
  }
  function setTarget(groupId: string, element: unknown): void {
    if (element) targets.set(groupId, element as HTMLElement)
    else targets.delete(groupId)
  }
  function clearPreview(): void {
    dropTarget.value = null
  }

  function targetAtPoint(drag: TabDragEvent): TabDropTarget | null {
    if (!options.enabled()) return null
    const source = groupForTab(drag.id)
    if (!source) return null
    // Pointer capture 下事件目标仍是源标签，按坐标查找实际目标分组。
    const hit = document.elementFromPoint(drag.clientX, drag.clientY)
    const element = hit?.closest<HTMLElement>('[data-workspace-tab-group]')
    const groupId = element?.dataset.workspaceTabGroup
    const group = groups.value.find(group => group.id === groupId)
    const content = groupId ? targets.get(groupId) : undefined
    if (
      !element ||
      !group ||
      !content ||
      content.closest('[data-workspace-tab-group]') !== element
    )
      return null
    let position: SplitDropPosition | null
    let index: number | undefined
    if (hit?.closest('[data-workspace-tab-bar]')) {
      position = 'center'
      const tab = hit.closest<HTMLElement>('[data-reorderable-tab-id]')
      const tabIndex = group.tabIds.indexOf(tab?.dataset.reorderableTabId ?? '')
      if (tab && tabIndex >= 0) {
        const rect = tab.getBoundingClientRect()
        index = tabIndex + (drag.clientX >= rect.left + rect.width / 2 ? 1 : 0)
      }
    } else
      position = splitDropAtPoint(
        drag.clientX,
        drag.clientY,
        content.getBoundingClientRect()
      )
    if (
      !position ||
      (source.id === group.id &&
        (position === 'center' || source.tabIds.length === 1))
    )
      return null
    return {
      groupId: group.id,
      position,
      ...(index === undefined ? {} : { index }),
    }
  }
  function preview(drag: TabDragEvent): void {
    const next = targetAtPoint(drag)
    if (
      next?.groupId !== dropTarget.value?.groupId ||
      next?.position !== dropTarget.value?.position ||
      next?.index !== dropTarget.value?.index
    )
      dropTarget.value = next
  }

  /** 将一个现有标签移到目标分组；边缘投放只拆目标叶节点，其他区域尺寸不变。 */
  function moveTab(
    id: string,
    groupId: string,
    position: SplitDropPosition,
    index?: number
  ): boolean {
    if (!options.tabs().some(tab => tab.id === id)) return false
    let root = cloneTree(tree.value)
    const leaves = groupsOf(root)
    const source = leaves.find(group => group.tabIds.includes(id))
    const target = leaves.find(group => group.id === groupId)
    if (
      !source ||
      !target ||
      (source.id === target.id &&
        (position === 'center' || source.tabIds.length === 1))
    )
      return false
    const from = source.tabIds.indexOf(id)
    source.tabIds.splice(from, 1)
    if (source.activeId === id)
      source.activeId =
        source.tabIds[Math.min(from, source.tabIds.length - 1)] ?? ''
    if (position === 'center') {
      target.tabIds.splice(
        Math.max(
          0,
          Math.min(index ?? target.tabIds.length, target.tabIds.length)
        ),
        0,
        id
      )
      target.activeId = id
      focusedGroupId.value = target.id
    } else {
      const added = createGroup([id])
      const before = position === 'left' || position === 'up'
      root = replaceNode(root, target.id, {
        type: 'split',
        id: crypto.randomUUID(),
        orientation:
          position === 'left' || position === 'right'
            ? 'horizontal'
            : 'vertical',
        children: before ? [added, target] : [target, added],
        ratios: [50, 50],
      })
      focusedGroupId.value = added.id
    }
    commit(root)
    return true
  }
  function drop(drag: TabDragEvent): boolean {
    const target = targetAtPoint(drag)
    clearPreview()
    return (
      !!target &&
      moveTab(drag.id, target.groupId, target.position, target.index)
    )
  }
  function reorder(groupId: string, from: number, to: number): void {
    const root = cloneTree(tree.value)
    const group = groupsOf(root).find(group => group.id === groupId)
    if (
      !group ||
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= group.tabIds.length ||
      to >= group.tabIds.length
    )
      return
    const [id] = group.tabIds.splice(from, 1)
    group.tabIds.splice(to, 0, id!)
    commit(root)
  }
  /** 合并分组保留全部标签，不关闭后端连接。 */
  function mergeGroup(groupId: string): string | undefined {
    if (!split.value) return
    const root = cloneTree(tree.value),
      leaves = groupsOf(root)
    const index = leaves.findIndex(group => group.id === groupId)
    if (index < 0) return
    const source = leaves[index]!,
      target = leaves[index + 1] ?? leaves[index - 1]!
    target.tabIds.push(...source.tabIds)
    if (source.tabIds.includes(options.activeId()))
      target.activeId = options.activeId()
    source.tabIds = []
    focusedGroupId.value = target.id
    commit(root)
    return target.activeId
  }
  function resize(branchId: string, leadingRatio: number): void {
    if (!Number.isFinite(leadingRatio)) return
    const root = cloneTree(tree.value)
    function visit(node: WorkspaceSplitNode): void {
      if (node.type !== 'split') return
      if (node.id === branchId) {
        const bounded = Math.max(15, Math.min(85, leadingRatio))
        node.ratios = [bounded, 100 - bounded]
      } else node.children.forEach(visit)
    }
    visit(root)
    commit(root)
  }
  function preferredAfterClose(ids: readonly string[]): string {
    if (!ids.includes(options.activeId())) return options.activeId()
    const closing = new Set(ids)
    const group = groupForTab(options.activeId())
    if (group) {
      const index = group.tabIds.indexOf(options.activeId())
      const next = [
        ...group.tabIds.slice(index + 1),
        ...group.tabIds.slice(0, index).reverse(),
      ].find(id => !closing.has(id))
      if (next) return next
    }
    return (
      groups.value
        .flatMap(group => [group.activeId, ...group.tabIds])
        .find(id => !closing.has(id)) ?? ''
    )
  }

  watch(
    () => options.tabs().map(tab => tab.id),
    ids => {
      const alive = new Set(ids),
        root = cloneTree(tree.value),
        leaves = groupsOf(root)
      for (const group of leaves) {
        const oldIndex = group.tabIds.indexOf(group.activeId)
        group.tabIds = group.tabIds.filter(id => alive.has(id))
        if (!group.tabIds.includes(group.activeId))
          group.activeId =
            group.tabIds[
              Math.max(0, Math.min(oldIndex, group.tabIds.length - 1))
            ] ?? ''
      }
      const assigned = new Set(leaves.flatMap(group => group.tabIds))
      const destination =
        leaves.find(group => group.id === focusedGroupId.value) ?? leaves[0]!
      destination.tabIds.push(...ids.filter(id => !assigned.has(id)))
      commit(root)
      activate(options.activeId())
      clearPreview()
    }
  )
  watch(options.activeId, activate, { immediate: true })

  return {
    tree,
    groups,
    focusedGroupId,
    targets,
    dropTarget,
    split,
    groupForTab,
    activate,
    isVisible,
    targetFor,
    setTarget,
    preview,
    clearPreview,
    moveTab,
    drop,
    reorder,
    mergeGroup,
    resize,
    preferredAfterClose,
  }
}
export type WorkspaceTabSplit = ReturnType<typeof useWorkspaceTabSplit>
const key: InjectionKey<WorkspaceTabSplit> = Symbol('workspace-tab-split')
export function provideWorkspaceTabSplit(split: WorkspaceTabSplit): void {
  provide(key, split)
}
export function injectWorkspaceTabSplit(): WorkspaceTabSplit | undefined {
  return inject(key, undefined)
}
