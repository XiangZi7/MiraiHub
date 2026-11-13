/** 常见 Shell 提示符，只在新输出行的开头识别，避免修改命令回显与普通日志。 */
const PROMPT =
  /^(?:[\w.-]+@[\w.-]+:(?:~|\/).*?[$#%](?: |$)|(?:PS )?[A-Za-z]:\\[^>\r\n]*>(?: |$))/u
// eslint-disable-next-line no-control-regex
const CONTROL = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[\d;?]*[A-Za-z]/gu
// eslint-disable-next-line no-control-regex
const ALTERNATE = /\x1b\[\?(?:47|1047|1049)([hl])/gu

/**
 * 为 v4 的新提示符补一行段落留白；只缓存可能成为提示符的行首，不改写 ANSI 或命令文字。
 * 超时由调用方 flush，避免无换行日志被一直扣住；全屏程序的备用缓冲区始终原样转发。
 */
export function createTerminalOutputFormatter(enabled: () => boolean) {
  let decoder = new TextDecoder()
  let pending = ''
  let lineStart = true
  let alternate = false
  let modeTail = ''
  let newlines = 0

  /** 将确认后的行首原样交出；只有实际提示符且尚无空行时追加分隔空行。 */
  function release(prompt: boolean): string {
    const value = `${prompt && newlines < 2 ? '\r\n' : ''}${pending}`
    pending = ''
    lineStart = false
    newlines = 0
    return value
  }

  /** 按原顺序消费输出块，UTF-8 跨包字符由同一个解码器保持。 */
  function write(data: string | Uint8Array): string | Uint8Array {
    const value =
      typeof data === 'string' ? data : decoder.decode(data, { stream: true })
    let output = ''
    const controls = modeTail + value
    const modeChanges = [...controls.matchAll(ALTERNATE)]
    // CSI 可以恰好在网络包边界拆开，缓存未闭合的模式前缀以保持全屏程序原样输出。
    modeTail = controls.match(/\x1b(?:\[(?:\?[\d;]*)?)?$/u)?.[0] ?? ''
    if (!enabled() || alternate || modeChanges.length) {
      const buffered = pending
      output = pending + value
      pending = ''
      if (modeChanges.length) alternate = modeChanges.at(-1)![1] === 'h'
      lineStart = value.endsWith('\n')
      newlines = lineStart ? 1 : 0
      return !enabled() && !buffered ? data : output
    }
    for (const character of value) {
      if (character === '\n') {
        output += pending + character
        pending = ''
        lineStart = true
        newlines++
        continue
      }
      if (character === '\r' && !pending) {
        output += character
        continue
      }
      if (!lineStart) {
        output += character
        newlines = 0
        continue
      }
      pending += character
      const plain = pending.replace(CONTROL, '')
      // 转义序列可能被任意拆包，等待它闭合后再判断行首。
      if (plain.includes('\x1b') && pending.length < 2048) continue
      if (PROMPT.test(plain)) output += release(true)
      else if (
        pending.includes('\x1b]133;A\x07') ||
        pending.includes('\x1b]633;A\x07')
      )
        output += release(true)
      else if (!plain) {
        // 颜色和命令结束标记不占字符，也不能让已有空行计数归零。
        output += pending
        pending = ''
      } else if (
        pending.length >= 2048 ||
        (plain &&
          !/^(?:[\w.-]+(?:@[\w.-]*(?::[^\r\n]*)?)?|PS(?: [A-Za-z]?:?\\?[^\r\n]*)?|[A-Za-z]:?\\[^\r\n]*)$/u.test(
            plain
          ))
      )
        output += release(false)
    }
    return output
  }

  /** 放行未闭合的普通行首，供短超时触发；不猜测它是否是一个提示符。 */
  function flush(): string {
    return pending ? release(false) : ''
  }

  /** 新建或重连会话时丢弃旧输出片段与 UTF-8 状态。 */
  function reset(): void {
    decoder = new TextDecoder()
    pending = ''
    lineStart = true
    alternate = false
    modeTail = ''
    newlines = 0
  }

  return { write, flush, reset, hasPending: () => Boolean(pending) }
}
