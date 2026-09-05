import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/utils/ui-scale.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
)
const { normalizeUiScale } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
test('旧百分比保持不变，有限输入限制在可用范围', () => {
  for (const value of [80, 90, 100, 110, 125, 150])
    assert.equal(normalizeUiScale(String(value)), value)
  assert.equal(normalizeUiScale(10), 80)
  assert.equal(normalizeUiScale(1000), 150)
  assert.equal(normalizeUiScale(104.7), 105)
})
test('损坏或零值缩放不会造成空白界面', () => {
  for (const value of ['', 'bad', 'Infinity', undefined, null, 0, -20])
    assert.equal(normalizeUiScale(value), 100)
})
