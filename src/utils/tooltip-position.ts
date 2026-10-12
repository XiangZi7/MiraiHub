interface TooltipAnchor {
  x: number
  y: number
  top?: number
}

interface TooltipViewport {
  width: number
  height: number
  scale?: number
}

/** 鼠标提示紧随光标；键盘提示以控件为锚点。返回可直接用于 fixed 的 CSS 坐标。 */
export function tooltipPosition(
  anchor: TooltipAnchor,
  size: { width: number; height: number },
  viewport: TooltipViewport
) {
  const padding = 8
  const keyboard = anchor.top !== undefined
  const gap = keyboard ? 8 : 18
  const above = anchor.top ?? anchor.y
  const roomBelow = viewport.height - anchor.y - gap - padding
  const roomAbove = above - gap - padding
  const placeAbove = roomBelow < size.height && roomAbove > roomBelow
  const left = Math.max(
    padding,
    Math.min(
      keyboard ? anchor.x - size.width / 2 : anchor.x + 12,
      viewport.width - size.width - padding
    )
  )
  const top = Math.max(
    padding,
    Math.min(
      placeAbove ? above - size.height - gap : anchor.y + gap,
      viewport.height - size.height - padding
    )
  )
  const scale = viewport.scale && viewport.scale > 0 ? viewport.scale : 1

  return {
    left: left / scale,
    top: top / scale,
    arrowX: Math.max(12, Math.min(anchor.x - left, size.width - 12)) / scale,
    side: placeAbove ? ('top' as const) : ('bottom' as const),
  }
}
