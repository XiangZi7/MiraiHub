import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { sourceLoader } from './helpers/source-module.mjs'

const {
  parseImportWorkbook,
  createImportTemplate,
  matchImportTarget,
  matchImportColumns,
  importMappingError,
  prepareImportRows,
} = await sourceLoader()('src/utils/database-import.ts')
const columns = [
  {
    name: 'id',
    dataType: 'BIGINT',
    nullable: false,
    defaultValue: null,
    autoIncrement: true,
  },
  {
    name: 'name',
    dataType: 'VARCHAR',
    nullable: false,
    defaultValue: null,
    autoIncrement: false,
    comment: '名称',
  },
  {
    name: 'status',
    dataType: 'INT',
    nullable: true,
    defaultValue: '1',
    autoIncrement: false,
  },
]
const target = { schema: 'demo', name: 'users', columns }
const source = {
  id: 'Sheet1',
  schema: '',
  name: 'users',
  columns: ['ID', '名称', 'status'],
  rows: [['', '中文', '']],
}

test('table matching prefers a unique name and otherwise requires a unique compatible structure', () => {
  assert.equal(matchImportTarget(source, [target]), target)
  assert.deepEqual(matchImportColumns(source, target), ['id', 'name', 'status'])
  assert.equal(
    matchImportTarget(source, [target, { ...target, schema: 'other' }]),
    undefined
  )
  assert.equal(
    matchImportTarget({ ...source, name: 'Sheet1' }, [target]),
    target
  )
  assert.equal(
    matchImportTarget({ ...source, name: 'Sheet1' }, [
      target,
      { ...target, name: 'admins' },
    ]),
    undefined
  )
})

test('mapping rejects duplicate columns and missing required fields before writing', () => {
  assert.match(
    importMappingError(source, target, ['id', 'id', '']),
    /同一目标字段/
  )
  assert.match(importMappingError(source, target, ['id', '', 'status']), /name/)
  assert.deepEqual(
    prepareImportRows(source, target, ['id', 'name', 'status']),
    {
      schema: 'demo',
      table: 'users',
      rows: [[{ column: 'name', value: '中文' }]],
    }
  )
  assert.throws(
    () =>
      prepareImportRows({ ...source, rows: [['', null, '']] }, target, [
        'id',
        'name',
        'status',
      ]),
    /name 不能为空/
  )
  assert.deepEqual(
    prepareImportRows({ ...source, rows: [['', 'test', null]] }, target, [
      'id',
      'name',
      'status',
    ]).rows[0],
    [
      { column: 'name', value: 'test' },
      { column: 'status', value: null },
    ]
  )
})

test('generated templates contain no example rows, retain long table names and round-trip text values', async () => {
  const long = {
    ...target,
    name: 'table_name_that_is_longer_than_thirty_one_characters',
  }
  const bytes = await createImportTemplate([long, { ...long, schema: 'other' }])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  const sheets = workbook.worksheets.filter(
    sheet => sheet.state === 'visible' && sheet.name !== '导入说明'
  )
  assert.equal(sheets.length, 2)
  assert.ok(
    sheets.every(sheet => sheet.rowCount === 1 && sheet.name.length <= 31)
  )
  assert.notEqual(sheets[0].name, sheets[1].name)
  assert.equal(sheets[0].getCell('B1').note.includes('必填'), true)
  sheets[0].addRow(['9007199254740993', '=1+1', 'NULL'])
  const result = await parseImportWorkbook(
    new Uint8Array(await workbook.xlsx.writeBuffer())
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].schema, 'demo')
  assert.equal(result[0].name, long.name)
  assert.deepEqual(result[0].rows, [['9007199254740993', '=1+1', 'NULL']])
})

test('Excel keeps blank cells distinct from explicit null and rejects precision loss and uncached formulas', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('users')
  sheet.addRow(['id', 'name', 'status'])
  sheet.addRow(['', 'text', '\\N'])
  let parsed = await parseImportWorkbook(
    new Uint8Array(await workbook.xlsx.writeBuffer())
  )
  assert.deepEqual(parsed[0].rows[0], ['', 'text', null])
  sheet.getCell('A2').value = 9007199254740992
  await assert.rejects(
    parseImportWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer())),
    /失去精度/
  )
  sheet.getCell('A2').value = { formula: '1+1' }
  await assert.rejects(
    parseImportWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer())),
    /没有缓存结果/
  )
  sheet.getCell('A2').value = { formula: '1+1', result: 2 }
  parsed = await parseImportWorkbook(
    new Uint8Array(await workbook.xlsx.writeBuffer())
  )
  assert.equal(parsed[0].rows[0][0], '2')
})

test('Excel refuses duplicate headers, unnamed data columns and empty workbooks', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('users')
  sheet.addRow(['ID', 'id'])
  sheet.addRow(['1', '2'])
  await assert.rejects(
    parseImportWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer())),
    /字段名不能为空或重复/
  )
  sheet.getCell('B1').value = null
  await assert.rejects(
    parseImportWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer())),
    /没有字段名的数据列/
  )
  const empty = new ExcelJS.Workbook()
  empty.addWorksheet('users').addRow(['id'])
  await assert.rejects(
    parseImportWorkbook(new Uint8Array(await empty.xlsx.writeBuffer())),
    /没有可导入的数据/
  )
})
