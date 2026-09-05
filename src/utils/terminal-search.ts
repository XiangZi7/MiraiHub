import type { IBuffer } from '@xterm/xterm'

export interface TerminalMatch {
  row: number
  column: number
  length: number
}

/** 按终端单元格映射文本，支持中文宽字符、组合字符和自动折行。 */
export function findTerminalMatches(
  buffer: IBuffer,
  query: string,
): TerminalMatch[] {
  if (!query) return []
  const matches: TerminalMatch[] = []
  let text = ''
  let positions: Array<{
    row: number
    column: number
    width: number
    offset: number
  }> = []
  let offset = 0
  const flush = () => {
    let start = text.indexOf(query)
    while (start !== -1) {
      const first = positions[start]!
      const last = positions[start + query.length - 1]!
      matches.push({
        row: first.row,
        column: first.column,
        length: last.offset + last.width - first.offset,
      })
      start = text.indexOf(query, start + 1)
    }
    text = ''
    positions = []
    offset = 0
  }
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)
    if (!line) continue
    if (!line.isWrapped) flush()
    for (let column = 0; column < line.length; column++) {
      const cell = line.getCell(column)
      if (!cell || cell.getWidth() === 0) continue
      const chars = cell.getChars() || ' '
      const width = cell.getWidth()
      text += chars
      for (let index = 0; index < chars.length; index++)
        positions.push({ row, column, width, offset: offset + column })
    }
    offset += line.length
  }
  flush()
  return matches
}
