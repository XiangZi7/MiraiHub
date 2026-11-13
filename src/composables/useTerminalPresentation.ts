import { computed, reactive, toRefs, watch, type Ref } from 'vue'
import type { IDecoration, IMarker, Terminal } from '@xterm/xterm'
import { useSettings } from '@/composables/useSettings'
import type { SshDirectoryListing } from '@/types/ssh'
import {
  codeColorSpans,
  commandColorSpans,
  outputColorSpans,
  terminalSourcePath,
  type TerminalColorSpan,
  type TerminalFileEntry,
} from '@/utils/terminal-highlighting'

interface PromptSegment {
  start: number
  end: number
  color: 'foreground' | 'blue' | 'magenta'
}

interface TerminalPrompt {
  directory: string
  branch: string
  length: number
  segments: PromptSegment[]
}

interface CommandSection {
  marker: IMarker
  prompt?: TerminalPrompt
  startedAt?: number
  duration?: number
  exitCode?: number
  branch?: string
  command?: string
  files?: TerminalFileEntry[]
  codeCache?: { text: string; path: string; spans: TerminalColorSpan[] }
}

interface PresentationOptions {
  readGitBranch?: (sessionId: string, directory: string) => Promise<string>
  readDirectory?: (
    sessionId: string,
    directory: string
  ) => Promise<SshDirectoryListing>
}

/** 识别常见单行提示符的文字区段，仅用于装饰；不改写远端输出或用户的 Shell 配置。 */
export function parseTerminalPrompt(text: string): TerminalPrompt | undefined {
  const unix = text.match(/^([\w.-]+@[\w.-]+:)((?:~|\/).*?)([$#%])(?: |$)/u)
  const windows = text.match(/^(PS )?([A-Za-z]:\\[^>\r\n]*)>(?: |$)/u)
  if (unix) {
    const prefix = unix[1]!
    const path = unix[2]!
    const branch = path.match(/\s+[⎇⑂]\s*(\S+)\s*$/u)
    const directory = branch
      ? path.slice(0, branch.index).trimEnd()
      : path.trimEnd()
    return {
      directory,
      branch: branch?.[1] ?? '',
      length: unix[0].length,
      segments: [
        { start: 0, end: prefix.length, color: 'foreground' },
        {
          start: prefix.length,
          end: prefix.length + directory.length,
          color: 'blue',
        },
        {
          start: prefix.length + directory.length,
          end: unix[0].length,
          color: 'magenta',
        },
      ],
    }
  }
  if (windows) {
    const start = windows[1]?.length ?? 0
    return {
      directory: windows[2]!,
      branch: '',
      length: windows[0].length,
      segments: [
        { start: 0, end: start, color: 'foreground' },
        { start, end: start + windows[2]!.length, color: 'blue' },
        {
          start: start + windows[2]!.length,
          end: windows[0].length,
          color: 'magenta',
        },
      ],
    }
  }
  return undefined
}

/** 共用真实终端位置与命令装饰；样式变更不向交互 Shell 注入命令、不重建会话。 */
export function useTerminalPresentation(
  term: Ref<Terminal | undefined>,
  sessionId: Ref<string>,
  options: PresentationOptions = {}
) {
  const { readGitBranch, readDirectory } = options
  const { settings } = useSettings()
  const v4 = computed(() => settings.terminalStyle === 'v4')
  // 响应式状态
  const state = reactive({
    // 从提示符或 Shell 的 OSC 目录标记获得的实际路径
    directory: '',
    // 来自提示符或远端 Git 查询的实际分支名称
    branch: '',
    // Git 查询失败时保留真实原因，供底栏查看与重试。
    gitError: '',
    // 新提示符出现后刷新 Git 上下文，涵盖同目录内的 git switch / checkout。
    promptRevision: 0,
    // xterm 当前网格中的光标行、列，均从 1 开始
    line: 1,
    column: 1,
    // 终端实际网格尺寸，供状态栏辅助提示
    cols: 0,
    rows: 0,
  })
  const position = computed(() => `Ln ${state.line}, Col ${state.column}`)
  const size = computed(() => `${state.cols} × ${state.rows}`)
  let activeSection: CommandSection | undefined

  /** 在实际提交链路、发送给远端前计时，兼容快速回显和程序插入的命令。 */
  function trackSubmit(command: string): void {
    if (!command.trim() || !activeSection || activeSection.marker.isDisposed)
      return
    activeSection.command = command
    activeSection.startedAt ??= performance.now()
  }

  // 更换底层实例或会话时重建监听；重连后旧命令的标记和计时不会进入新会话。
  watch(
    [term, sessionId],
    ([terminal], _, cleanup) => {
      state.directory = ''
      state.branch = ''
      state.gitError = ''
      state.promptRevision = 0
      activeSection = undefined
      if (!terminal) return
      let sections: CommandSection[] = []
      let decorations: IDecoration[] = []
      let frame = 0
      let scanFrom = 0
      let renderedTheme = terminal.options.theme
      let alive = true
      let paintMarkers = new Map<number, IMarker>()

      /** 将终端光标与网格尺寸同步到底栏，包括方向键移动和窗口缩放。 */
      function syncPosition(): void {
        const buffer = terminal!.buffer.active
        state.line = buffer.cursorY + 1
        state.column = buffer.cursorX + 1
        state.cols = terminal!.cols
        state.rows = terminal!.rows
      }

      /** 释放展示装饰；原始缓冲区、选区、光标和远端 Shell 完全由 xterm 保持。 */
      function clearDecorations(): void {
        decorations.forEach(item => item.dispose())
        decorations = []
        paintMarkers.forEach(marker => marker.dispose())
        paintMarkers.clear()
      }

      /** 创建跟随指定缓冲行的命令分区；回滚裁剪后的标记自动失效，历史最多保留 160 段。 */
      function beginSection(line: number): CommandSection | undefined {
        const existing = sections.find(section => section.marker.line === line)
        if (existing) return existing
        const buffer = terminal!.buffer.active
        if (buffer.type !== 'normal') return
        const marker = terminal!.registerMarker(
          line - buffer.baseY - buffer.cursorY
        )
        if (!marker) return
        const previous = sections.at(-1)
        if (
          previous?.startedAt !== undefined &&
          previous.duration === undefined
        )
          previous.duration = performance.now() - previous.startedAt
        const section = { marker }
        // ls 未开启 --color 时，按实际目录项类型补色，不猜测名称代表文件还是目录。
        if (
          v4.value &&
          readDirectory &&
          previous?.prompt &&
          /^(?:ls|ll)(?:\s+-[\w-]+(?:=\w+)?)*\s*$/u.test(previous.command ?? '')
        ) {
          void readDirectory(sessionId.value, previous.prompt.directory)
            .then(listing => {
              if (!alive || previous.marker.isDisposed) return
              previous.files = listing.entries
              scheduleRender()
            })
            .catch(() => {
              /* 可选文件配色失败不影响原始输出。 */
            })
        }
        sections.push(section)
        activeSection = section
        state.promptRevision++
        if (sections.length > 160) sections.shift()?.marker.dispose()
        scheduleRender()
        return section
      }

      /** 合并连续输出、OSC 标记和尺寸变化引起的装饰刷新，每帧最多更新一次。 */
      function scheduleRender(): void {
        if (frame) return
        frame = requestAnimationFrame(render)
      }

      /** 把提示符的字符串偏移转换为 xterm 列，兼容中文、emoji 和组合字符的实际宽度。 */
      function cellOffset(line: number, offset: number): number {
        const bufferLine = terminal!.buffer.normal.getLine(line)
        let length = 0
        for (let column = 0; column < terminal!.cols; column++) {
          if (length >= offset) return column
          const cell = bufferLine?.getCell(column)
          if (cell?.getWidth() === 0) continue
          length += cell?.getChars().length || 1
        }
        return terminal!.cols
      }

      /** 将语法区间画到原有网格上；服务端已经提供的 ANSI/真彩色优先保留。 */
      function paintSpans(
        line: number,
        spans: readonly TerminalColorSpan[],
        marker?: IMarker,
        force = false
      ): void {
        const buffer = terminal!.buffer.normal
        if (
          line < buffer.viewportY ||
          line >= buffer.viewportY + terminal!.rows
        )
          return
        const bufferLine = buffer.getLine(line)
        for (const span of spans) {
          const color = terminal!.options.theme?.[span.color]
          if (!color?.match(/^#[\da-f]{6}$/iu)) continue
          const start = cellOffset(line, span.start),
            end = cellOffset(line, span.end)
          let run = -1
          for (let column = start; column <= end; column++) {
            const cell = bufferLine?.getCell(column)
            const plain =
              force ||
              cell?.isFgDefault() ||
              (cell?.isFgPalette() && [7, 15].includes(cell.getFgColor()))
            if (column < end && plain) {
              if (run < 0) run = column
              continue
            }
            if (run < 0) continue
            let anchor = marker || paintMarkers.get(line)
            if (!anchor) {
              anchor = terminal!.registerMarker(
                line - buffer.baseY - buffer.cursorY
              )
              if (anchor) paintMarkers.set(line, anchor)
            }
            if (anchor) {
              const decoration = terminal!.registerDecoration({
                marker: anchor,
                x: run,
                width: column - run,
                foregroundColor: color,
              })
              if (decoration) decorations.push(decoration)
            }
            run = -1
          }
        }
      }

      /** 对命令输出作语义配色；cat/head 等明确查看源码时复用 CodeMirror 语言解析。 */
      function paintOutput(section: CommandSection, end: number): void {
        const buffer = terminal!.buffer.normal
        let start = section.marker.line + 1
        while (buffer.getLine(start)?.isWrapped && start < end) start++
        for (
          let line = Math.max(start, buffer.viewportY);
          line < Math.min(end, buffer.viewportY + terminal!.rows);
          line++
        ) {
          const text = buffer.getLine(line)?.translateToString(true) ?? ''
          paintSpans(line, outputColorSpans(text, section.files))
        }
        const path = terminalSourcePath(
          section.command ?? '',
          section.prompt?.directory
        )
        if (!path || end - start > 400) return
        let text = ''
        const rows: { line: number; from: number; length: number }[] = []
        for (let line = start; line < end; line++) {
          const content = buffer.getLine(line)?.translateToString(true) ?? ''
          if (line > start && !buffer.getLine(line)?.isWrapped) text += '\n'
          rows.push({ line, from: text.length, length: content.length })
          text += content
        }
        if (section.codeCache?.text !== text || section.codeCache.path !== path)
          section.codeCache = { text, path, spans: codeColorSpans(text, path) }
        for (const row of rows) {
          if (
            row.line < buffer.viewportY ||
            row.line >= buffer.viewportY + terminal!.rows
          )
            continue
          const spans = section.codeCache.spans
            .filter(
              span => span.start < row.from + row.length && span.end > row.from
            )
            .map(span => ({
              ...span,
              start: Math.max(0, span.start - row.from),
              end: Math.min(row.length, span.end - row.from),
            }))
          paintSpans(row.line, spans)
        }
      }

      /** 用公开 decoration API 绘制提示符分色、段落发丝线和已完成输出的轻微降亮。 */
      function render(): void {
        frame = 0
        renderedTheme = terminal!.options.theme
        clearDecorations()
        sections = sections.filter(section => !section.marker.isDisposed)
        if (!v4.value || terminal!.buffer.active.type !== 'normal') return
        const theme = terminal!.options.theme
        for (const [index, section] of sections.entries()) {
          const next = sections[index + 1]
          const line = section.marker.line
          // 不为不可见历史创建 DOM 装饰，marker 仍保留以支持向上回看。
          const end =
            next?.marker.line ?? terminal!.buffer.normal.baseY + terminal!.rows
          if (
            end < terminal!.buffer.normal.viewportY ||
            line >= terminal!.buffer.normal.viewportY + terminal!.rows
          )
            continue
          const boundary =
            settings.terminalCommandBlocks &&
            terminal!.registerDecoration({
              marker: section.marker,
              width: terminal!.cols,
            })
          if (boundary) {
            boundary.onRender(element =>
              element.classList.add('mirai-command-boundary')
            )
            decorations.push(boundary)
          }
          for (const segment of section.prompt?.segments ?? []) {
            const x = cellOffset(line, segment.start)
            const width = cellOffset(line, segment.end) - x
            const color = theme?.[segment.color]
            // xterm 的 decoration 只接受六位十六进制色值。
            if (!width || !color?.match(/^#[\da-f]{6}$/iu)) continue
            const decoration = terminal!.registerDecoration({
              marker: section.marker,
              x,
              width,
              foregroundColor: color,
            })
            if (decoration) decorations.push(decoration)
          }
          if (section.prompt) {
            const text =
              terminal!.buffer.normal.getLine(line)?.translateToString(true) ??
              ''
            const command = text.slice(section.prompt.length)
            paintSpans(
              line,
              commandColorSpans(command).map(span => ({
                ...span,
                start: span.start + section.prompt!.length,
                end: span.end + section.prompt!.length,
              })),
              section.marker
            )
          }
          paintOutput(
            section,
            next?.marker.line ??
              terminal!.buffer.normal.baseY +
                terminal!.buffer.normal.cursorY +
                1
          )
          if (next && next.marker.line > line) {
            const muted = terminal!.registerDecoration({
              marker: section.marker,
              width: terminal!.cols,
              height: next.marker.line - line,
            })
            if (muted) {
              muted.onRender(element =>
                element.classList.add('mirai-command-muted')
              )
              decorations.push(muted)
            }
          }
          if (!settings.terminalCommandBlocks) continue
          const failed =
            section.exitCode !== undefined && section.exitCode !== 0
          const label = failed
            ? `exit ${section.exitCode}`
            : section.duration !== undefined
              ? `${(section.duration / 1000).toFixed(1)}s`
              : ''
          const text =
            terminal!.buffer.normal.getLine(line)?.translateToString(true) ?? ''
          const branchLabel =
            !section.prompt?.branch && section.branch
              ? `⎇ ${section.branch}`
              : ''
          const textWidth = cellOffset(line, text.length)
          const wrapped = terminal!.buffer.normal.getLine(line + 1)?.isWrapped
          if (
            branchLabel &&
            !wrapped &&
            textWidth + branchLabel.length + label.length + 6 < terminal!.cols
          ) {
            const git = terminal!.registerDecoration({
              marker: section.marker,
              anchor: 'right',
              x: label ? label.length + 4 : 1,
              width: branchLabel.length + 1,
            })
            if (git) {
              git.onRender(element => {
                element.classList.add('mirai-command-branch')
                element.textContent = branchLabel
              })
              decorations.push(git)
            }
          }
          if (
            !label ||
            textWidth + label.length + 3 > terminal!.cols ||
            wrapped
          )
            continue
          const meta = terminal!.registerDecoration({
            marker: section.marker,
            anchor: 'right',
            // xterm 的 x=0 会清空 right 内联样式，导致耗时落到左侧并压住提示符。
            x: 1,
            width: label.length + 1,
          })
          if (meta) {
            meta.onRender(element => {
              element.classList.add('mirai-command-meta')
              element.textContent = label
              element.dataset.failed = String(failed)
            })
            decorations.push(meta)
          }
        }
      }

      /** 仅扫描新增的普通缓冲行；未提供集成标记的 Bash/PowerShell 也能得到分段与路径。 */
      function scanPrompts(): void {
        syncPosition()
        const buffer = terminal!.buffer.active
        if (buffer.type !== 'normal') return
        const end = buffer.baseY + buffer.cursorY
        const start = Math.max(0, end - 200, Math.min(scanFrom, end))
        for (let line = start; line <= end; line++) {
          if (buffer.getLine(line)?.isWrapped) continue
          const prompt = parseTerminalPrompt(
            buffer.getLine(line)?.translateToString(true) ?? ''
          )
          if (!prompt) continue
          const section = beginSection(line)
          if (!section) continue
          const command =
            buffer
              .getLine(line)
              ?.translateToString(true)
              .slice(prompt.length) ?? ''
          if (section.command !== command) {
            section.command = command
            scheduleRender()
          }
          if (JSON.stringify(section.prompt) !== JSON.stringify(prompt)) {
            section.prompt = prompt
            scheduleRender()
          }
          if (state.directory !== prompt.directory || prompt.branch)
            state.branch = prompt.branch
          state.directory = prompt.directory
        }
        scanFrom = end
        // 当前行键入内容变化时重新检查 Git 注记的可用空间，避免长命令与注记相撞。
        if (v4.value) scheduleRender()
      }

      /** 读取 Shell 集成的真实执行边界与退出码；返回 false 让其他已有监听器继续收到标记。 */
      function handleShellMark(data: string): boolean {
        if (terminal!.buffer.active.type !== 'normal') return false
        const [kind, value] = data.split(';')
        const buffer = terminal!.buffer.active
        if (kind === 'A') {
          beginSection(buffer.baseY + buffer.cursorY)
        } else if (kind === 'C') {
          const section =
            sections.at(-1) ?? beginSection(buffer.baseY + buffer.cursorY)
          if (section) section.startedAt = performance.now()
        } else if (kind === 'D') {
          const section = sections.at(-1)
          if (section) {
            if (section.startedAt !== undefined)
              section.duration = performance.now() - section.startedAt
            if (value && /^\d+$/u.test(value)) section.exitCode = Number(value)
            scheduleRender()
          }
        } else if (kind === 'P' && value?.startsWith('Cwd=')) {
          state.directory = data
            .slice('P;Cwd='.length)
            .replace(/\\x([\da-f]{2})/giu, (_, hex: string) =>
              String.fromCharCode(parseInt(hex, 16))
            )
        }
        return false
      }

      const disposables = [
        terminal.onCursorMove(syncPosition),
        terminal.onWriteParsed(scanPrompts),
        // 深浅色切换可能不改变网格尺寸，仍需按新的主题颜色重绘提示符装饰。
        terminal.onRender(() => {
          if (renderedTheme !== terminal.options.theme) scheduleRender()
        }),
        terminal.onResize(() => {
          syncPosition()
          scheduleRender()
        }),
        terminal.onScroll(scheduleRender),
        terminal.buffer.onBufferChange(() => {
          syncPosition()
          scheduleRender()
        }),
        terminal.onData(data => {
          if (data !== '\r' || terminal.buffer.active.type !== 'normal') return
          const section = sections.at(-1)
          const buffer = terminal.buffer.active
          const text =
            buffer
              .getLine(buffer.baseY + buffer.cursorY)
              ?.translateToString(true) ?? ''
          // 空回车不计时；已有 OSC C 时沿用 Shell 提供的精确执行起点。
          if (
            section?.prompt &&
            section.startedAt === undefined &&
            text.slice(section.prompt.length).trim()
          )
            trackSubmit(text.slice(section.prompt.length))
        }),
        terminal.parser.registerOscHandler(133, handleShellMark),
        terminal.parser.registerOscHandler(633, handleShellMark),
        terminal.parser.registerOscHandler(7, data => {
          try {
            const url = new URL(data)
            if (url.protocol === 'file:')
              state.directory = decodeURIComponent(url.pathname).replace(
                /^\/([A-Za-z]:\/)/u,
                '$1'
              )
          } catch {
            /* 非标准目录标记不影响终端输出。 */
          }
          return false
        }),
      ]
      const stopStyleWatch = watch(
        () => [settings.terminalStyle, settings.terminalCommandBlocks],
        scheduleRender,
        { flush: 'post' }
      )
      // 普通 Bash 不自带分支；每次新提示符后独立查询实际目录，并丢弃旧目录/旧会话的迟到响应。
      const stopContextWatch = watch(
        () => [state.directory, state.promptRevision, v4.value] as const,
        ([directory, , enabled], _, onCleanup) => {
          const id = sessionId.value
          if (!readGitBranch || !id || !directory || !enabled) return
          const section = sections.at(-1)
          state.gitError = ''
          let current = true
          const timer = setTimeout(() => {
            void readGitBranch(id, directory)
              .then(branch => {
                if (!current || section?.marker.isDisposed) return
                state.branch = section?.prompt?.branch || branch
                if (section) section.branch = state.branch
                scheduleRender()
              })
              .catch(error => {
                // Git 不可用、非仓库目录或通道失败只影响可选上下文，不打断交互终端。
                if (current) {
                  state.branch = section?.prompt?.branch ?? ''
                  state.gitError =
                    error instanceof Error ? error.message : String(error)
                }
              })
          }, 120)
          onCleanup(() => {
            current = false
            clearTimeout(timer)
          })
        },
        { immediate: true, flush: 'post' }
      )
      scanPrompts()
      cleanup(() => {
        alive = false
        stopStyleWatch()
        stopContextWatch()
        cancelAnimationFrame(frame)
        disposables.forEach(item => item.dispose())
        clearDecorations()
        sections.forEach(section => section.marker.dispose())
      })
    },
    { immediate: true, flush: 'post' }
  )

  /** 用户可在底栏重试可选 Git 上下文，不重连或提交交互命令。 */
  function refreshGit(): void {
    state.promptRevision++
  }
  return { v4, ...toRefs(state), position, size, refreshGit, trackSubmit }
}
