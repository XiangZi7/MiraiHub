import { useElementVisibility } from '@vueuse/core'
import {
  inject,
  onBeforeUnmount,
  provide,
  shallowRef,
  watchEffect,
  type InjectionKey,
  type ShallowRef,
} from 'vue'

/** 网格选区统计，显示在数据库底部状态栏右侧。 */
export interface DatabaseSelectionStats {
  /** 选中的单元格数 */
  cells: number
  /** 选区覆盖的行数 */
  rows?: number
  /** 数值单元格的合计/平均；没有数值时省略 */
  sum?: number
  average?: number
}

const selectionKey: InjectionKey<ShallowRef<DatabaseSelectionStats | null>> =
  Symbol('database-status-selection')

/** DatabaseView 调用：为本连接的状态栏建立选区统计通道。 */
export function provideDatabaseStatusSelection(): ShallowRef<DatabaseSelectionStats | null> {
  const selection = shallowRef<DatabaseSelectionStats | null>(null)
  provide(selectionKey, selection)
  return selection
}

/**
 * 网格组件调用：把自己的选区统计发布到状态栏。
 * 组件卸载或不可见（getter 返回 null）时自动清空，避免显示其他标签的残留统计。
 *
 * 传入网格滚动容器时还会跟踪它是否真的可见：标签切走（v-show 隐藏）、结果面板收起
 * 或切到非数据页签时，状态栏上本网格的统计会被清掉；切回来且选区还在时重新发布。
 */
export function usePublishDatabaseSelection(
  getter: () => DatabaseSelectionStats | null,
  element?: () => HTMLElement | null | undefined
): void {
  const target = inject(selectionKey, null)
  if (!target) return
  // 元素被 v-if 移除时 IntersectionObserver 不会再回调，需同时判断元素是否还存在。
  const intersecting = element ? useElementVisibility(element) : null
  const visible = (): boolean =>
    !element || (Boolean(element()) && Boolean(intersecting?.value))
  let published: DatabaseSelectionStats | null = null
  watchEffect(() => {
    const next = visible() ? getter() : null
    if (next) target.value = next
    else if (target.value === published) target.value = null
    published = next
  })
  onBeforeUnmount(() => {
    if (published && target.value === published) target.value = null
  })
}

/** 把网格选区统计（useGridSelection().stats）转换成状态栏格式；没有数值单元格时不显示合计/平均。 */
export function toStatusSelection(
  stats: { cells: number; numbers: number; sum: number; average: number } | null
): DatabaseSelectionStats | null {
  if (!stats) return null
  return stats.numbers
    ? { cells: stats.cells, sum: stats.sum, average: stats.average }
    : { cells: stats.cells }
}
