import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

/** 建立独立源码依赖图，清理时确认目录位于本次新建的临时目录内。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'miraihub-source-loader-test-'))
  t.after(() => {
    assert.match(
      relative(resolve(tmpdir()), resolve(root)),
      /^miraihub-source-loader-test-[^/\\]+$/
    )
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

test('deep shared dependency graphs load without recursively embedding their source', async t => {
  const root = fixture(t)
  writeFileSync(
    join(root, 'level0.ts'),
    'export const value = 0; export const state = {};'
  )
  for (let level = 1; level <= 22; level++) {
    writeFileSync(
      join(root, `level${level}.ts`),
      `
      import { value as left, state } from './level${level - 1}';
      import { value as right } from './level${level - 1}';
      export { state };
      export const value = left + right + 1;
    `
    )
  }
  const load = sourceLoader()
  const result = await load(join(root, 'level22.ts'))
  assert.equal(result.value, 2 ** 22 - 1)
  assert.strictEqual(result.state, (await load(join(root, 'level0.ts'))).state)
  assert.strictEqual(result, await load(join(root, 'level22.ts')))
})

test('independent loaders isolate module state and retain circular import bindings', async t => {
  const root = fixture(t)
  writeFileSync(
    join(root, 'a.ts'),
    `
    import { read } from './b';
    export const state = { value: 'initial' };
    export const current = read;
  `
  )
  writeFileSync(
    join(root, 'b.ts'),
    `
    import { state } from './a';
    // 循环依赖初始化完成后读取同一状态对象。
    export const read = () => state.value;
  `
  )
  const first = await sourceLoader()(join(root, 'a.ts'))
  const second = await sourceLoader()(join(root, 'a.ts'))
  first.state.value = 'changed'
  assert.equal(first.current(), 'changed')
  assert.equal(second.current(), 'initial')
  assert.notStrictEqual(first.state, second.state)
})
