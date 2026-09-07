import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { applyWindowBackgroundOpacity, normalizeWindowBackgroundOpacity } =
  await load('src/utils/window-appearance.ts')

test('毛玻璃背景强度会取整并限制在 0–100', () => {
  for (const [input, expected] of [
    ['0', '0'],
    ['50', '50'],
    ['100', '100'],
    ['-5', '0'],
    ['72.6', '73'],
    ['200', '100'],
  ])
    assert.equal(normalizeWindowBackgroundOpacity(input), expected)

  for (const input of ['', 'bad', 'Infinity', undefined, null])
    assert.equal(normalizeWindowBackgroundOpacity(input), '50')
})

test('滑杆中点保留主题，两端分别控制淡出和不透明填充', () => {
  const values = new Map()
  const root = {
    style: {
      setProperty(name, value) {
        values.set(name, value)
      },
    },
  }

  applyWindowBackgroundOpacity('50', root)
  assert.equal(values.get('--window-background-fade'), '0%')
  assert.equal(values.get('--window-background-fill'), '0%')

  applyWindowBackgroundOpacity('25', root)
  assert.equal(values.get('--window-background-fade'), '50%')
  assert.equal(values.get('--window-background-fill'), '0%')

  applyWindowBackgroundOpacity('80', root)
  assert.equal(values.get('--window-background-fade'), '0%')
  assert.equal(values.get('--window-background-fill'), '60%')
})
