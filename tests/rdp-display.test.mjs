import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { fitRdpResolution, validRdpResolution } = await load(
  'src/utils/rdp-display.ts'
)
const { RDP_SCAN_CODES } = await load('src/utils/rdp-keys.ts')

test('RDP 分辨率拟合拒绝 NaN 和正负 Infinity，使用有效的安全默认值', () => {
  for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
    for (const size of [
      fitRdpResolution(value, 600),
      fitRdpResolution(800, value),
    ]) {
      assert.deepEqual(size, { width: 1600, height: 900 })
      assert.equal(validRdpResolution(size), true)
    }
  }
})

test('RDP 正常、分数及极端有限尺寸拟合始终满足偶数宽度和客户端上限', () => {
  assert.deepEqual(fitRdpResolution(801, 601), { width: 800, height: 601 })
  for (const [width, height] of [
    [800, 600],
    [1920, 1080],
    [7680, 4320],
    [201.7, 201.7],
    [Number.MIN_VALUE, Number.MIN_VALUE],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [Number.MAX_VALUE, 600],
    [800, Number.MAX_VALUE],
  ])
    assert.equal(validRdpResolution(fitRdpResolution(width, height)), true)
})

test('RDP 安全组合键使用 PC/AT Ctrl、Alt 和 E0 Delete，而非小键盘 Delete', () => {
  assert.equal(RDP_SCAN_CODES.ControlLeft, 0x1d)
  assert.equal(RDP_SCAN_CODES.AltLeft, 0x38)
  assert.equal(RDP_SCAN_CODES.Delete, 0xe053)
  assert.notEqual(RDP_SCAN_CODES.Delete, RDP_SCAN_CODES.NumpadDecimal)
  assert.equal(RDP_SCAN_CODES.ControlRight, 0xe01d)
})
