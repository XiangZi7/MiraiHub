import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { tooltipPosition } = await sourceLoader()(
  'src/utils/tooltip-position.ts'
)
const size = { width: 200, height: 60 }
const viewport = { width: 800, height: 600 }

test('同一控件内的鼠标提示跟随光标，而不是停在控件中心', () => {
  const first = tooltipPosition({ x: 100, y: 150 }, size, viewport)
  const second = tooltipPosition({ x: 300, y: 190 }, size, viewport)
  assert.equal(second.left - first.left, 200)
  assert.equal(second.top - first.top, 40)
  assert.ok(first.left > 100 && first.left - 100 < 32)
  assert.ok(first.top > 150 && first.top - 150 < 32)
})

test('所有窗口边缘都保持可见，下方空间不足时向上展示', () => {
  for (const x of [0, 8, 100, 400, 792, 800]) {
    for (const y of [0, 8, 100, 300, 592, 600]) {
      const result = tooltipPosition({ x, y }, size, viewport)
      assert.ok(result.left >= 8)
      assert.ok(result.top >= 8)
      assert.ok(result.left + size.width <= viewport.width - 8)
      assert.ok(result.top + size.height <= viewport.height - 8)
    }
  }
  assert.equal(tooltipPosition({ x: 780, y: 590 }, size, viewport).side, 'top')
})

test('键盘提示靠近获得焦点的控件，并能从上方避让', () => {
  const result = tooltipPosition({ x: 300, y: 150, top: 120 }, size, viewport)
  assert.equal(result.left + size.width / 2, 300)
  assert.ok(result.top > 150)
  const bottom = tooltipPosition({ x: 300, y: 595, top: 570 }, size, viewport)
  assert.equal(bottom.side, 'top')
  assert.ok(bottom.top + size.height < 570)
})

test('浏览器预览缩放后，气泡的屏幕位置仍跟随鼠标', () => {
  const anchor = { x: 300, y: 200 }
  const normal = tooltipPosition(anchor, size, viewport)
  for (const scale of [0.8, 1, 1.25, 1.5]) {
    const result = tooltipPosition(anchor, size, { ...viewport, scale })
    assert.equal(result.left * scale, normal.left)
    assert.equal(result.top * scale, normal.top)
    assert.equal(result.arrowX * scale, normal.arrowX)
  }
})
