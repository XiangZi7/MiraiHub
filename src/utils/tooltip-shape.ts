export interface TooltipShape {
  width: number
  height: number
  radius: number
  left: number
  top: number
  inset: string
  path: string
  clipPath: string
}

/** 保留亚像素尺寸并稳定序列化，避免缩放时将右侧圆角取整裁掉。 */
function coordinate(value: number): string {
  return String(Number(value.toFixed(3)))
}

/**
 * 根据气泡 border-box 生成唯一的闭合轮廓，玻璃裁剪与 SVG 描边直接复用同一路径。
 * 尖角向上对应 bottom 放置，向下对应 top；四个圆角和尖角不再分段补画。
 * 描边宽度为 1px，轮廓向视口内缩半像素，防止边缘被 SVG 视口裁剪。
 * inset/left/top 补偿实际 border 宽度（缩放后可能为 0.8px），背景与描边覆盖相同的外伸区域。
 */
export function tooltipShape(
  bodyWidth: number,
  bodyHeight: number,
  side: 'top' | 'bottom',
  arrowX: number,
  border = 1
): TooltipShape {
  if (
    !Number.isFinite(bodyWidth) ||
    !Number.isFinite(bodyHeight) ||
    bodyWidth <= 1 ||
    bodyHeight <= 1
  ) {
    return {
      width: 0,
      height: 0,
      radius: 6,
      left: 0,
      top: 0,
      inset: '0',
      path: '',
      clipPath: 'none',
    }
  }

  const width = bodyWidth
  const height = bodyHeight + 6
  const edge = Math.max(0, Number.isFinite(border) ? border : 1)
  const left = 0.5
  const right = width - 0.5
  const upward = side === 'bottom'
  const top = upward ? 6.5 : 0.5
  const bottom = upward ? height - 0.5 : bodyHeight - 0.5
  const tip = upward ? 0.5 : height - 0.5
  const radius = Math.min(6, (width - 1) / 2, (bodyHeight - 1) / 2)
  const half = Math.min(5, Math.max(0, (width - 1 - radius * 2) / 2))
  const min = Math.min(width / 2, Math.max(12, left + radius + half))
  const max = Math.max(width / 2, Math.min(width - 12, right - radius - half))
  const pointer = Math.max(
    min,
    Math.min(Number.isFinite(arrowX) ? arrowX : width / 2, max)
  )
  const n = coordinate
  const path = [
    `M ${n(left + radius)} ${n(top)}`,
    ...(upward
      ? [
          `H ${n(pointer - half)}`,
          `L ${n(pointer)} ${n(tip)}`,
          `L ${n(pointer + half)} ${n(top)}`,
        ]
      : []),
    `H ${n(right - radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(right)} ${n(top + radius)}`,
    `V ${n(bottom - radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(right - radius)} ${n(bottom)}`,
    ...(upward
      ? []
      : [
          `H ${n(pointer + half)}`,
          `L ${n(pointer)} ${n(tip)}`,
          `L ${n(pointer - half)} ${n(bottom)}`,
        ]),
    `H ${n(left + radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(left)} ${n(bottom - radius)}`,
    `V ${n(top + radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(left + radius)} ${n(top)}`,
    'Z',
  ].join(' ')

  return {
    width,
    height,
    radius,
    left: -edge,
    top: -(edge + (upward ? 6 : 0)),
    // 偏移保留 CSS 的完整精度；截成 3 位会在 110% 缩放下跨过 1/64px 布局舍入边界。
    inset: upward
      ? `${-edge - 6}px ${-edge}px ${-edge}px`
      : `${-edge}px ${-edge}px ${-edge - 6}px`,
    path,
    clipPath: `path("${path}")`,
  }
}
