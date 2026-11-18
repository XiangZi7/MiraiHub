import { watch, type Ref } from 'vue'
import type { IBufferLine, IMarker, Terminal } from '@xterm/xterm'
import { parseColor } from '@/utils/color'
import type { SshRemoteFile } from '@/types/ssh'

type Role = 'green' | 'blue' | 'cyan'
type File = Pick<SshRemoteFile, 'name' | 'kind'> &
  Partial<Pick<SshRemoteFile, 'permissions'>>
type Span = { start: number; end: number; role: Role }
type ReadDirectory = (id: string, path: string) => Promise<readonly File[]>

const LIST_COMMAND =
  /^(?:ls|ll|la)(?:\s+-(?:[1aAbBcCdDfFghHiIklLmnopPqQrRsStuUvwxXZ]+|-all|-almost-all|-classify|-color(?:=auto|=always)?))*$/u

/** 识别常见 Unix 和 Windows 提示符，只标记账号、主机和路径。 */
function parsePrompt(
  text: string
): { path: string; command: string; spans: Span[] } | undefined {
  const unix =
    /^([\w.-]+@[\w.-]+:)((?:~|\/).*?)(?:\s+[⎇⑂]\s*\S+)?[$#%](?: |$)/u.exec(
      text
    )
  if (unix) {
    const prefix = unix[1]!
    const path = unix[2]!
    return {
      path,
      command: text.slice(unix[0].length).trim(),
      spans: [
        { start: 0, end: prefix.indexOf('@'), role: 'green' },
        {
          start: prefix.length,
          end: prefix.length + path.length,
          role: 'blue',
        },
      ],
    }
  }

  const windows = /^(PS )?((?:[A-Za-z]:[\\/]|\\\\)[^>]*)>(?: |$)/u.exec(text)
  if (!windows) return
  const path = windows[2]!
  const start = windows[1]?.length ?? 0
  return {
    path,
    command: text.slice(windows[0].length).trim(),
    spans: [{ start, end: start + path.length, role: 'blue' }],
  }
}

/** 只按真实目录条目给列表补色，普通文件沿用终端前景色。 */
function listingSpans(text: string, files: ReadonlyMap<string, Role>): Span[] {
  const detail = /^[bcdlps-][rwxStTs-]{9}[+.@]?(?:\s+\S+){7}\s+/u.exec(text)
  const start = detail?.[0].length ?? 0
  const names = detail ? text.slice(start).split(' -> ', 1)[0]! : text
  const whole = files.get(names.trim())
  if (whole)
    return [
      {
        start: start + names.search(/\S/u),
        end: start + names.trimEnd().length,
        role: whole,
      },
    ]
  if (/^total\s+\d+\s*$/u.test(text)) return []

  const spans: Span[] = []
  for (const match of names.matchAll(/(?:'[^']*'|"[^"]*")[/*@|=]?|\S+/gu)) {
    const label = match[0]
    const name = label.replace(/[/*@|=]$/u, '').replace(/^(['"])(.*)\1$/u, '$2')
    const role = files.get(label) ?? files.get(name)
    if (role)
      spans.push({
        start: start + match.index,
        end: start + match.index + label.length,
        role,
      })
  }
  return spans
}

/** 把字符串偏移映射到 xterm 网格，仅给没有 ANSI 前景色的连续单元补色。 */
function colorRuns(line: IBufferLine, spans: Span[]): Span[] {
  const runs: Span[] = []
  let column = 0
  let offset = 0
  let index = 0
  const cell = line.getCell(0)
  if (!cell) return runs
  while (column < line.length && index < spans.length) {
    if (!line.getCell(column, cell)) break
    const width = cell.getWidth()
    if (width === 0) {
      column++
      continue
    }
    const length = cell.getChars().length || 1
    while (index < spans.length && spans[index]!.end <= offset) index++
    const span = spans[index]
    if (span && span.start < offset + length && cell.isFgDefault()) {
      const last = runs.at(-1)
      if (last?.end === column && last.role === span.role) last.end += width
      else runs.push({ start: column, end: column + width, role: span.role })
    }
    column += width
    offset += length
  }
  return runs
}

/** 在现有终端网格补色，不改写输出。每帧只更新可见行，断开时隔离目录缓存。 */
export function useTerminalColors(
  term: Ref<Terminal | undefined>,
  sessionId: Ref<string>,
  readDirectory: ReadDirectory
): void {
  watch(
    [term, sessionId],
    ([terminal, id], _, cleanup) => {
      if (!terminal) return
      const painted = new Map<number, { marker: IMarker; key: string }>()
      const directories = new Map<
        string,
        { until: number; colors?: Map<string, Role> }
      >()
      let frame = 0
      let disposed = false
      let renderedTheme = terminal.options.theme
      let palette = new Map<Role, string>()

      /** 合并输出、回滚及主题切换的请求，同一帧只刷新一次。 */
      function schedule(): void {
        if (!frame && !disposed) frame = requestAnimationFrame(render)
      }

      /** 查询同一会话中的目录。并发刷新复用结果，迟到的响应只在原会话生效。 */
      function fileColors(path: string): ReadonlyMap<string, Role> | undefined {
        if (!id || !path) return
        const cached = directories.get(path)
        if (cached && cached.until > Date.now()) return cached.colors
        const entry = { until: Infinity, colors: cached?.colors }
        directories.delete(path)
        directories.set(path, entry)
        if (directories.size > 64)
          directories.delete(directories.keys().next().value!)
        void readDirectory(id, path)
          .then(files => {
            if (disposed || directories.get(path) !== entry) return
            const colors = new Map<string, Role>()
            for (const file of files) {
              if (file.kind === 'directory') colors.set(file.name, 'blue')
              else if (file.kind === 'symlink') colors.set(file.name, 'cyan')
              else if (file.permissions && /[xst]/u.test(file.permissions))
                colors.set(file.name, 'green')
            }
            entry.colors = colors
            schedule()
          })
          .catch(() => {})
          .finally(() => {
            entry.until = Date.now() + 10_000
          })
        return entry.colors
      }

      /** 复用颜色和网格位置未变的标记，避免键入时重建整屏装饰。 */
      function paint(row: number, line: IBufferLine, spans: Span[]): boolean {
        if (!spans.length) return false
        const runs = colorRuns(line, spans)
        if (!runs.length) return false
        const key = runs
          .map(run => [run.start, run.end, palette.get(run.role)].join(':'))
          .join(',')
        const previous = painted.get(row)
        if (previous?.key === key && previous.marker.line === row) return true
        previous?.marker.dispose()
        painted.delete(row)
        const buffer = terminal!.buffer.normal
        const marker = terminal!.registerMarker(
          row - buffer.baseY - buffer.cursorY
        )
        if (!marker) return false
        painted.set(row, { marker, key })
        for (const { start, end, role } of runs)
          terminal!.registerDecoration({
            marker,
            x: start,
            width: end - start,
            foregroundColor: palette.get(role),
          })
        return true
      }

      /** 给提示符补色，并只在已提交的列表命令范围内给文件名补色。 */
      function render(): void {
        frame = 0
        const { active: buffer } = terminal!.buffer
        const visible = new Set<number>()
        const theme = terminal!.options.theme
        if (theme !== renderedTheme || !palette.size) {
          renderedTheme = theme
          palette = new Map()
          for (const role of ['green', 'blue', 'cyan'] as const) {
            const color = theme?.[role]
            if (!color) continue
            palette.set(
              role,
              '#' +
                parseColor(color)
                  .map(channel => channel.toString(16).padStart(2, '0'))
                  .join('')
            )
          }
        }

        if (buffer.type === 'normal' && palette.size) {
          const top = buffer.viewportY
          const bottom = Math.min(buffer.length, top + terminal!.rows)
          const cursor = buffer.baseY + buffer.cursorY
          let listPath: string | undefined
          // 窗口滚到列表中间时，只向上找最近的提示符作为当前输出的上下文。
          for (let row = top - 1; row >= Math.max(0, top - 120); row--) {
            const line = buffer.getLine(row)
            if (!line || line.isWrapped) continue
            const prompt = parsePrompt(line.translateToString(true))
            if (!prompt) continue
            if (LIST_COMMAND.test(prompt.command)) listPath = prompt.path
            break
          }
          for (let row = top; row < bottom; row++) {
            const line = buffer.getLine(row)
            if (!line) continue
            const text = line.translateToString(true)
            const prompt = !line.isWrapped && parsePrompt(text)
            if (prompt) {
              listPath =
                row < cursor && LIST_COMMAND.test(prompt.command)
                  ? prompt.path
                  : undefined
              if (paint(row, line, prompt.spans)) visible.add(row)
            } else if (listPath && text) {
              const files = fileColors(listPath)
              if (files?.size && paint(row, line, listingSpans(text, files)))
                visible.add(row)
            }
          }
        }
        for (const [row, entry] of painted) {
          if (visible.has(row)) continue
          entry.marker.dispose()
          painted.delete(row)
        }
      }

      const listeners = [
        terminal.onWriteParsed(schedule),
        terminal.onResize(schedule),
        terminal.onScroll(schedule),
        terminal.buffer.onBufferChange(schedule),
        terminal.onRender(() => {
          if (renderedTheme !== terminal.options.theme) schedule()
        }),
      ]
      cleanup(() => {
        disposed = true
        cancelAnimationFrame(frame)
        for (const listener of listeners) listener.dispose()
        for (const { marker } of painted.values()) marker.dispose()
      })
      schedule()
    },
    { immediate: true }
  )
}
