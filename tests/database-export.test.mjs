import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { exportDataText, exportDataBytes } = await load(
  'src/utils/database-export.ts'
)
const data = {
  name: 'events',
  schema: 'app',
  databaseKind: 'mysql',
  columns: [
    {
      name: 'id',
      dataType: 'BIGINT',
      nullable: false,
      primaryKey: true,
      comment: '<主键>',
    },
    { name: 'message', dataType: 'TEXT', nullable: true, comment: '中文备注' },
    { name: 'empty', dataType: 'TEXT' },
  ],
  rows: [
    ['9007199254740993', '中文, "引号"\n第二行\\\t', null],
    ['001', '=1+1', ''],
  ],
}

test('CSV, TXT and JSON preserve Unicode, quotes, NULL and large numeric text', async () => {
  const csv = exportDataText(data, 'csv')
  assert.match(csv, /"中文, ""引号""\n第二行/)
  assert.match(csv, /9007199254740993/)
  assert.deepEqual(JSON.parse(exportDataText(data, 'json'))[0], {
    id: data.rows[0][0],
    message: data.rows[0][1],
    empty: null,
  })
  assert.match(exportDataText(data, 'txt'), /\\n第二行\\\\\\t\t\\N/)
  assert.deepEqual(
    Array.from((await exportDataBytes(data, 'csv')).slice(0, 3)),
    [239, 187, 191]
  )
})

test('JSON retains duplicate result column names without overwriting values', () => {
  const value = {
    ...data,
    columns: ['id', 'id', 'id_2'].map(name => ({ name, dataType: 'text' })),
    rows: [['1', '2', '3']],
  }
  assert.deepEqual(JSON.parse(exportDataText(value, 'json')), [
    { id: '1', id_2: '2', id_2_2: '3' },
  ])
})

test('SQL quotes identifiers, retains NULL and handles SQL escape modes', () => {
  const mysql = exportDataText(data, 'sql', 'odd`table')
  assert.match(mysql, /INSERT INTO `app`.`odd``table`/)
  assert.match(mysql, /USING utf8mb4\), NULL\);/)
  assert.ok(mysql.includes(Buffer.from(data.rows[0][1]).toString('hex')))
  const pg = exportDataText(
    {
      ...data,
      databaseKind: 'postgresql',
      rows: [["O'Reilly\\test", '', null]],
    },
    'sql',
    'odd"table'
  )
  assert.match(pg, /"odd""table"/)
  assert.ok(pg.includes("E'O''Reilly\\\\test'"))
})

test('data dictionary exports actual metadata and HTML escapes user content', () => {
  const dictionary = exportDataText(data, 'dictionary')
  assert.match(dictionary, /BIGINT/)
  assert.match(dictionary, /&lt;主键&gt;/)
  assert.match(dictionary, /中文备注/)
  assert.doesNotMatch(dictionary, /9007199254740993/)
})

test('SQL exports decode binary columns and preserve boolean and identity values', () => {
  const binary = {
    ...data,
    columns: [
      { name: 'payload', dataType: 'BLOB' },
      { name: 'enabled', dataType: 'BOOLEAN' },
    ],
    rows: [['base64:AAEC', 'true']],
  }
  assert.match(exportDataText(binary, 'sql'), /FROM_BASE64\('AAEC'\), TRUE/)
  const pg = {
    ...binary,
    databaseKind: 'postgresql',
    columns: [
      { name: 'payload', dataType: 'BYTEA' },
      { name: 'enabled', dataType: 'BOOL' },
    ],
  }
  assert.match(exportDataText(pg, 'sql'), /OVERRIDING SYSTEM VALUE/)
  assert.match(exportDataText(pg, 'sql'), /decode\('AAEC', 'base64'\), TRUE/)
})

test('Excel export produces a real workbook and preserves text, formulas and nulls', async () => {
  const bytes = await exportDataBytes(data, 'xlsx')
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), 'PK')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  const sheet = workbook.getWorksheet('events')
  assert.equal(sheet.getCell('A2').value, '9007199254740993')
  assert.equal(sheet.getCell('A3').value, '001')
  assert.equal(sheet.getCell('B3').value, '=1+1')
  assert.equal(sheet.getCell('C2').value, null)
})
