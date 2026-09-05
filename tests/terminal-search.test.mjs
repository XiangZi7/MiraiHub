import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/utils/terminal-search.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
})
const { findTerminalMatches } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

// 单元格夹具包含宽字符的占位格，与 xterm 的公开 IBuffer API 一致。
function buffer(lines) {
  const rows = lines.map(({ cells, wrapped = false }) => ({
    isWrapped: wrapped,
    length: cells.length,
    getCell: (index) => {
      const cell = cells[index]
      if (cell === undefined) return undefined
      const [text, width] = Array.isArray(cell) ? cell : [cell, 1]
      return { getChars: () => text, getWidth: () => width }
    },
  }))
  return { length: rows.length, getLine: (index) => rows[index] }
}

test('查找重复内容和重叠匹配，空查询与无匹配返回空数组', () => {
  const fixture = buffer([{ cells: [...'ababa'] }, { cells: [...'ababa'] }])
  assert.deepEqual(findTerminalMatches(fixture, 'aba'), [
    { row: 0, column: 0, length: 3 },
    { row: 0, column: 2, length: 3 },
    { row: 1, column: 0, length: 3 },
    { row: 1, column: 2, length: 3 },
  ])
  assert.deepEqual(findTerminalMatches(fixture, ''), [])
  assert.deepEqual(findTerminalMatches(fixture, 'missing'), [])
})
test('中文、emoji 与组合字符按终端列宽选择', () => {
  const fixture = buffer([
    { cells: [['中', 2], ['', 0], ['😀', 2], ['', 0], ['e\u0301', 1], 'x'] },
  ])
  assert.deepEqual(findTerminalMatches(fixture, '中😀'), [
    { row: 0, column: 0, length: 4 },
  ])
  assert.deepEqual(findTerminalMatches(fixture, 'e\u0301x'), [
    { row: 0, column: 4, length: 2 },
  ])
})
test('跨自动折行匹配，显式换行不合并', () => {
  const lines = [
    { cells: [...'abcde'] },
    { cells: [...'fghij'], wrapped: true },
  ]
  assert.deepEqual(findTerminalMatches(buffer(lines), 'defg'), [
    { row: 0, column: 3, length: 4 },
  ])
  lines[1].wrapped = false
  assert.deepEqual(findTerminalMatches(buffer(lines), 'defg'), [])
})
