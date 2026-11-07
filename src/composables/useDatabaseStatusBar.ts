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
 */
export function usePublishDatabaseSelection(
  getter: () => DatabaseSelectionStats | null
): void {
  const target = inject(selectionKey, null)
  if (!target) return
  let published: DatabaseSelectionStats | null = null
  watchEffect(() => {
    const next = getter()
    if (next) target.value = next
    else if (target.value === published) target.value = null
    published = next
  })
  onBeforeUnmount(() => {
    if (published && target.value === published) target.value = null
  })
}
