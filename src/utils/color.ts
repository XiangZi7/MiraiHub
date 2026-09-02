/**
 * 颜色解析工具。
 *
 * 设计令牌用的是 oklch + CSS 变量，而 ECharts 的 zrender 只认 rgb/rgba/hex。
 * 注意不能用 getComputedStyle 读 color：Chrome 会原样保留 `oklch(...)` 字符串，
 * 按 rgb 去解析分量会得到完全错误的颜色。这里借 canvas 光栅化一个像素，
 * 让浏览器自己完成任意色彩空间到 sRGB 的转换。
 */

/** 解析结果缓存，避免每次重绘都走一遍光栅化 */
const cache = new Map<string, [number, number, number]>()

let ctx: CanvasRenderingContext2D | null | undefined

function getContext(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }

  return ctx
}

/**
 * 把任意 CSS 颜色解析成 sRGB 三元组。
 * 支持 `var(--x)`、`oklch(...)`、`#hex`、颜色关键字等一切浏览器认识的写法。
 */
export function parseColor(input: string): [number, number, number] {
  const cached = cache.get(input)
  if (cached)
    return cached

  // var(--color-blue) → 先取出变量实际值，canvas 的 fillStyle 不认 var()
  let value = input.trim()
  if (value.startsWith('var(')) {
    const name = value.slice(4, -1).trim().split(',')[0].trim()
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  const c = getContext()
  if (!c)
    return [255, 255, 255]

  c.clearRect(0, 0, 1, 1)
  // 先落一个已知值：若 value 非法，fillStyle 会保持原值而不是抛错
  c.fillStyle = '#fff'
  c.fillStyle = value
  c.fillRect(0, 0, 1, 1)

  const [r, g, b] = c.getImageData(0, 0, 1, 1).data
  const rgb: [number, number, number] = [r, g, b]

  cache.set(input, rgb)
  return rgb
}

/** 把任意 CSS 颜色转成带透明度的 rgba 字符串 */
export function rgba(input: string, alpha: number): string {
  const [r, g, b] = parseColor(input)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
