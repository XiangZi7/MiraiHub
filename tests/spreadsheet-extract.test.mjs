import assert from 'node:assert/strict'
import { test } from 'node:test'
import zlib from 'node:zlib'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const {
  readZipEntries,
  extractZipEntry,
  extractOfficeText,
  isOfficeExtension,
} = await load('src/utils/spreadsheet-extract.ts')

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build a minimal ZIP archive (deflate entries) from {name: content}. */
function zip(files) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = zlib.deflateRawSync(Buffer.from(content, 'utf8'))
    const crc = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version
    localHeader.writeUInt16LE(0x0800, 6) // flags (UTF-8 name)
    localHeader.writeUInt16LE(8, 8) // deflate
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)
    local.push(Buffer.concat([localHeader, nameBytes, data]))
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([centralHeader, nameBytes]))
    offset += 30 + nameBytes.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files ? Object.keys(files).length : 0, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, centralBuf, eocd]))
}

const xlsxFiles = {
  'xl/workbook.xml':
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml':
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Name</t></si><si><t>Alice</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>10</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>20</v></c></row>' +
    '</sheetData></worksheet>',
}

test('reads zip entries and inflates deflate content', async () => {
  const bytes = zip({ 'hello.txt': 'zip content' })
  const entries = await readZipEntries(bytes)
  assert.ok(entries.has('hello.txt'))
  const text = await extractZipEntry(entries.get('hello.txt'))
  assert.equal(new TextDecoder().decode(text), 'zip content')
})

test('extracts xlsx sheets as markdown tables with shared strings', async () => {
  const bytes = zip(xlsxFiles)
  const text = await extractOfficeText('report.xlsx', bytes)
  assert.match(text, /### Data/)
  assert.match(text, /\| Name \| 10 \|/)
  assert.match(text, /\| Alice \| 20 \|/)
})

test('extracts docx paragraphs', async () => {
  const bytes = zip({
    'word/document.xml':
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second &amp; line</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  })
  const text = await extractOfficeText('notes.docx', bytes)
  const lines = text.split('\n').filter(Boolean)
  assert.deepEqual(lines, ['Hello world', 'Second & line'])
})

test('extracts pptx slide text', async () => {
  const bytes = zip({
    'ppt/slides/slide1.xml':
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Title slide</a:t><a:t>Subtitle</a:t></p:sld>',
    'ppt/slides/slide2.xml':
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Second slide</a:t></p:sld>',
  })
  const text = await extractOfficeText('slides.pptx', bytes)
  assert.match(text, /### Slide 1/)
  assert.match(text, /Title slide Subtitle/)
  assert.match(text, /### Slide 2/)
  assert.match(text, /Second slide/)
})

test('handles html-table .xls exports and reports unusable containers as empty', async () => {
  const html =
    '<html><body><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>'
  const text = await extractOfficeText('legacy.xls', new TextEncoder().encode(html))
  assert.match(text, /\| a \| b \|/)
  assert.match(text, /\| 1 \| 2 \|/)
  // Not a ZIP: no entries can be found, so extraction yields no text.
  const empty = await extractOfficeText('broken.xlsx', new Uint8Array([1, 2, 3]))
  assert.equal(empty, '')
})

test('isOfficeExtension matches supported container types', () => {
  assert.equal(isOfficeExtension('a.xlsx'), true)
  assert.equal(isOfficeExtension('a.XLSM'), true)
  assert.equal(isOfficeExtension('a.docx'), true)
  assert.equal(isOfficeExtension('a.pptx'), true)
  assert.equal(isOfficeExtension('a.ods'), true)
  assert.equal(isOfficeExtension('a.xls'), true)
  assert.equal(isOfficeExtension('a.csv'), false)
  assert.equal(isOfficeExtension('a.txt'), false)
})