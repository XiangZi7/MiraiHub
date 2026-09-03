import type { StartupCommandPreset } from '@/types/command-preset'

const STORAGE_KEY = 'miraihub.startup-command-presets.v1'
const CHANGE_EVENT = 'miraihub:startup-command-presets-changed'

function readAll(): StartupCommandPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed))
      return []

    return parsed.filter((item): item is StartupCommandPreset => (
      typeof item === 'object'
      && item !== null
      && typeof item.id === 'string'
      && typeof item.name === 'string'
      && typeof item.command === 'string'
      && typeof item.createdAt === 'number'
      && typeof item.updatedAt === 'number'
    ))
  }
  catch (error) {
    console.warn('读取初始化命令预设失败，按空列表处理：', error)
    return []
  }
}

function writeAll(presets: StartupCommandPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export async function list(): Promise<StartupCommandPreset[]> {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 同名预设直接更新，避免不小心存出一排重复项。 */
export async function save(name: string, command: string): Promise<StartupCommandPreset> {
  const trimmedName = name.trim()
  const trimmedCommand = command.trim()
  const presets = readAll()
  const existing = presets.find(item => item.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())
  const now = Date.now()
  const preset: StartupCommandPreset = existing
    ? { ...existing, name: trimmedName, command: trimmedCommand, updatedAt: now }
    : {
        id: `startup-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        command: trimmedCommand,
        createdAt: now,
        updatedAt: now,
      }

  writeAll(existing
    ? presets.map(item => item.id === existing.id ? preset : item)
    : [...presets, preset])

  return preset
}

export async function remove(id: string): Promise<void> {
  writeAll(readAll().filter(item => item.id !== id))
}

export function subscribe(handler: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY || event.key === null)
      handler()
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, handler)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, handler)
  }
}

