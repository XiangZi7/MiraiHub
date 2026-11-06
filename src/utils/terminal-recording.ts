import type { Terminal } from '@xterm/xterm'

export type CastEvent = [number, 'o' | 'r', string]
export interface TerminalCast { width: number; height: number; events: CastEvent[]; truncated?: boolean }
interface Capture extends TerminalCast { started: number; bytes: number; decoder: TextDecoder }
const captures = new WeakMap<Terminal, Capture>()
const MAX_BYTES = 16 * 1024 * 1024

/** 用户点击录制时才订阅输出，不记录键盘输入或认证参数。 */
export function startRecording(terminal: Terminal): void {
  captures.set(terminal, { width: terminal.cols, height: terminal.rows, events: [], started: performance.now(), bytes: 0, decoder: new TextDecoder() })
}

/** 从 SSH 原始输出捕获 ANSI 序列；流式解码保留跨包的中文字符。 */
export function recordOutput(terminal: Terminal, bytes: Uint8Array): void {
  const capture = captures.get(terminal)
  if (!capture || capture.truncated) return
  capture.bytes += bytes.byteLength
  if (capture.bytes > MAX_BYTES || capture.events.length >= 100000) { capture.truncated = true; return }
  const data = capture.decoder.decode(bytes, { stream: true })
  if (data) capture.events.push([(performance.now() - capture.started) / 1000, 'o', data])
}

/** 在录制中保留终端尺寸变化，回放时保持交互程序布局。 */
export function recordResize(terminal: Terminal, cols: number, rows: number): void {
  const capture = captures.get(terminal)
  if (capture && !capture.truncated) capture.events.push([(performance.now() - capture.started) / 1000, 'r', `${cols}x${rows}`])
}

/** 结束录制并移除捕获状态，返回可导出和回放的数据。 */
export function stopRecording(terminal: Terminal): TerminalCast | null {
  const capture = captures.get(terminal)
  captures.delete(terminal)
  if (!capture) return null
  const tail = capture.decoder.decode()
  if (tail) capture.events.push([(performance.now() - capture.started) / 1000, 'o', tail])
  return { width: capture.width, height: capture.height, events: capture.events, truncated: capture.truncated }
}

/** 导出标准 asciicast v2，一行头信息加按时间排序的输出事件。 */
export function serializeCast(cast: TerminalCast): string {
  return [JSON.stringify({ version: 2, width: cast.width, height: cast.height }), ...cast.events.map(event => JSON.stringify(event))].join('\n') + '\n'
}

/** 限制导入大小、事件数和时间轴，拒绝无效或不受支持的录制文件。 */
export function parseCast(text: string): TerminalCast {
  if (text.length > MAX_BYTES * 2) throw new Error('Recording exceeds 32 MB')
  const [header, ...lines] = text.trim().split(/\r?\n/u)
  const meta = JSON.parse(header ?? '')
  if (meta.version !== 2 || !Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.width > 500 || meta.height < 1 || meta.height > 200 || lines.length > 100000) throw new Error('Invalid asciicast v2 header')
  const events: CastEvent[] = []
  let previous = 0
  for (const line of lines) {
    const event = JSON.parse(line)
    if (!Array.isArray(event) || event.length !== 3 || !Number.isFinite(event[0]) || event[0] < previous || event[0] > 604800 || typeof event[2] !== 'string') throw new Error('Invalid recording event')
    previous = event[0]
    if (event[1] === 'o' || event[1] === 'r') events.push(event as CastEvent)
  }
  return { width: meta.width, height: meta.height, events }
}
