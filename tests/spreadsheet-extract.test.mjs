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
  MAX_OFFICE_BYTES,
  OfficeTextParts,
  assertOfficeFileSize,
} = await load('src/utils/spreadsheet-extract.ts')

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
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
    const original = Buffer.from(content, 'utf8')
    const data = zlib.deflateRawSync(original)
    const crc = crc32(original)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version
    localHeader.writeUInt16LE(0x0800, 6) // flags (UTF-8 name)
    localHeader.writeUInt16LE(8, 8) // deflate
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(original.length, 22)
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
    centralHeader.writeUInt32LE(original.length, 24)
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

test('handles html-table .xls exports and rejects unusable containers explicitly', async () => {
  const html =
    '<html><body><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>'
  const text = await extractOfficeText(
    'legacy.xls',
    new TextEncoder().encode(html)
  )
  assert.match(text, /\| a \| b \|/)
  assert.match(text, /\| 1 \| 2 \|/)
  await assert.rejects(
    extractOfficeText('broken.xlsx', new Uint8Array([1, 2, 3])),
    /已损坏或内容不完整/
  )
  for (const name of ['empty.xlsx', 'empty.docx', 'empty.pptx', 'empty.ods'])
    await assert.rejects(extractOfficeText(name, zip({})), /已损坏或内容不完整/)
  await assert.rejects(
    extractOfficeText(
      'legacy.xls',
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    ),
    /另存为 XLSX 或 CSV/
  )
})

test('long cells keep all Unicode content in XLSX, ODS and HTML exports', async () => {
  const content = '完整内容'.repeat(1000) + '结束标记'
  const fixtures = [
    [
      'long.xlsx',
      zip({
        'xl/sharedStrings.xml': `<sst><si><t>${content}</t></si></sst>`,
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
      }),
    ],
    [
      'long.ods',
      zip({
        'content.xml': `<office:document-content><table:table><table:table-row><table:table-cell><text:p>${content}</text:p></table:table-cell></table:table-row></table:table></office:document-content>`,
      }),
    ],
    [
      'long.xls',
      new TextEncoder().encode(
        `<html>${' '.repeat(2048)}<table><tr><td>${content}</td><td>A &amp; B</td></tr></table></html>`
      ),
    ],
  ]
  for (const [name, bytes] of fixtures) {
    const text = await extractOfficeText(name, bytes)
    assert.ok(text.includes(content), `${name} must keep the full cell`)
    assert.ok(!text.includes('…'))
  }
  assert.match(await extractOfficeText(fixtures[2][0], fixtures[2][1]), /A & B/)
})

test('XLSX columns beyond 1024 remain separate and uncached formulas remain visible', async () => {
  const text = await extractOfficeText(
    'wide.xlsx',
    zip({
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row><c r="AMK1" t="inlineStr"><is><t>first wide cell</t></is></c><c r="AML1" t="inlineStr"><is><t>second wide cell</t></is></c><c r="AMM1"><f>SUM(A1:A5)</f></c></row></sheetData></worksheet>',
    })
  )
  const cells = text.split('\n')[1].split(' | ')
  assert.equal(cells[1024], 'first wide cell')
  assert.equal(cells[1025], 'second wide cell')
  assert.match(text, /=SUM\(A1:A5\)/)
  await assert.rejects(
    extractOfficeText(
      'invalid.xlsx',
      zip({
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row><c r="XFE1"><v>1</v></c></row></sheetData></worksheet>',
      })
    ),
    /超出可解析范围/
  )
})

test('ODS preserves repeated rows and columns and accounts for empty cells', async () => {
  const text = await extractOfficeText(
    'repeated.ods',
    zip({
      'content.xml':
        '<office:document-content><table:table><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"/><table:table-cell table:number-columns-repeated="65"><text:p>value</text:p></table:table-cell></table:table-row></table:table></office:document-content>',
    })
  )
  assert.equal((text.match(/value/g) ?? []).length, 130)
  assert.ok(text.startsWith('|  |  | value'))
  await assert.rejects(
    extractOfficeText(
      'huge.ods',
      zip({
        'content.xml':
          '<table:table><table:table-row><table:table-cell table:number-columns-repeated="999999"><text:p>value</text:p></table:table-cell></table:table-row></table:table>',
      })
    ),
    /超出可解析范围/
  )
})

test('ZIP size and corruption checks fail instead of returning partial content', async () => {
  for (const method of [0, 8])
    await assert.rejects(
      extractZipEntry({
        name: 'large.xml',
        data: new Uint8Array(),
        method,
        size: 128 * 1024 * 1024 + 1,
      }),
      /超过 128 MB/
    )
  await assert.rejects(
    extractZipEntry({
      name: 'short.xml',
      data: new Uint8Array([1]),
      method: 0,
      size: 2,
    }),
    /已损坏或内容不完整/
  )
  const archive = zip({
    'word/document.xml':
      '<w:document><w:p><w:t>Visible</w:t></w:p></w:document>',
  })
  const corrupted = archive.slice()
  const view = new DataView(corrupted.buffer)
  const central = view.getUint32(corrupted.length - 6, true)
  view.setUint32(central, 0, true)
  await assert.rejects(readZipEntries(corrupted), /已损坏或内容不完整/)
  const encrypted = archive.slice()
  new DataView(encrypted.buffer).setUint16(central + 8, 1, true)
  await assert.rejects(readZipEntries(encrypted), /不支持加密/)
})

test('ODS refuses oversized repeated grids before allocating expanded output', async () => {
  for (const [rows, columns, content] of [
    [1048576, 16384, 'value'],
    [1, 16384, 'long'.repeat(3000)],
  ]) {
    await assert.rejects(
      extractOfficeText(
        'expanded.ods',
        zip({
          'content.xml': `<table:table><table:table-row table:number-rows-repeated="${rows}"><table:table-cell table:number-columns-repeated="${columns}"><text:p>${content}</text:p></table:table-cell></table:table-row></table:table>`,
        })
      ),
      /超出可解析范围/
    )
  }
})

test('Office source and cumulative XML limits reject before decompression and ignore media', async () => {
  assert.doesNotThrow(() => assertOfficeFileSize(MAX_OFFICE_BYTES))
  assert.throws(
    () => assertOfficeFileSize(MAX_OFFICE_BYTES + 1),
    /源文件超过 128 MiB/
  )
  await assert.rejects(
    extractOfficeText('large.xlsx', { byteLength: MAX_OFFICE_BYTES + 1 }),
    /源文件超过 128 MiB/
  )
  const declaredSizes = (files, sizes) => {
    const bytes = zip(files)
    const view = new DataView(bytes.buffer)
    let offset = view.getUint32(bytes.length - 6, true)
    for (let i = 0; i < Object.keys(files).length; i++) {
      const nameLength = view.getUint16(offset + 28, true)
      const name = new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + nameLength)
      )
      if (sizes[name] !== undefined)
        view.setUint32(offset + 24, sizes[name], true)
      offset +=
        46 +
        nameLength +
        view.getUint16(offset + 30, true) +
        view.getUint16(offset + 32, true)
    }
    return bytes
  }
  await assert.rejects(
    extractOfficeText(
      'combined.xlsx',
      declaredSizes(xlsxFiles, {
        'xl/sharedStrings.xml': 70 * 1024 * 1024,
        'xl/worksheets/sheet1.xml': 70 * 1024 * 1024,
      })
    ),
    /XML 总量超过 128 MiB/
  )
  const text = await extractOfficeText(
    'with-image.xlsx',
    declaredSizes(
      {
        ...xlsxFiles,
        'xl/media/image1.png': 'image bytes are not decoded',
      },
      { 'xl/media/image1.png': 512 * 1024 * 1024 }
    )
  )
  assert.match(text, /Alice/)
})

test('Office text totals count UTF-8 bytes and separators before combining sections', () => {
  const normal = new OfficeTextParts()
  normal.append('中文🙂')
  normal.append('')
  normal.append('next')
  assert.equal(normal.join(), '中文🙂\n\nnext')
  const combined = new OfficeTextParts()
  // Reuse one small string: no large joined result is allocated by the regression test.
  const section = '🙂'.repeat(512 * 1024) // 2 MiB in UTF-8, 1M UTF-16 code units.
  for (let i = 0; i < 63; i++) combined.append(section)
  assert.throws(() => combined.append(section), /提取文本总量超过 128 MiB/)
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
