//! Dependency-free extraction of readable text from Office spreadsheet/document
//! files (.xlsx/.xlsm/.docx/.pptx/.ods and common .xls exports) so the AI agent
//! can ingest them as attachments without shipping a third-party zip/XML lib.
//!
//! Office open formats are ZIP containers of XML. We parse the ZIP central
//! directory by hand and inflate entries with the platform `DecompressionStream`
//! (WebView2 and Node 22 both expose `deflate-raw`). Captured cell/paragraph
//! text is normalized to tab-separated grids / newline-separated paragraphs.

const ZIP_DEFLATE = 8
const ZIP_STORED = 0
const INVALID_ARCHIVE = 'Office 文件已损坏或内容不完整，请重新导出后重试'
const ARCHIVE_TOO_LARGE =
  'Office 解压后的单个文件超过 128 MB，请拆分文件或转换为 CSV 后重试'
const TABLE_TOO_LARGE = '表格超出可解析范围，请拆分工作表或转换为 CSV 后重试'
const MAX_COLUMNS = 16384
const MAX_ROWS = 1048576

export const MAX_OFFICE_BYTES = 128 * 1024 * 1024
const SOURCE_TOO_LARGE =
  'Office 源文件超过 128 MiB，请拆分文件或转换为 CSV 后重试'
const XML_TOO_LARGE =
  'Office 解压后的 XML 总量超过 128 MiB，请拆分文件或转换为 CSV 后重试'
const TEXT_TOO_LARGE =
  'Office 提取文本总量超过 128 MiB，请拆分文件或转换为 CSV 后重试'

export function assertOfficeFileSize(size: number): void {
  if (size > MAX_OFFICE_BYTES) throw new Error(SOURCE_TOO_LARGE)
}

/** Bound cumulative UTF-8 output before retaining or joining another section. */
export class OfficeTextParts {
  private readonly parts: string[] = []
  private size = 0

  constructor(private readonly separator: '\n' | '\n\n' = '\n\n') {}

  append(text: string): void {
    if (!text) return
    let size = this.size + (this.parts.length ? this.separator.length : 0)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code <= 0x7f) size++
      else if (code <= 0x7ff) size += 2
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        size += 4
        i++
      } else size += 3
      if (size > MAX_OFFICE_BYTES) throw new Error(TEXT_TOO_LARGE)
    }
    this.size = size
    this.parts.push(text)
  }

  join(): string {
    return this.parts.join(this.separator)
  }
}

/** Little-endian UInt32 read. */
function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8)) & 0xffff
}

export interface ZipEntry {
  name: string
  /** Raw, still-compressed bytes from the archive (method 0 = stored). */
  data: Uint8Array
  method: number
  /** Stored vs inflated size; used to pre-size decode buffers. */
  size: number
}

/**
 * Core scan of a ZIP archive using its End-of-Central-Directory record, falling
 * back to a linear scan of local file headers for self-extracting buffers.
 */
export async function readZipEntries(
  bytes: Uint8Array
): Promise<Map<string, ZipEntry>> {
  const entries = new Map<string, ZipEntry>()
  const eocd = findEocd(bytes)
  if (eocd !== null) {
    const dirCount = u16(bytes, eocd + 10)
    const dirSize = u32(bytes, eocd + 12)
    const dirOffset = u32(bytes, eocd + 16)
    if (
      u16(bytes, eocd + 4) !== 0 ||
      u16(bytes, eocd + 6) !== 0 ||
      u16(bytes, eocd + 8) !== dirCount ||
      dirCount === 0xffff ||
      dirOffset + dirSize > eocd
    )
      throw new Error(INVALID_ARCHIVE)
    let pos = dirOffset
    for (let i = 0; i < dirCount; i++) {
      if (dirOffset + dirSize - pos < 46 || u32(bytes, pos) !== 0x02014b50)
        throw new Error(INVALID_ARCHIVE)
      if (u16(bytes, pos + 8) & 1)
        throw new Error('不支持加密的 Office 文件，请先移除文件密码')
      const method = u16(bytes, pos + 10)
      const compSize = u32(bytes, pos + 20)
      const uncompSize = u32(bytes, pos + 24)
      const nameLen = u16(bytes, pos + 28)
      const extraLen = u16(bytes, pos + 30)
      const commentLen = u16(bytes, pos + 32)
      const localOffset = u32(bytes, pos + 42)
      if (pos + 46 + nameLen + extraLen + commentLen > dirOffset + dirSize)
        throw new Error(INVALID_ARCHIVE)
      const name = decodeName(bytes, pos + 46, nameLen)
      const data = extractLocalData(bytes, localOffset, compSize, name)
      if (!data || entries.has(name)) throw new Error(INVALID_ARCHIVE)
      entries.set(name, { name, data, method, size: uncompSize })
      pos += 46 + nameLen + extraLen + commentLen
    }
    return entries
  }
  // Fallback: sequential local file headers.
  let cursor = 0
  while (cursor + 30 <= bytes.length && u32(bytes, cursor) === 0x04034b50) {
    if (u16(bytes, cursor + 6) & 9) throw new Error(INVALID_ARCHIVE)
    const method = u16(bytes, cursor + 8)
    const compSize = u32(bytes, cursor + 18)
    const uncompSize = u32(bytes, cursor + 22)
    const nameLen = u16(bytes, cursor + 26)
    const extraLen = u16(bytes, cursor + 28)
    const nameStart = cursor + 30
    const name = decodeName(bytes, nameStart, nameLen)
    const dataStart = nameStart + nameLen + extraLen
    if (dataStart + compSize > bytes.length || entries.has(name))
      throw new Error(INVALID_ARCHIVE)
    entries.set(name, {
      name,
      data: bytes.subarray(dataStart, dataStart + compSize),
      method,
      size: uncompSize,
    })
    cursor = dataStart + compSize
  }
  if (!entries.size || cursor !== bytes.length) throw new Error(INVALID_ARCHIVE)
  return entries
}

async function readOfficeEntries(
  bytes: Uint8Array
): Promise<Map<string, ZipEntry>> {
  const entries = await readZipEntries(bytes)
  let total = 0
  for (const [name, entry] of entries) {
    // Images/media are never inflated by this text extractor. XML and relationship
    // parts are conservatively counted together before any decompression begins.
    if (!/\.(xml|rels)$/i.test(name)) continue
    total += entry.size
    if (total > MAX_OFFICE_BYTES) throw new Error(XML_TOO_LARGE)
  }
  return entries
}

function decodeName(bytes: Uint8Array, offset: number, len: number): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + len))
}

/** Slice the compressed payload for a central-directory entry. */
function extractLocalData(
  bytes: Uint8Array,
  localOffset: number,
  compSize: number,
  name: string
): Uint8Array | null {
  if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== 0x04034b50)
    return null
  const nameLen = u16(bytes, localOffset + 26)
  const extraLen = u16(bytes, localOffset + 28)
  const dataStart = localOffset + 30 + nameLen + extraLen
  if (dataStart + compSize > bytes.length) return null
  void name
  return bytes.subarray(dataStart, dataStart + compSize)
}

function findEocd(bytes: Uint8Array): number | null {
  const window = Math.min(bytes.length, 65_557)
  let i = bytes.length - 22
  const end = bytes.length - window - 22
  for (; i >= Math.max(0, end); i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06 &&
      i + 22 + u16(bytes, i + 20) === bytes.length
    )
      return i
  }
  return null
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_ENTRY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error(ARCHIVE_TOO_LARGE)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const decoded = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    decoded.set(chunk, offset)
    offset += chunk.byteLength
  }
  return decoded
}

/** Upper bound for a single inflated archive entry (office docs stay far below). */
const MAX_ENTRY_BYTES = MAX_OFFICE_BYTES

export async function extractZipEntry(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.size > MAX_ENTRY_BYTES || entry.data.byteLength > MAX_ENTRY_BYTES)
    throw new Error(ARCHIVE_TOO_LARGE)
  if (entry.method === ZIP_STORED) {
    if (entry.data.byteLength !== entry.size) throw new Error(INVALID_ARCHIVE)
    return entry.data
  }
  if (entry.method === ZIP_DEFLATE) {
    let inflated: Uint8Array
    try {
      inflated = await inflateRaw(entry.data)
    } catch (error) {
      if (error instanceof Error && error.message === ARCHIVE_TOO_LARGE)
        throw error
      throw new Error(INVALID_ARCHIVE)
    }
    if (inflated.length !== entry.size) throw new Error(INVALID_ARCHIVE)
    return inflated
  }
  throw new Error('Office 文件使用了不支持的压缩方式，请重新导出后重试')
}

export async function extractZipText(entry: ZipEntry): Promise<string> {
  const raw = await extractZipEntry(entry)
  return new TextDecoder('utf-8', { fatal: false }).decode(raw)
}

// ---------------------------------------------------------------------------
// XML helpers (no DOM dependency)
// ---------------------------------------------------------------------------

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&amp;/g, '&')
}

function codePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** All `<t ...>...</t>` text runs concatenated (handles w:t / a:t prefixes). */
function tText(xml: string): string {
  const parts: string[] = []
  const re = /<([\w]*:)?t\b[^>]*>([\s\S]*?)<\/\1t>/gi
  let m
  while ((m = re.exec(xml))) parts.push(unescapeXml(m[2]))
  return parts.join('')
}

function colToIndex(letters: string): number {
  let index = 0
  for (const ch of letters.toUpperCase())
    index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

function normalizeCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Format-specific extraction
// ---------------------------------------------------------------------------

function parseSharedStrings(xml: string): string[] {
  const list: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi
  let m
  while ((m = siRe.exec(xml))) list.push(tText(m[1]))
  return list
}

/** Column letters → 0-based index. */
function parseXlsxSheet(sheetXml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi
  let rm
  while ((rm = rowRe.exec(sheetXml))) {
    const rowHtml = rm[1]
    const cells: string[] = []
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi
    let cm
    while ((cm = cellRe.exec(rowHtml))) {
      const attrs = cm[1]
      const inner = cm[2]
      const rMatch = /r="([A-Z]+)\d*"/i.exec(attrs)
      const col = rMatch ? colToIndex(rMatch[1]) : cells.length
      if (!Number.isSafeInteger(col) || col < 0 || col >= MAX_COLUMNS)
        throw new Error(TABLE_TOO_LARGE)
      while (cells.length < col) cells.push('')
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1]
      let value = ''
      if (!type) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)
        value = v
          ? unescapeXml(v[1])
          : formula
            ? `=${unescapeXml(formula[1])}`
            : tText(inner)
      } else if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        const idx = Number(v?.[1])
        if (!Number.isInteger(idx) || shared[idx] === undefined)
          throw new Error(INVALID_ARCHIVE)
        value = shared[idx]
      } else if (type === 'inlineStr') {
        value = tText(inner)
      } else {
        // str, b, e and numeric → the <v> already holds the rendered value.
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        value = v ? unescapeXml(v[1]) : ''
      }
      if (value) cells[col] = normalizeCell(value)
    }
    if (cells.some(c => c !== '')) rows.push(cells)
  }
  return rows
}

function sheetNamesFromWorkbook(
  workbookXml: string,
  relsXml: string
): Map<string, string> {
  // workbook.xml: <sheet name="X" sheetId="1" r:id="rId1" />
  // workbook.xml.rels: <Relationship Id="rId1" Target="worksheets/sheet1.xml" />
  const idToRel = new Map<string, string>()
  const relRe = /<Relationship\b[^>]*>/gi
  let m
  while ((m = relRe.exec(relsXml))) {
    const id = /Id="([^"]+)"/.exec(m[0])
    const target = /Target="([^"]+)"/.exec(m[0])
    if (id && target) {
      // Targets in workbook.xml.rels are relative to xl/ (e.g. worksheets/sheet1.xml).
      const raw = target[1].replace(/^\//, '')
      const path = raw.startsWith('xl/') ? raw : `xl/${raw}`
      idToRel.set(id[1], path)
    }
  }
  const byRel = new Map<string, string>()
  const sheetRe = /<sheet\b[^>]*>/gi
  const order: string[] = []
  while ((m = sheetRe.exec(workbookXml))) {
    const name = /name="([^"]+)"/.exec(m[0])
    const rid = /r:id="([^"]+)"/.exec(m[0])
    const target = (rid ? idToRel.get(rid[1]) : '') ?? ''
    if (name) {
      byRel.set(target, name[1])
      order.push(target)
    }
  }
  const result = new Map<string, string>()
  order.forEach((target, i) => {
    result.set(target, byRel.get(target) ?? `Sheet${i + 1}`)
  })
  return result
}

function tableRowBytes(row: string[], encoder: TextEncoder): number {
  const cellSizes = new Map<string, number>()
  let size = Math.max(0, row.length - 1) * 3 + 5
  for (const cell of row) {
    let cellSize = cellSizes.get(cell)
    if (cellSize === undefined) {
      cellSize = encoder.encode(cell).byteLength
      cellSizes.set(cell, cellSize)
    }
    size += cellSize
    if (size > MAX_ENTRY_BYTES) throw new Error(TABLE_TOO_LARGE)
  }
  return size
}

function tableToText(name: string | undefined, rows: string[][]): string {
  const rowContents = new WeakMap<string[], boolean>()
  const liveRows = rows.filter(row => {
    let hasContent = rowContents.get(row)
    if (hasContent === undefined) {
      hasContent = row.some(Boolean)
      rowContents.set(row, hasContent)
    }
    return hasContent
  })
  if (!liveRows.length) return ''
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  // Repeated/sparse cells can expand a tiny XML file into an enormous Markdown grid.
  // Refuse that expansion explicitly instead of clipping cells or exhausting memory.
  const encoder = new TextEncoder()
  const rowSizes = new WeakMap<string[], number>()
  let outputBytes =
    (name ? encoder.encode(name).byteLength + 5 : 0) + cols * 4 + 2
  for (const row of liveRows) {
    let size = rowSizes.get(row)
    if (size === undefined) {
      size = tableRowBytes(row, encoder) + (cols - row.length) * 3
      rowSizes.set(row, size)
    }
    outputBytes += size
    if (outputBytes > MAX_ENTRY_BYTES) throw new Error(TABLE_TOO_LARGE)
  }
  const lines: string[] = name ? [`### ${name}`] : []
  const header = Array.from({ length: cols }, (_, c) => liveRows[0][c] ?? '')
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`|${'---|'.repeat(Math.max(1, cols))}`)
  for (let r = 1; r < liveRows.length; r++) {
    const row = liveRows[r]
    const padded = Array.from({ length: cols }, (_, c) => row[c] ?? '')
    lines.push(`| ${padded.join(' | ')} |`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export type OfficeKind = 'xlsx' | 'docx' | 'pptx' | 'ods'

/** Returns true when the filename maps to a supported Office (container) file. */
export function isOfficeExtension(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return ['xlsx', 'xlsm', 'xls', 'docx', 'pptx', 'ods'].includes(ext)
}

async function extractXlsx(entries: Map<string, ZipEntry>): Promise<string> {
  const workbookEntry = entries.get('xl/workbook.xml')
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels')
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry
    ? parseSharedStrings(await extractZipText(sharedEntry))
    : []
  let nameMap = new Map<string, string>()
  if (workbookEntry && relsEntry) {
    nameMap = sheetNamesFromWorkbook(
      await extractZipText(workbookEntry),
      await extractZipText(relsEntry)
    )
  }
  const sheetEntries = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => sheetNumber(a[0]) - sheetNumber(b[0]))
  if (!sheetEntries.length) throw new Error(INVALID_ARCHIVE)
  const parts = new OfficeTextParts()
  for (const [path, entry] of sheetEntries) {
    const xml = await extractZipText(entry)
    const rows = parseXlsxSheet(xml, shared)
    const sheetName = nameMap.get(path) ?? `Sheet${sheetNumber(path)}`
    const text = tableToText(sheetName, rows)
    parts.append(text)
  }
  return parts.join()
}

function sheetNumber(path: string): number {
  return Number(/\/(sheet)(\d+)\.xml$/i.exec(path)?.[2] ?? 0)
}

function extractDocx(entries: Map<string, ZipEntry>): Promise<string> {
  const doc = entries.get('word/document.xml')
  if (!doc) return Promise.reject(new Error(INVALID_ARCHIVE))
  return extractZipText(doc).then(xml => {
    const paras = new OfficeTextParts('\n')
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi
    let m
    let found = false
    while ((m = pRe.exec(xml))) {
      found = true
      paras.append(tText(m[1]))
    }
    if (!found) paras.append(tText(xml))
    return paras.join()
  })
}

async function extractPptx(entries: Map<string, ZipEntry>): Promise<string> {
  const slides = [...entries.keys()]
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(
      (a, b) =>
        Number(/slide(\d+)/i.exec(a)?.[1]) - Number(/slide(\d+)/i.exec(b)?.[1])
    )
  if (!slides.length) throw new Error(INVALID_ARCHIVE)
  const parts = new OfficeTextParts()
  for (const [i, name] of slides.entries()) {
    const entry = entries.get(name)!
    const xml = await extractZipText(entry)
    const texts = []
    const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi
    let m
    while ((m = tRe.exec(xml))) texts.push(unescapeXml(m[1]))
    const body = texts.join(' ').trim()
    if (body) parts.append(`### Slide ${i + 1}\n\n${body}`)
  }
  return parts.join()
}

function extractOds(entries: Map<string, ZipEntry>): Promise<string> {
  const content = entries.get('content.xml')
  if (!content) return Promise.reject(new Error(INVALID_ARCHIVE))
  return extractZipText(content).then(xml => {
    const tables = new OfficeTextParts()
    const tableRe = /<table:table\b[^>]*>([\s\S]*?)<\/table:table>/gi
    let tm
    while ((tm = tableRe.exec(xml))) {
      const tableHtml = tm[1]
      const rows: string[][] = []
      const rowRe = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/gi
      let rm
      while ((rm = rowRe.exec(tableHtml))) {
        const cells: string[] = []
        const cellRe =
          /<table:(?:table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>)/gi
        let cm
        while ((cm = cellRe.exec(rm[2]))) {
          const repeats = Number(
            /table:number-columns-repeated="(\d+)"/.exec(cm[1])?.[1] ?? 1
          )
          if (repeats < 1 || cells.length + repeats > MAX_COLUMNS)
            throw new Error(TABLE_TOO_LARGE)
          const cellText = [
            ...(cm[2] ?? '').matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/gi),
          ]
            .map(x => unescapeXml(x[1].replace(/<[^>]+>/g, '')))
            .join(' ')
          const value = normalizeCell(cellText)
          for (let k = 0; k < repeats; k++) cells.push(value)
        }
        const repeats = Number(
          /table:number-rows-repeated="(\d+)"/.exec(rm[1])?.[1] ?? 1
        )
        if (repeats < 1 || rows.length + repeats > MAX_ROWS)
          throw new Error(TABLE_TOO_LARGE)
        if (cells.some(Boolean)) {
          if (
            tableRowBytes(cells, new TextEncoder()) * repeats >
            MAX_ENTRY_BYTES
          )
            throw new Error(TABLE_TOO_LARGE)
          for (let k = 0; k < repeats; k++) rows.push(cells)
        }
      }
      const text = tableToText(undefined, rows)
      tables.append(text)
    }
    return tables.join()
  })
}

/** True when the buffer begins with the legacy OLE2 compound-document magic. */
function isOle2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  )
}

/** Parse an HTML table into text (common for Excel "web page" .xls exports). */
function extractHtmlTable(text: string): string {
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
  const parts = new OfficeTextParts()
  let tm
  while ((tm = tableRe.exec(text))) {
    const rows: string[][] = []
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let rm
    while ((rm = rowRe.exec(tm[1]))) {
      const cells = [
        ...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
      ].map(x =>
        normalizeCell(
          unescapeXml(x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' '))
        )
      )
      if (cells.some(Boolean)) rows.push(cells)
    }
    parts.append(tableToText(undefined, rows))
  }
  return parts.join()
}

/**
 * Extract human-readable text from an Office file. Throws a localized message
 * when the format is unsupported or the container is unusable.
 */
export async function extractOfficeText(
  name: string,
  bytes: Uint8Array
): Promise<string> {
  assertOfficeFileSize(bytes.byteLength)
  const ext = (name.toLowerCase().split('.').pop() ?? '').trim()
  if (['xlsx', 'xlsm'].includes(ext)) {
    const entries = await readOfficeEntries(bytes)
    return extractXlsx(entries)
  }
  if (ext === 'docx') {
    const entries = await readOfficeEntries(bytes)
    return extractDocx(entries)
  }
  if (ext === 'pptx') {
    const entries = await readOfficeEntries(bytes)
    return extractPptx(entries)
  }
  if (ext === 'ods') {
    const entries = await readOfficeEntries(bytes)
    return extractOds(entries)
  }
  if (ext === 'xls') {
    // Legacy BIFF requires a full OLE2 parser — out of scope. Handle the common
    // "Excel web page" / HTML table exports instead, otherwise guide conversion.
    if (!isOle2(bytes)) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      if (/<table\b/i.test(text) || /<html\b/i.test(text)) {
        return extractHtmlTable(text)
      }
    }
    throw new Error('不支持旧版二进制 XLS 文件，请另存为 XLSX 或 CSV 后重试')
  }
  throw new Error(`unsupported format: ${ext}`)
}
