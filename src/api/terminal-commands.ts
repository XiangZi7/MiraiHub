import type { TerminalCommand } from '@/types/terminal-command'
import { DEFAULT_TERMINAL_COMMANDS } from '@/constants/terminal-commands'

const STORAGE_KEY = 'miraihub.terminal-commands.v1'
const CHANGE_EVENT = 'miraihub:terminal-commands-changed'

function validCommand(value: unknown): value is TerminalCommand {
  if (!value || typeof value !== 'object') return false
  const item = value as TerminalCommand
  return (
    typeof item.id === 'string' &&
    Boolean(item.id) &&
    typeof item.name === 'string' &&
    Boolean(item.name.trim()) &&
    item.name.length <= 80 &&
    typeof item.command === 'string' &&
    Boolean(item.command.trim()) &&
    item.command.length <= 8192 &&
    !/[\u0000-\u001f\u007f]/u.test(item.command)
  )
}

export function list(): TerminalCommand[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return DEFAULT_TERMINAL_COMMANDS.map(item => ({ ...item }))
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('常用指令数据格式无效')
  const seen = new Set<string>()
  return parsed
    .filter(validCommand)
    .filter(item => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .map(({ id, name, command }) => ({ id, name, command }))
}
function write(items: TerminalCommand[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}
export function save(name: string, command: string, id?: string): void {
  const item = {
    id: id ?? `command-${crypto.randomUUID()}`,
    name: name.trim(),
    command: command.trim(),
  }
  if (!validCommand(item))
    throw new Error(
      '请填写名称（最多 80 字）和单行命令（最多 8192 字），命令不能包含换行或控制字符。'
    )
  const items = list()
  if (id) {
    const index = items.findIndex(entry => entry.id === id)
    if (index < 0) throw new Error('该指令已被删除，请重新添加')
    items[index] = item
  } else items.push(item)
  write(items)
}
export function remove(id: string): void {
  write(list().filter(item => item.id !== id))
}
export function move(id: string, direction: -1 | 1): void {
  const items = list()
  const index = items.findIndex(item => item.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item)
  write(items)
}
export function subscribe(handler: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) handler()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, handler)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, handler)
  }
}
