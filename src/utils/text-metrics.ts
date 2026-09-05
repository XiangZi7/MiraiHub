/** Count lines and UTF-8 bytes without allocating a split array or encoded copy. */
export function textMetrics(text: string): { lines: number; bytes: number } {
  let lines = 1,
    bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 10) lines++
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index++
    } else bytes += 3
  }
  return { lines, bytes }
}
