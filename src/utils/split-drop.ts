import type { SplitDirection } from '@/composables/useSplitPanes'

export type SplitDropPosition = SplitDirection | 'center'
type DropBounds = Pick<
  DOMRect,
  'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'
>

/** 边缘创建分屏，中央区域将标签加入现有分组。 */
export function splitDropAtPoint(
  x: number,
  y: number,
  rect: DropBounds,
  edgeRatio = 0.25
): SplitDropPosition | null {
  if (
    !rect.width ||
    !rect.height ||
    x < rect.left ||
    x > rect.right ||
    y < rect.top ||
    y > rect.bottom
  )
    return null
  const fromLeft = (x - rect.left) / rect.width
  const fromTop = (y - rect.top) / rect.height
  const edges: { direction: SplitDirection; distance: number }[] = [
    { direction: 'left', distance: fromLeft },
    { direction: 'right', distance: 1 - fromLeft },
    { direction: 'up', distance: fromTop },
    { direction: 'down', distance: 1 - fromTop },
  ]
  const nearest = edges.reduce((closest, edge) =>
    edge.distance < closest.distance ? edge : closest
  )
  return nearest.distance <= edgeRatio ? nearest.direction : 'center'
}

/** 新建终端按钮在中央松手时，保持默认向下分屏的行为。 */
export function splitDirectionAtPoint(
  x: number,
  y: number,
  rect: DropBounds
): SplitDirection | null {
  const position = splitDropAtPoint(x, y, rect, 0.35)
  return position === 'center' ? 'down' : position
}
