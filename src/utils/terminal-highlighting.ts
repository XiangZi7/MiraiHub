import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { codeLanguage } from '@/utils/code-language'
import type { SshRemoteFile } from '@/types/ssh'

export type TerminalColorRole =
  | 'foreground'
  | 'brightBlack'
  | 'blue'
  | 'green'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'red'
export interface TerminalColorSpan {
  start: number
  end: number
  color: TerminalColorRole
}
export type TerminalFileEntry = Pick<
  SshRemoteFile,
  'name' | 'kind' | 'permissions'
>

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'magenta' },
  { tag: [tags.string, tags.special(tags.string)], class: 'green' },
  { tag: [tags.comment, tags.meta], class: 'brightBlack' },
  { tag: [tags.number, tags.bool, tags.null], class: 'yellow' },
  {
    tag: [tags.variableName, tags.definition(tags.variableName)],
    class: 'cyan',
  },
  {
    tag: [
      tags.propertyName,
      tags.attributeName,
      tags.labelName,
      tags.typeName,
      tags.tagName,
      tags.heading,
      tags.function(tags.variableName),
    ],
    class: 'blue',
  },
  { tag: [tags.operator, tags.punctuation], class: 'magenta' },
])

/** 用远程编辑器共用的语言解析器生成文本区间，不生成 HTML 或改变终端缓冲内容。 */
export function codeColorSpans(
  text: string,
  path: string
): TerminalColorSpan[] {
  const parser = codeLanguage(path).parser
  if (!parser || text.length > 65536) return []
  const spans: TerminalColorSpan[] = []
  highlightTree(parser.parse(text), highlighter, (start, end, classes) => {
    spans.push({
      start,
      end,
      color: classes.split(' ')[0] as TerminalColorRole,
    })
  })
  return spans
}

/** Bash 语法负责字符串、变量和注释，再补齐命令名、选项与管道等终端常用区段。 */
export function commandColorSpans(text: string): TerminalColorSpan[] {
  if (text.length > 8192) return []
  const spans = codeColorSpans(text, 'command.sh')
  const protectedSpans = spans.filter(
    span => span.color === 'green' || span.color === 'brightBlack'
  )
  const patterns: [RegExp, TerminalColorRole][] = [
    [/(?:^\s*|(?:\|\||&&|[|;])\s*)([\w./~-]+)/gu, 'blue'],
    [/(?:^|\s)(--?[\w][\w-]*)/gu, 'yellow'],
    [/([|&;<>]+)/gu, 'magenta'],
  ]
  for (const [pattern, color] of patterns)
    for (const match of text.matchAll(pattern)) {
      const value = match[1]!
      const start = match.index! + match[0].lastIndexOf(value)
      if (protectedSpans.some(span => span.start <= start && span.end > start))
        continue
      spans.push({ start, end: start + value.length, color })
    }
  return spans
}

/** 明确查看源码时结合实际工作目录识别语言，让相对路径的 Nginx 站点配置也能触发高亮。 */
export function terminalSourcePath(
  command: string,
  directory?: string
): string | undefined {
  const words = command.trim().match(/'[^']*'|"(?:\\.|[^"\\])*"|\S+/gu) ?? []
  if (!/^(?:cat|bat|head|tail|less|more)$/u.test(words[0] ?? '')) return
  const boundary = words.findIndex(word => /^[|;&<>]/u.test(word))
  const args = (boundary < 0 ? words : words.slice(0, boundary)).slice(1)
  const path = args.at(-1)?.replace(/^(['"])(.*)\1$/u, '$2')
  if (!path || path.startsWith('-') || /[*?]/u.test(path)) return
  const resolved =
    directory && !/^(?:\/|[A-Za-z]:[\\/]|~(?:\/|$))/u.test(path)
      ? `${directory.replace(/[\\/]$/u, '')}/${path}`
      : path
  return codeLanguage(resolved).parser ? resolved : undefined
}

/** 为无 ANSI 颜色的成功/错误输出与真实目录项补色，不凭名称猜测文件类型。 */
export function outputColorSpans(
  text: string,
  files: readonly TerminalFileEntry[] = []
): TerminalColorSpan[] {
  if (
    /^\s*(?:Already up[ -]to[ -]date\.?|Everything up[ -]to[ -]date|Fast-forward|[✓✔]|成功|部署完成)/iu.test(
      text
    )
  )
    return [{ start: 0, end: text.length, color: 'green' }]
  if (
    /^\s*(?:fatal:|error:|\w*sh:.*(?:denied|not found|error)|Traceback|Permission denied|command not found)/iu.test(
      text
    )
  )
    return [{ start: 0, end: text.length, color: 'red' }]
  const spans: TerminalColorSpan[] = []
  for (const file of files) {
    if (!file.name) continue
    let offset = 0
    while (offset < text.length) {
      const start = text.indexOf(file.name, offset)
      if (start < 0) break
      const end = start + file.name.length
      offset = end
      if (
        (start && !/\s/u.test(text[start - 1]!)) ||
        (end < text.length && !/[\s/*@|=]/u.test(text[end]!))
      )
        continue
      const color =
        file.kind === 'directory'
          ? 'blue'
          : file.kind === 'symlink'
            ? 'cyan'
            : /[xst]/u.test(file.permissions)
              ? 'green'
              : 'foreground'
      spans.push({
        start,
        end: /[/*@]/u.test(text[end] ?? '') ? end + 1 : end,
        color,
      })
      if (/^[bcdlps-][rwxstST-]{9}/u.test(text) && start)
        spans.push({ start: 0, end: start, color: 'brightBlack' })
      if (file.kind === 'symlink' && text.slice(end).includes(' -> '))
        spans.push({ start: end, end: text.length, color: 'cyan' })
    }
  }
  return spans
}
