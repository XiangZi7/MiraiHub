import { onScopeDispose } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { writeToShell } from '@/api/ssh'
import { i18n } from '@/i18n'
import { IS_TAURI } from '@/utils/window'
import { toast } from '@/composables/useToast'
import type { Terminal } from '@xterm/xterm'
import type { LocalShellKind } from '@/types/connection'

/**
 * 把文本插入终端（不执行）的共用逻辑，以及命令面板查找“当前标签页终端”的轻量登记表。
 * 终端组件按标签页 id 登记自己，面板只按活动标签页去问，不需要逐层传递实例。
 */
export interface TerminalInsertTarget {
  /** 把已规范为 \n 换行的文本粘贴进终端 */
  paste: (text: string) => Promise<void> | void
  /** 把键盘焦点还给该终端 */
  focus: () => void
}

type TerminalTargetProvider = (
  tabId: string
) => TerminalInsertTarget | undefined

const providers = new Set<TerminalTargetProvider>()

// 查找指定标签页里已连接、可插入文本的终端；没有时返回 undefined。
export function requestTerminalTarget(
  tabId: string
): TerminalInsertTarget | undefined {
  for (const provider of providers) {
    const target = provider(tabId)
    if (target) return target
  }
  return undefined
}

// 登记可插入文本的终端，随所在作用域销毁自动注销。
export function onTerminalTargetRequest(
  provider: TerminalTargetProvider
): void {
  providers.add(provider)
  onScopeDispose(() => providers.delete(provider))
}

// 生成写入 SSH 会话的粘贴函数：多行时用括号粘贴模式，避免 shell 逐行执行。
export function sshPaste(sessionId: string): (text: string) => Promise<void> {
  return text =>
    writeToShell(
      sessionId,
      text.includes('\n')
        ? `\x1b[200~${text.replace(/\n/g, '\r')}\x1b[201~`
        : text
    )
}

// 把文本粘贴到终端但不执行；多行先确认，返回是否已写入（空文本或用户取消时为 false）。
export async function insertToTerminal(
  paste: TerminalInsertTarget['paste'],
  code: string
): Promise<boolean> {
  const { t } = i18n.global
  const text = code.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!text.trim()) return false
  const lines = text.split('\n').length
  if (lines > 1) {
    const message = t(
      '将插入 {value0} 行命令。支持括号粘贴的 shell 会等待你按回车，否则可能逐行执行，确定插入？',
      { value0: lines }
    )
    const confirmed = IS_TAURI
      ? await ask(message, { title: t('插入终端'), kind: 'warning' })
      : window.confirm(message)
    if (!confirmed) return false
  }
  await paste(text)
  return true
}

/** 按当前 Shell 引用路径。控制字符会变成按键，CMD 的百分号或感叹号可能触发变量展开。 */
export function terminalPathText(
  paths: readonly string[],
  shell?: LocalShellKind
): string {
  if (
    paths.some(
      path =>
        !path ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(path) ||
        (shell === 'cmd' && /["%!]/u.test(path))
    )
  )
    return ''

  return paths
    .map(path => {
      if (shell === 'cmd') return '"' + path + '"'
      if (shell === 'powershell')
        return "'" + path.replace(/[‘’‚‛']/gu, quote => quote + quote) + "'"
      const value = shell === 'git-bash' ? path.replaceAll('\\', '/') : path
      return "'" + value.replaceAll("'", "'\\''") + "'"
    })
    .join(' ')
}

/** 把文件路径填入当前光标位置并恢复终端焦点，留给用户确认后执行。 */
export function pasteTerminalPaths(
  terminal: Terminal | undefined,
  paths: readonly string[],
  shell?: LocalShellKind
): void {
  if (!terminal || !paths.length) return
  const text = terminalPathText(paths, shell)
  if (!text) {
    toast.error(i18n.global.t('此路径包含当前终端无法粘贴的字符'))
    return
  }
  terminal.paste(text)
  terminal.focus()
}
