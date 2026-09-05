/**
 * 快捷键的解析、匹配与录制。
 *
 * 存储格式统一为 `Ctrl+Shift+K` 这样的加号连接串：
 * 修饰键顺序固定为 Ctrl、Alt、Shift、Meta，主键大写。
 */

export interface ParsedShortcut {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

const MODIFIER_ALIASES: Record<string, keyof Omit<ParsedShortcut, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'OS',
  'AltGraph',
])

/** 允许不带修饰键单独使用的按键：功能键 */
const STANDALONE_KEY = /^F([1-9]|1[0-9]|2[0-4])$/

/** 把 KeyboardEvent.key 规范成存储用的主键名。 */
export function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}

export function parseShortcut(value: string): ParsedShortcut | null {
  const parts = value
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
  if (!parts.length) return null

  const parsed: ParsedShortcut = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: '',
  }

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) {
      parsed[modifier] = true
      continue
    }
    if (parsed.key) return null
    parsed.key = normalizeKey(part)
  }

  return parsed.key ? parsed : null
}

export function matchesShortcut(event: KeyboardEvent, value: string): boolean {
  const parsed = parseShortcut(value)
  if (!parsed) return false

  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta &&
    normalizeKey(event.key).toLowerCase() === parsed.key.toLowerCase()
  )
}

/**
 * 从按键事件生成快捷键串。只按了修饰键、或主键不带修饰键（功能键除外）时返回 null。
 */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const key = normalizeKey(event.key)
  const hasModifier =
    event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
  if (!hasModifier && !STANDALONE_KEY.test(key)) return null

  // Shift 单独配字母、数字没有意义（等同于输入大写字符）
  if (
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.shiftKey &&
    key.length === 1
  )
    return null

  return serializeShortcut({
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key,
  })
}

export function serializeShortcut(parsed: ParsedShortcut): string {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('Meta')
  parts.push(parsed.key)
  return parts.join('+')
}

/** 展示用文案：Space / Arrow 键换成更易读的写法，其余保持原样。 */
export function formatShortcut(value: string): string {
  const parsed = parseShortcut(value)
  if (!parsed) return value

  const display: Record<string, string> = {
    Space: '空格',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: '⏎',
    Backspace: '⌫',
    Delete: 'Del',
    ',': ',',
  }

  return serializeShortcut({
    ...parsed,
    key: display[parsed.key] ?? parsed.key,
  })
}
