import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const write = (p, s) => writeFileSync(p, s)
const hmr = name => `\nif (import.meta.hot)\n  import.meta.hot.accept(acceptHMRUpdate(${name}, import.meta.hot))\n`

write('src/composables/useSettings.ts', `import { readonly } from 'vue'\nimport { pinia } from '@/stores'\nimport { useSettingsStore } from '@/stores/settings'\nimport type { SettingsValues } from '@/types/settings'\n\n/** 只读适配层，不持有状态。 */\nexport function useSettings() {\n  const store = useSettingsStore()\n  return { settings: readonly(store.values), save: store.save, refresh: store.refresh, defaults: store.defaults }\n}\n\n/** 工具函数在调用时取 store，避免模块加载顺序依赖。 */\nexport function settingsSnapshot(): Readonly<SettingsValues> {\n  return useSettingsStore(pinia).values\n}\nexport function settingNumber(key: keyof SettingsValues, fallback: number): number {\n  const value = Number(settingsSnapshot()[key])\n  return Number.isFinite(value) ? value : fallback\n}\n`)

let s = read('src/composables/useWorkspaceTabs.ts')
s = s.slice(s.indexOf('import { computed'))
s = s.replace('computed, reactive, readonly, watch', 'computed, reactive, toRefs, watch')
s = s.replace("import { settings } from '@/composables/useSettings'", "import { acceptHMRUpdate, defineStore } from 'pinia'\nimport { useSettingsStore } from '@/stores/settings'")
s = s.replace('const state = reactive({', "export const useWorkspaceStore = defineStore('workspace', () => {\nconst settings = useSettingsStore().values\nconst state = reactive({")
s = s.replace('export function useWorkspaceTabs() {\n  return {\n    tabs: readonly(state).tabs,\n    activeId: computed(() => state.activeId),', 'return {\n    ...toRefs(state),')
s = s.replace(/\n}\s*$/, '\n})\n')
s = s.replace('  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))', '  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)) }\n  catch { /* 无法持久化时保留本次运行的连接标签。 */ }')
write('src/stores/workspace.ts', s + hmr('useWorkspaceStore'))
write('src/composables/useWorkspaceTabs.ts', `import { readonly } from 'vue'\nimport { storeToRefs } from 'pinia'\nimport { useWorkspaceStore } from '@/stores/workspace'\nexport type { WorkspaceTab } from '@/stores/workspace'\n\n/** 保留组件的只读接口；状态与动作由 Pinia 持有。 */\nexport function useWorkspaceTabs() {\n  const store = useWorkspaceStore()\n  const { activeId, active } = storeToRefs(store)\n  const { open, close, closeMany, activate, reorder, setStatus, closeByConnection, restore } = store\n  return { tabs: readonly(store.tabs), activeId, active, open, close, closeMany, activate, reorder, setStatus, closeByConnection, restore }\n}\n`)

s = read('src/composables/useConnections.ts')
s = s.slice(s.indexOf('import { computed'))
s = s.replace('computed, reactive, readonly', 'computed, onScopeDispose, reactive, toRefs')
s = "import { acceptHMRUpdate, defineStore } from 'pinia'\n" + s
s = s.replace('const state = reactive({', "export const useConnectionsStore = defineStore('connections', () => {\nconst state = reactive({")
s = s.replace('  loaded: false,', "  loaded: false,\n  error: '',")
s = s.replace('async function refresh(): Promise<void> {\n  const', 'let revision = 0\nlet disposed = false\nasync function refresh(): Promise<void> {\n  const current = ++revision\n  const')
s = s.replace('  // 对外暴露', '  if (disposed || current !== revision) return\n  state.error = \'\'\n  // 对外暴露')
const start = s.indexOf('// 存储变更时自动同步')
const end = s.indexOf('/** 服务器终端', start)
s = s.slice(0, start) + `let initialization: Promise<void> | undefined\nfunction initialize(): Promise<void> {\n  return initialization ??= refresh().catch(error => {\n    state.error = error instanceof Error ? error.message : String(error)\n    initialization = undefined\n    throw error\n  })\n}\nconst unsubscribe = store.subscribe(() => {\n  void refresh().catch(error => { state.error = String(error) })\n})\nonScopeDispose(() => { disposed = true; unsubscribe() })\n\n` + s.slice(end)
s = s.replace('export function useConnections() {\n  return {\n    connections: readonly(state).items,\n    groups: readonly(state).groups,\n    tags: readonly(state).tags,\n    loaded: computed(() => state.loaded),', 'return {\n    ...toRefs(state),\n    initialize,')
s = s.replace(/\n}\s*$/, '\n})\n')
write('src/stores/connections.ts', s + hmr('useConnectionsStore'))
write('src/composables/useConnections.ts', `import { readonly } from 'vue'\nimport { storeToRefs } from 'pinia'\nimport { useConnectionsStore } from '@/stores/connections'\nexport function useConnections() {\n  const store = useConnectionsStore()\n  void store.initialize().catch(() => undefined)\n  const { loaded, sshConnections, databaseConnections } = storeToRefs(store)\n  const { groupsFor, find, refresh, create, update, remove, createGroup, renameGroup, removeGroup, touch } = store\n  return { connections: readonly(store.items), groups: readonly(store.groups), tags: readonly(store.tags), loaded, sshConnections, databaseConnections, groupsFor, find, refresh, create, update, remove, createGroup, renameGroup, removeGroup, touch }\n}\n`)

function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]) }
for (const file of walk('src').filter(p => p.endsWith('.vue'))) {
  let source = read(file)
  const pattern = /import \{ ([^}]+) \} from (['"])@\/composables\/useSettings\2;?/
  const match = source.match(pattern)
  if (!match || !match[1].split(',').map(s => s.trim()).includes('settings')) continue
  const names = [...new Set(match[1].split(',').map(s => s.trim()).filter(n => n !== 'settings').concat('useSettings'))]
  source = source.replace(pattern, `import { ${names.join(', ')} } from '@/composables/useSettings'`)
  // imports 可被提升，但本地状态按惯例放在 imports 之后。
  const scriptEnd = source.indexOf('</script>')
  const lastImport = [...source.slice(0, scriptEnd).matchAll(/^import[\s\S]*?from ['"][^'"]+['"];?\n/gm)].at(-1)
  const pos = lastImport.index + lastImport[0].length
  source = source.slice(0, pos) + '\nconst { settings } = useSettings()\n' + source.slice(pos)
  write(file, source)
}
for (const file of ['src/composables/useSshTerminal.ts', 'src/composables/useLocalTerminal.ts']) {
  let source = read(file).replace('settingNumber, settings', 'settingNumber, settingsSnapshot, useSettings')
  source = source.replace(/(export function use(?:Ssh|Local)Terminal\([^)]*\) \{)/, '$1\n  const { settings } = useSettings()')
  source = source.replace('families[settings.terminalFont]', 'families[settingsSnapshot().terminalFont]')
  if (!source.includes('settingsSnapshot()')) source = source.replace('settingNumber, settingsSnapshot, useSettings', 'settingNumber, useSettings')
  write(file, source)
}
s = read('src/utils/settings-runtime.ts').replace("import { settings } from '@/composables/useSettings'", "import { pinia } from '@/stores'\nimport { useSettingsStore } from '@/stores/settings'")
s = s.replace('  started = true', '  started = true\n  const settings = useSettingsStore(pinia).values')
write('src/utils/settings-runtime.ts', s)

s = read('src/composables/useFileTransfers.ts')
s = s.replace('computed, reactive, readonly, watch', 'computed, onScopeDispose, reactive, watch')
s = s.replace("import { settingNumber, settings } from '@/composables/useSettings'", "import { settingNumber } from '@/composables/useSettings'\nimport { acceptHMRUpdate, defineStore } from 'pinia'\nimport { useSettingsStore } from '@/stores/settings'")
s = s.replace('const state = reactive(', "export const useTransfersStore = defineStore('transfers', () => {\nconst settings = useSettingsStore().values\nconst state = reactive(")
s = s.replace('let listenerReady:', 'let disposed = false\nlet unlisten: (() => void) | undefined\nonScopeDispose(() => { disposed = true; unlisten?.() })\nlet listenerReady:')
s = s.replace('.then(() => undefined)', '.then(stop => { if (disposed) stop(); else unlisten = stop })')
s = s.replace('export function useFileTransfers() {\n  void ensureListener()\n  return {\n    tasks: readonly(state).items,', 'return {\n    tasks: state.items,\n    ensureListener,')
s = s.replace(/\n}\s*$/, '\n})\n')
write('src/stores/transfers.ts', s + hmr('useTransfersStore'))
write('src/composables/useFileTransfers.ts', `import { readonly } from 'vue'\nimport { storeToRefs } from 'pinia'\nimport { useTransfersStore } from '@/stores/transfers'\nexport type { FileTransferDirection, FileTransferTask } from '@/stores/transfers'\nexport function useFileTransfers() {\n  const store = useTransfersStore()\n  void store.ensureListener()\n  const { activeTasks, completedTasks, failedTasks } = storeToRefs(store)\n  const { upload, download, pause, resume, cancel, pauseAll, resumeAll, clearSettled } = store\n  return { tasks: readonly(store.tasks), activeTasks, completedTasks, failedTasks, upload, download, pause, resume, cancel, pauseAll, resumeAll, clearSettled }\n}\n`)
