import { computed, reactive, toRefs } from 'vue'

/** 分屏排列方向。vertical = 上下堆叠，horizontal = 左右并排 */
export type SplitOrientation = 'vertical' | 'horizontal'

/** 新面板相对当前面板的落位。上下落位走纵向排列，左右落位走横向排列 */
export type SplitDirection = 'up' | 'down' | 'left' | 'right'

export interface SplitPane {
  id: string
}

interface SplitPanesOptions {
  /** 首个面板的 id。由调用方给定，保证主会话绑定的那个面板 id 永不变化 */
  rootId: string
  /**
   * 拖动分隔条时，两侧面板各自至少要占「相邻两块之和」的比例。
   *
   * 取相对值而不是绝对占比：面板开到 6 个时每块才 16%，
   * 绝对下限会把分隔条锁死，相对下限在任意面板数下都成立。
   */
  minShareOfPair?: number
}

const DEFAULT_MIN_SHARE_OF_PAIR = 0.15

/**
 * 一维可调分屏的布局引擎。
 *
 * 只维护「同一方向上的 N 个面板 + 各自占比」，不做递归嵌套 ——
 * 嵌套树要额外处理塌缩与归一化，而终端分屏的实际用法几乎都是一排或一列。
 *
 * 占比用百分比表示并始终归一化到 100，这样面板增删后不必关心历史累计误差，
 * 渲染端直接把它当 flex-grow 用。
 */
export function useSplitPanes(options: SplitPanesOptions) {
  const minShareOfPair = options.minShareOfPair ?? DEFAULT_MIN_SHARE_OF_PAIR
  const state = reactive({
    panes: [{ id: options.rootId }] as SplitPane[],
    /** 与 panes 同序的占比，总和恒为 100 */
    ratios: [100] as number[],
    orientation: 'vertical' as SplitOrientation,
    /** 当前获得焦点的面板。分屏时从它身上让出空间 */
    activeId: options.rootId,
  })

  const split = computed(() => state.panes.length > 1)

  /** 把占比重新缩放到总和 100，吸收浮点累计误差 */
  function normalize(): void {
    const total = state.ratios.reduce((sum, ratio) => sum + ratio, 0)
    if (total <= 0) {
      distributeEvenly()
      return
    }
    for (let index = 0; index < state.ratios.length; index += 1)
      state.ratios[index] = (state.ratios[index]! * 100) / total
  }

  /** 均分所有面板，供双击分隔条恢复默认 */
  function distributeEvenly(): void {
    const even = 100 / Math.max(1, state.panes.length)
    state.ratios.splice(0, state.ratios.length, ...state.panes.map(() => even))
  }

  /**
   * 追加一个面板，返回它的 id。
   *
   * 新面板从当前活动面板身上对半分 —— 分屏的直觉是「把我这块一分为二」，
   * 而不是把已经调好的所有面板等比压扁。
   */
  function add(
    direction: SplitDirection = 'down',
    id: string = crypto.randomUUID()
  ): string {
    if (state.panes.some(pane => pane.id === id)) return id
    state.orientation =
      direction === 'up' || direction === 'down' ? 'vertical' : 'horizontal'

    const activeIndex = state.panes.findIndex(
      pane => pane.id === state.activeId
    )
    const sourceIndex = activeIndex < 0 ? state.panes.length - 1 : activeIndex
    const before = direction === 'up' || direction === 'left'
    const insertAt = before ? sourceIndex : sourceIndex + 1

    const half = (state.ratios[sourceIndex] ?? 100) / 2
    state.ratios[sourceIndex] = half
    state.ratios.splice(insertAt, 0, half)
    state.panes.splice(insertAt, 0, { id })
    state.activeId = id
    normalize()
    return id
  }

  /**
   * 移除面板。始终保留至少一个 —— 面板数归零会让整块工作区变空白，
   * 而用户关掉的只是分屏，不是这个连接。
   */
  function remove(id: string): void {
    if (state.panes.length <= 1) return
    const index = state.panes.findIndex(pane => pane.id === id)
    if (index < 0) return

    const [released] = state.ratios.splice(index, 1)
    state.panes.splice(index, 1)

    // 腾出的占比按现有权重还给剩下的面板，保持它们之间的相对比例不变
    const total = state.ratios.reduce((sum, ratio) => sum + ratio, 0)
    if (released && total > 0)
      for (let cursor = 0; cursor < state.ratios.length; cursor += 1)
        state.ratios[cursor]! += (released * state.ratios[cursor]!) / total
    normalize()

    if (state.activeId === id)
      state.activeId =
        state.panes[Math.min(index, state.panes.length - 1)]?.id ?? ''
  }

  /**
   * 拖动第 dividerIndex 个分隔条：把它前一个面板的占比设为 leadingRatio，
   * 差额由后一个面板补。只动相邻两块，其余面板的尺寸不受影响。
   *
   * 取目标占比而非增量：拖到夹紧边界再往回拖时，
   * 增量式会因为被截断而丢步，指针与分隔条之间会累积出偏移。
   */
  function resize(dividerIndex: number, leadingRatio: number): void {
    const leading = state.ratios[dividerIndex]
    const trailing = state.ratios[dividerIndex + 1]
    if (leading === undefined || trailing === undefined) return

    const sum = leading + trailing
    const floor = sum * minShareOfPair
    const bounded = Math.min(sum - floor, Math.max(floor, leadingRatio))
    if (!Number.isFinite(bounded)) return

    state.ratios[dividerIndex] = bounded
    state.ratios[dividerIndex + 1] = sum - bounded
  }

  function focus(id: string): void {
    if (state.panes.some(pane => pane.id === id)) state.activeId = id
  }

  /** 在横排与竖排之间切换，占比保持不变 */
  function toggleOrientation(): void {
    state.orientation =
      state.orientation === 'vertical' ? 'horizontal' : 'vertical'
  }

  return {
    ...toRefs(state),
    split,
    add,
    remove,
    resize,
    focus,
    toggleOrientation,
    distributeEvenly,
  }
}
