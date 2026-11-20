import type { ShellSuggestion } from '@/types/ssh'

export interface ShellCompletionToken {
  start: number
  raw: string
  value: string
  commandPosition: boolean
  home: boolean
}

/** 扫描末尾 shell token，保留完整替换范围；只解析引用和转义，不求值变量、命令替换或通配符。 */
export function shellCompletionToken(
  line: string
): ShellCompletionToken | undefined {
  let start = -1
  let value = ''
  let quote: '' | "'" | '"' = ''
  let commandPosition = true
  let tokenCommand = true

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (
      (character < ' ' && character !== '\t' && character !== '\n') ||
      character === '\x7f'
    )
      return
    if (quote === "'") {
      if (character === "'") quote = ''
      else value += character
      continue
    }
    if (character === '\\') {
      if (start < 0) {
        start = index
        tokenCommand = commandPosition
      }
      const next = line[index + 1]
      if (next === undefined) continue
      if (next < ' ' && next !== '\n') return
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) {
        value += '\\'
        continue
      }
      index += 1
      if (next !== '\n') value += next
      continue
    }
    if (quote === '"') {
      if (character === '"') quote = ''
      else if (character === '$' || character === '`') return
      else value += character
      continue
    }
    if (/\s/u.test(character)) {
      if (start >= 0) commandPosition = false
      start = -1
      value = ''
      if (character === '\n') commandPosition = true
      continue
    }
    if (';|&()<>'.includes(character)) {
      start = -1
      value = ''
      commandPosition = character !== '<' && character !== '>'
      continue
    }
    if ('$`*?[]{}'.includes(character)) return
    if (
      (character === '#' && start < 0) ||
      (character === '=' && commandPosition)
    )
      return
    if (start < 0) {
      start = index
      tokenCommand = commandPosition
    }
    if (character === "'" || character === '"') quote = character
    else value += character
  }

  if (start < 0) {
    if (commandPosition || !line.trim()) return
    start = line.length
    tokenCommand = false
  }
  const raw = line.slice(start)
  const home = raw === '~' || raw.startsWith('~/')
  if (raw.startsWith('~') && !home) return
  return { start, raw, value, commandPosition: tokenCommand, home }
}

/** 在相同参数和目录前缀内复用候选，输入收窄时即时筛选，不展示另一目录或上一条命令的结果。 */
export function filterShellSuggestions(
  items: readonly ShellSuggestion[],
  token: ShellCompletionToken
): ShellSuggestion[] {
  const prefix = token.value.toLocaleLowerCase()
  return items.filter(item => {
    if (/[\x00-\x1f\x7f]/u.test(item.value)) return false
    const candidate = shellCompletionToken(item.value)
    return (
      candidate !== undefined &&
      candidate.start === 0 &&
      candidate.value.toLocaleLowerCase().startsWith(prefix)
    )
  })
}

/** 构造仅插入文本的 PTY 补全输入；引用或大小写变化时替换整个原始 token，绝不注入控制字符。 */
export function shellSuggestionInput(
  line: string,
  item: ShellSuggestion
): string | undefined {
  const token = shellCompletionToken(line)
  const candidate = shellCompletionToken(item.value)
  if (
    !token ||
    !candidate ||
    candidate.start !== 0 ||
    /[\x00-\x1f\x7f]/u.test(item.value)
  )
    return
  if (
    !candidate.value
      .toLocaleLowerCase()
      .startsWith(token.value.toLocaleLowerCase())
  )
    return
  const value = item.value + (item.kind === 'directory' ? '' : ' ')
  return value.startsWith(token.raw)
    ? value.slice(token.raw.length)
    : '\x7f'.repeat([...token.raw].length) + value
}
