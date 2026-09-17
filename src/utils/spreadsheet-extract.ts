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
  if (eocd) {
    const dirCount = u16(bytes, eocd + 10)
    const dirSize = u32(bytes, eocd + 12)
    const dirOffset = u32(bytes, eocd + 16)
    void dirSize
    let pos = dirOffset
    for (let i = 0; i < dirCount; i++) {
      if (bytes.length - pos < 46 || u32(bytes, pos) !== 0x02014b50) break
      const method = u16(bytes, pos + 10)
      const compSize = u32(bytes, pos + 20)
      const uncompSize = u32(bytes, pos + 24)
      const nameLen = u16(bytes, pos + 28)
      const extraLen = u16(bytes, pos + 30)
      const commentLen = u16(bytes, pos + 32)
      const localOffset = u32(bytes, pos + 42)
      const name = decodeName(bytes, pos + 46, nameLen)
      const data = extractLocalData(
        bytes,
        localOffset,
        compSize,
        name
      )
      if (data) entries.set(name, { name, data, method, size: uncompSize })
      pos += 46 + nameLen + extraLen + commentLen
    }
    return entries
  }
  // Fallback: sequential local file headers.
  let cursor = 0
  while (cursor + 30 <= bytes.length && u32(bytes, cursor) === 0x04034b50) {
    const method = u16(bytes, cursor + 8)
    const compSize = u32(bytes, cursor + 18)
    const uncompSize = u32(bytes, cursor + 22)
    const nameLen = u16(bytes, cursor + 26)
    const extraLen = u16(bytes, cursor + 28)
    const nameStart = cursor + 30
    const name = decodeName(bytes, nameStart, nameLen)
    const dataStart = nameStart + nameLen + extraLen
    if (dataStart + compSize > bytes.length) break
    entries.set(
      name,
      { name, data: bytes.subarray(dataStart, dataStart + compSize), method, size: uncompSize }
    )
    cursor = dataStart + compSize
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
      bytes[i + 3] === 0x06
    )
      return i
  }
  return null
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(
    new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  )
  const decoded = await stream.arrayBuffer()
  return new Uint8Array(decoded)
}

/** Upper bound for a single inflated archive entry (office docs stay far below). */
const MAX_ENTRY_BYTES = 128 * 1024 * 1024

export async function extractZipEntry(
  entry: ZipEntry
): Promise<Uint8Array> {
  if (entry.method === ZIP_STORED) return entry.data
  if (entry.method === ZIP_DEFLATE) {
    const inflated = await inflateRaw(entry.data)
    if (inflated.length > MAX_ENTRY_BYTES)
      throw new Error('archive entry too large')
    return inflated
  }
  throw new Error('unsupported compression method')
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      codePoint(parseInt(hex, 16))
    )
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
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

function normalizeCell(value: string, maxLen = 500): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length > maxLen) return `${cleaned.slice(0, maxLen)}…`
  return cleaned
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
      let col = rMatch ? colToIndex(rMatch[1]) : cells.length
      if (col > 1023) col = 1023 // guard against crafted references
      while (cells.length < col) cells.push('')
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1]
      let value = ''
      if (!type) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        value = v ? v[1] : tText(inner)
      } else if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        const idx = Number(v ? v[1] : '')
        value = Number.isInteger(idx) ? (shared[idx] ?? '') : ''
      } else if (type === 'inlineStr') {
        value = tText(inner)
      } else {
        // str, b, e and numeric → the <v> already holds the rendered value.
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        value = v ? v[1] : ''
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

function tableToText(name: string | undefined, rows: string[][]): string {
  const used = rows.map(row =>
    row.reduce((n, cell) => (cell ? n + 1 : n), 0)
  )
  const liveRows = rows.filter((_, i) => used[i] > 0)
  if (!liveRows.length) return ''
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
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

async function extractXlsx(
  entries: Map<string, ZipEntry>
): Promise<string> {
  const workbookEntry = entries.get('xl/workbook.xml')
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels')
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(await extractZipText(sharedEntry)) : []
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
  if (!sheetEntries.length) return ''
  const parts: string[] = []
  for (const [path, entry] of sheetEntries) {
    const xml = await extractZipText(entry)
    const rows = parseXlsxSheet(xml, shared)
    const sheetName = nameMap.get(path) ?? `Sheet${sheetNumber(path)}`
    const text = tableToText(sheetName, rows)
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

function sheetNumber(path: string): number {
  return Number(/\/(sheet)(\d+)\.xml$/i.exec(path)?.[2] ?? 0)
}

function extractDocx(entries: Map<string, ZipEntry>): Promise<string> {
  const doc = entries.get('word/document.xml')
  if (!doc) return Promise.resolve('')
  return extractZipText(doc).then(xml => {
    const paras: string[] = []
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi
    let m
    while ((m = pRe.exec(xml))) paras.push(tText(m[1]))
    if (paras.length) return paras.filter(Boolean).join('\n')
    return tText(xml)
  })
}

function extractPptx(entries: Map<string, ZipEntry>): Promise<string> {
  const slides = [...entries.keys()]
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(
      (a, b) =>
        Number(/slide(\d+)/i.exec(a)?.[1]) - Number(/slide(\d+)/i.exec(b)?.[1])
    )
  return Promise.all(
    slides.map(async (name, i) => {
      const entry = entries.get(name)!
      const xml = await extractZipText(entry)
      const texts = []
      const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi
      let m
      while ((m = tRe.exec(xml))) texts.push(unescapeXml(m[1]))
      const body = texts.join(' ').trim()
      return body ? `### Slide ${i + 1}\n\n${body}` : ''
    })
  ).then(parts => parts.filter(Boolean).join('\n\n'))
}

function extractOds(entries: Map<string, ZipEntry>): Promise<string> {
  const content = entries.get('content.xml')
  if (!content) return Promise.resolve('')
  return extractZipText(content).then(xml => {
    const tables: string[] = []
    const tableRe =
      /<table:table\b[^>]*>([\s\S]*?)<\/table:table>/gi
    let tm
    while ((tm = tableRe.exec(xml))) {
      const tableHtml = tm[1]
      const rows: string[][] = []
      const rowRe = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi
      let rm
      while ((rm = rowRe.exec(tableHtml))) {
        const cells: string[] = []
        const cellRe =
          /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi
        let cm
        while ((cm = cellRe.exec(rm[1]))) {
          const repeats = Number(
            /table:number-columns-repeated="(\d+)"/.exec(cm[0])?.[1] ?? 1
          )
          const cellText = [...cm[1].matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/gi)]
            .map(x => unescapeXml(x[1]))
            .join(' ')
          for (let k = 0; k < Math.min(repeats, 64); k++)
            cells.push(normalizeCell(cellText))
        }
        if (cells.some(Boolean)) rows.push(cells)
      }
      const text = tableToText(undefined, rows)
      if (text) tables.push(text)
    }
    return tables.join('\n\n')
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
  const parts: string[] = []
  let tm
  while ((tm = tableRe.exec(text))) {
    const rows: string[][] = []
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let rm
    while ((rm = rowRe.exec(tm[1]))) {
      const cells = [...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x =>
        normalizeCell(x[1].replace(/<[^>]+>/g, '').trim())
      )
      if (cells.some(Boolean)) rows.push(cells)
    }
    parts.push(tableToText(undefined, rows))
  }
  return parts.filter(Boolean).join('\n\n')
}

/**
 * Extract human-readable text from an Office file. Throws a localized message
 * when the format is unsupported or the container is unusable.
 */
export async function extractOfficeText(
  name: string,
  bytes: Uint8Array
): Promise<string> {
  const ext = (name.toLowerCase().split('.').pop() ?? '').trim()
  if (['xlsx', 'xlsm'].includes(ext)) {
    const entries = await readZipEntries(bytes)
    return extractXlsx(entries)
  }
  if (ext === 'docx') {
    const entries = await readZipEntries(bytes)
    return extractDocx(entries)
  }
  if (ext === 'pptx') {
    const entries = await readZipEntries(bytes)
    return extractPptx(entries)
  }
  if (ext === 'ods') {
    const entries = await readZipEntries(bytes)
    return extractOds(entries)
  }
  if (ext === 'xls') {
    // Legacy BIFF requires a full OLE2 parser — out of scope. Handle the common
    // "Excel web page" / HTML table exports instead, otherwise guide conversion.
    if (!isOle2(bytes)) {
      const head = new TextDecoder('utf-8', { fatal: false }).decode(
        bytes.subarray(0, 1024)
      )
      if (/<table\b/i.test(head) || /<html\b/i.test(head)) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
        return extractHtmlTable(text)
      }
    }
    return ''
  }
  throw new Error(`unsupported format: ${ext}`)
}