import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { tooltipShape } = await sourceLoader()('src/utils/tooltip-shape.ts')

/** 读取路径命令和端点，验证圆角完整闭合，而不是只断言宿主的矩形尺寸。 */
function commands(path) {
  return [...path.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].map(match => ({
    type: match[1],
    values: (match[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number),
  }))
}

for (const side of ['bottom', 'top']) {
  test(`${side} 轮廓包含四段完整圆弧，背景和边框共用同一路径`, () => {
    const shape = tooltipShape(240, 34, side, 120)
    const parts = commands(shape.path)
    const arcs = parts.filter(part => part.type === 'A')
    assert.equal(shape.radius, 6)
    assert.equal(arcs.length, 4)
    for (const arc of arcs)
      assert.deepEqual(arc.values.slice(0, 5), [6, 6, 0, 0, 1])
    assert.equal(parts[0].type, 'M')
    assert.equal(parts.at(-1).type, 'Z')
    assert.equal(shape.clipPath, `path("${shape.path}")`)
    assert.equal(shape.height, 40)
  })

  test(`${side} 的描边端点保留半像素边距，1px 轮廓不会被视口裁掉`, () => {
    const shape = tooltipShape(223.4375, 34.25, side, 50)
    const parts = commands(shape.path)
    for (const part of parts) {
      let x, y
      if (part.type === 'M' || part.type === 'L') [x, y] = part.values
      if (part.type === 'A') [x, y] = part.values.slice(5)
      if (part.type === 'H') [x] = part.values
      if (part.type === 'V') [y] = part.values
      if (x !== undefined)
        assert.ok(x >= 0.499 && x <= shape.width - 0.499, `${part.type} x=${x}`)
      if (y !== undefined)
        assert.ok(
          y >= 0.499 && y <= shape.height - 0.499,
          `${part.type} y=${y}`
        )
    }
    assert.equal(shape.width, 223.4375)
    assert.ok(shape.path.includes('222.938'))
  })
}

test('上下尖角均高 6px，与圆角轮廓及 border-box 的背景区域准确对齐', () => {
  const up = tooltipShape(240, 34, 'bottom', 120)
  const down = tooltipShape(240, 34, 'top', 120)
  assert.match(up.path, /H 115 L 120 0\.5 L 125 6\.5/)
  assert.match(down.path, /H 125 L 120 39\.5 L 115 33\.5/)
  assert.equal(up.inset, '-7px -1px -1px')
  assert.equal(down.inset, '-1px -1px -7px')
  // 绝对定位参考父元素 padding-box，补回 1px border 后覆盖完整 border-box。
  assert.equal(1 + up.top, -6)
  assert.equal(1 + down.top, 0)
  assert.equal(240 - 2 + 1 + 1, up.width)
  assert.equal(34 - 2 + 7 + 1, up.height)
})

test('箭头越界时夹在圆角之间，狭窄气泡也不会产生反向横线或非法路径', () => {
  for (const side of ['bottom', 'top']) {
    for (const width of [20, 28, 240]) {
      for (const anchor of [-1000, 0, width / 2, width + 1000, NaN]) {
        const shape = tooltipShape(width, 34, side, anchor)
        assert.ok(!/NaN|Infinity/.test(shape.path))
        const triangle = commands(shape.path).filter(part => part.type === 'L')
        assert.equal(triangle.length, 2)
        for (const point of triangle)
          assert.ok(point.values[0] >= 0.5 && point.values[0] <= width - 0.5)
      }
    }
  }
})

test('非整数页面缩放保留同一个逻辑轮廓，不把圆角尺寸或右边缘取整', () => {
  const reference = tooltipShape(240.125, 34.25, 'bottom', 42.25)
  for (const scale of [0.8, 1, 1.1, 1.25, 1.5]) {
    const shape = tooltipShape(
      (240.125 * scale) / scale,
      (34.25 * scale) / scale,
      'bottom',
      (42.25 * scale) / scale
    )
    assert.equal(shape.path, reference.path)
  }
})

test('没有可见尺寸时不给出残缺轮廓或非法 CSS 裁剪', () => {
  for (const [width, height] of [
    [0, 34],
    [240, 0],
    [NaN, 34],
    [240, Infinity],
  ]) {
    const shape = tooltipShape(width, height, 'bottom', 20)
    assert.equal(shape.path, '')
    assert.equal(shape.clipPath, 'none')
  }
})
