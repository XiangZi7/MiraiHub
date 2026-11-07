/** Redis 值的编码转换与查看格式化。 */
export type RedisViewMode = 'text' | 'json' | 'hex' | 'msgpack'

const encoder = new TextEncoder()

export function textToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text))
}
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // 分块拼接，避免大值展开参数超出调用栈。
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
export function base64ToBytes(raw: string): Uint8Array {
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 经典 16 字节一行的十六进制视图。 */
export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.subarray(offset, offset + 16)
    const hex = Array.from(row, b => b.toString(16).padStart(2, '0'))
    const ascii = Array.from(row, b =>
      b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'
    ).join('')
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ').padEnd(23)}  ${hex.slice(8).join(' ').padEnd(23)}  ${ascii}`
    )
  }
  return lines.join('\n')
}

/** 最小 MessagePack 解码器，覆盖规范内全部类型；扩展类型以 {ext, data} 表示。 */
export function decodeMsgpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  let pos = 0
  const take = (n: number) => {
    if (pos + n > bytes.length) throw new Error('MessagePack data is truncated')
    const start = pos
    pos += n
    return start
  }
  const str = (n: number) => decoder.decode(bytes.subarray(take(n), pos))
  const bin = (n: number) =>
    Array.from(bytes.subarray(take(n), pos), b =>
      b.toString(16).padStart(2, '0')
    ).join('')
  const big = (value: bigint) =>
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  const array = (n: number): unknown[] =>
    Array.from({ length: n }, () => read())
  const map = (n: number) => {
    const out: Record<string, unknown> = {}
    for (let i = 0; i < n; i++) {
      const key = read()
      out[typeof key === 'string' ? key : JSON.stringify(key)] = read()
    }
    return out
  }
  const ext = (n: number) => ({ ext: view.getInt8(take(1)), data: bin(n) })
  function read(): unknown {
    const type = bytes[take(1)]!
    if (type <= 0x7f) return type
    if (type >= 0xe0) return type - 0x100
    if ((type & 0xf0) === 0x80) return map(type & 0x0f)
    if ((type & 0xf0) === 0x90) return array(type & 0x0f)
    if ((type & 0xe0) === 0xa0) return str(type & 0x1f)
    switch (type) {
      case 0xc0:
        return null
      case 0xc2:
        return false
      case 0xc3:
        return true
      case 0xc4:
        return bin(view.getUint8(take(1)))
      case 0xc5:
        return bin(view.getUint16(take(2)))
      case 0xc6:
        return bin(view.getUint32(take(4)))
      case 0xc7:
        return ext(view.getUint8(take(1)))
      case 0xc8:
        return ext(view.getUint16(take(2)))
      case 0xc9:
        return ext(view.getUint32(take(4)))
      case 0xca:
        return view.getFloat32(take(4))
      case 0xcb:
        return view.getFloat64(take(8))
      case 0xcc:
        return view.getUint8(take(1))
      case 0xcd:
        return view.getUint16(take(2))
      case 0xce:
        return view.getUint32(take(4))
      case 0xcf:
        return big(view.getBigUint64(take(8)))
      case 0xd0:
        return view.getInt8(take(1))
      case 0xd1:
        return view.getInt16(take(2))
      case 0xd2:
        return view.getInt32(take(4))
      case 0xd3:
        return big(view.getBigInt64(take(8)))
      case 0xd4:
        return ext(1)
      case 0xd5:
        return ext(2)
      case 0xd6:
        return ext(4)
      case 0xd7:
        return ext(8)
      case 0xd8:
        return ext(16)
      case 0xd9:
        return str(view.getUint8(take(1)))
      case 0xda:
        return str(view.getUint16(take(2)))
      case 0xdb:
        return str(view.getUint32(take(4)))
      case 0xdc:
        return array(view.getUint16(take(2)))
      case 0xdd:
        return array(view.getUint32(take(4)))
      case 0xde:
        return map(view.getUint16(take(2)))
      case 0xdf:
        return map(view.getUint32(take(4)))
    }
    throw new Error('Invalid MessagePack type')
  }
  const value = read()
  if (pos !== bytes.length) throw new Error('Trailing bytes after MessagePack')
  return value
}

/** 猜测最合适的查看方式：可解析 JSON 优先，二进制回退到 Hex。 */
export function guessViewMode(text: string, binary: boolean): RedisViewMode {
  if (binary) return 'hex'
  const trimmed = text.trim()
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      /* 不是 JSON。 */
    }
  }
  return 'text'
}

/** 按模式渲染；无法按所选格式解析时抛错，由调用方展示原因。 */
export function formatRedisValue(
  mode: RedisViewMode,
  text: string,
  bytes: Uint8Array
): string {
  if (mode === 'json') return JSON.stringify(JSON.parse(text), null, 2)
  if (mode === 'hex') return hexDump(bytes)
  if (mode === 'msgpack')
    return JSON.stringify(decodeMsgpack(bytes), null, 2) ?? 'null'
  return text
}
