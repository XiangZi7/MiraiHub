import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const write = (p, s) => { mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true }); writeFileSync(p, s) }
const original = read('src/components/workspace/MainWindow.vue')
const serverStart = original.indexOf(`          <div v-show="activeNav === 'servers'"`)
const dbStart = original.indexOf(`          <div v-show="activeNav === 'databases'"`)
const keysStart = original.indexOf('          <SshKeysView')
const serverTemplate = original.slice(serverStart, dbStart).replace(`v-show="activeNav === 'servers'" `, '')
const databaseTemplate = original.slice(dbStart, keysStart).replace(`v-show="activeNav === 'databases'" `, '')
const derived = original.slice(original.indexOf('const sshTabViews'), original.indexOf('/**\n * 连接被删除时'))
const serverDerived = derived.slice(0, derived.indexOf('const activeDatabaseConnection'))
const dbDerived = derived.slice(derived.indexOf('const activeDatabaseConnection'))
write('src/pages/workspace/ServersPage.vue', `<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'
import { MACHINE_MIN_WIDTH, useWorkspaceLayoutStore } from '@/stores/workspace-layout'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { registerWorkspaceController } from '@/composables/useWorkspaceControllers'
import { useWorkspaceStatus } from '@/composables/useWorkspaceStatus'
import { isLocalConnection, toSshConfig, type LocalConnectionSettings } from '@/types/connection'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import MachinePanel from '@/components/workspace/MachinePanel.vue'
import LocalTerminalPanel from '@/components/workspace/LocalTerminalPanel.vue'
import TerminalPanel from '@/components/workspace/TerminalPanel.vue'
import SshTerminalWorkspace from '@/components/workspace/SshTerminalWorkspace.vue'
const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const { machineWidth, machineOpen, machineView, machineMaxWidth } = storeToRefs(useWorkspaceLayoutStore())
const { activeNav } = useWorkspaceNavigation()
const sshWorkspaces = useTemplateRef<Array<InstanceType<typeof SshTerminalWorkspace>>>('sshWorkspaces')
const localTerminals = useTemplateRef<Array<InstanceType<typeof LocalTerminalPanel>>>('localTerminals')
const machinePanel = useTemplateRef<InstanceType<typeof MachinePanel>>('machinePanel')
const handleSshStatus = useWorkspaceStatus()
${serverDerived}
async function action(id: string, action: string): Promise<void> {
  if (action === 'files' || action === 'upload') {
    machineOpen.value = true
    machineView.value = 'files'
    await nextTick()
    if (action === 'upload') await machinePanel.value?.upload()
    return
  }
  for (const view of [...(sshWorkspaces.value ?? []), ...(localTerminals.value ?? [])]) {
    if (action === 'reconnect') await view.reconnectFor(id)
    else if (action === 'disconnect') await view.disconnectFor(id)
  }
  for (const view of sshWorkspaces.value ?? []) {
    if (action === 'split') await view.splitFor(id)
    else if (action === 'focus') view.focusFor(id)
  }
}
async function runWorkspaceAction(actionName: string): Promise<void> {
  if (activeSshTab.value) await action(activeSshTab.value.id, actionName)
}
registerWorkspaceController('servers', { action })
</script>
<template>
${serverTemplate}
</template>
`)
write('src/pages/workspace/DatabasesPage.vue', `<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { registerWorkspaceController } from '@/composables/useWorkspaceControllers'
import { useWorkspaceStatus } from '@/composables/useWorkspaceStatus'
import { isDatabaseConnection } from '@/types/connection'
import DatabaseView from '@/components/workspace/DatabaseView.vue'
const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const { activeNav } = useWorkspaceNavigation()
const views = useTemplateRef<Array<InstanceType<typeof DatabaseView>>>('databaseViews')
const handleSshStatus = useWorkspaceStatus()
${dbDerived}
registerWorkspaceController('databases', {
  closeWarning: ids => (views.value ?? []).map(view => view.closeWarningFor(ids)).filter(Boolean).join('；'),
  refreshDatabase: id => { for (const view of views.value ?? []) view.refreshForConnection(id) },
  newQuery: async (id, database) => { for (const view of views.value ?? []) await view.newQueryForConnection(id, database) },
  action: async (id, action) => {
    for (const view of views.value ?? []) {
      if (action === 'reconnect') await view.reconnectFor(id)
      else if (action === 'disconnect') await view.disconnectFor(id)
    }
  },
})
</script>
<template>
${databaseTemplate}
</template>
`)
for (const [page, component] of [['SshKeys', 'SshKeysView'], ['Recent', 'RecentView']]) {
  write(`src/pages/workspace/${page}Page.vue`, `<script setup lang="ts">\nimport ${component} from '@/components/workspace/${component}.vue'\n${page === 'Recent' ? "import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'\nconst { openConnection } = useWorkspaceNavigation()\n" : ''}</script>\n<template><${component}${page === 'Recent' ? ' @open="openConnection"' : ''} /></template>\n`)
}

let template = original.slice(original.indexOf('<template>'))
const mainStart = template.indexOf(`          <div v-show="activeNav === 'servers'"`)
const mainEnd = template.indexOf('\n        </div>\n      </div>\n    </div>', mainStart)
template = template.slice(0, mainStart) + `          <RouterView v-slot="{ Component, route }">
            <KeepAlive>
              <component :is="Component" :key="route.name" />
            </KeepAlive>
          </RouterView>` + template.slice(mainEnd)
template = template.replace('      <div class="flex-1" data-tauri-drag-region />', '      <NavigationControls />\n      <div class="flex-1" data-tauri-drag-region />')
write('src/layouts/WorkspaceLayout.vue', `<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, toRefs, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { RouterView } from 'vue-router'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import SearchField from '@/components/ui/SearchField.vue'
import WindowControls from '@/components/ui/WindowControls.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import WorkspaceTabBar from '@/components/workspace/WorkspaceTabBar.vue'
import NavigationControls from '@/components/workspace/NavigationControls.vue'
import AppSidebar from '@/components/workspace/AppSidebar.vue'
import CommandPalette from '@/components/workspace/CommandPalette.vue'
import NotificationCenter from '@/components/workspace/NotificationCenter.vue'
import WorkspaceHelp from '@/components/workspace/WorkspaceHelp.vue'
import TransferCenter from '@/components/workspace/TransferCenter.vue'
import RemoteEditorHost from '@/components/operations/RemoteEditorHost.vue'
import ServerOperations from '@/components/operations/ServerOperations.vue'
import { useFullscreen } from '@/composables/useFullscreen'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { provideWorkspaceControllers } from '@/composables/useWorkspaceControllers'
import { useSettingsStore } from '@/stores/settings'
import { useConnectionsStore } from '@/stores/connections'
import { useWorkspaceStore } from '@/stores/workspace'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, useWorkspaceLayoutStore } from '@/stores/workspace-layout'
import { toast } from '@/composables/useToast'
import { COMMAND_TARGETS } from '@/constants/workspace'
import type { CommandItem } from '@/types'
import { isDatabaseConnection, type SavedConnection } from '@/types/connection'
import { formatShortcut, matchesShortcut } from '@/utils/shortcut'
import { appReady, launchAtStartupEnabled, openConnectionWindow, openSettingsWindow, setLaunchAtStartup, setMinimizeToTray, setTrayVisible, setWindowMaterial, toggleMaximizeWindow } from '@/utils/window'

const settings = useSettingsStore().values
const connections = useConnectionsStore()
const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const { reorder: reorderWorkspaceTabs } = workspace
const layout = useWorkspaceLayoutStore()
const { sidebarWidth, sidebarCollapsed, machineOpen } = storeToRefs(layout)
const { activeNav, selectNav, openConnection, selectTab, followActiveTab } = useWorkspaceNavigation()
const controllers = provideWorkspaceControllers()
const { fullscreen, toggleFullscreen } = useFullscreen()
const searchRef = useTemplateRef<InstanceType<typeof SearchField>>('search')
const state = reactive({ keyword: '', paletteOpen: false })
const { keyword, paletteOpen } = toRefs(state)
const activeSshTab = computed(() => activeTab.value?.connection.kind === 'ssh' ? activeTab.value : undefined)
const activeTerminalTab = computed(() => ['ssh', 'local'].includes(activeTab.value?.connection.kind ?? '') ? activeTab.value : undefined)

onMounted(() => { void appReady() })
watch(() => settings.windowMaterial, material => void setWindowMaterial(material), { immediate: true })
watch(() => [settings.showTrayIcon, settings.minimizeToTray] as const, ([showTray, minimize]) => {
  void setTrayVisible(showTray)
  void setMinimizeToTray(showTray && minimize)
}, { immediate: true })
watch(() => settings.launchAtStartup, async enabled => {
  try { if (await launchAtStartupEnabled() !== enabled) await setLaunchAtStartup(enabled) }
  catch (error) { toast.error({ title: '更新开机启动失败', description: String(error) }) }
}, { immediate: true })

watch(() => connections.items.map(item => item.id), ids => {
  if (!connections.loaded) return
  const alive = new Set(ids)
  const removed = openTabs.filter(tab => !alive.has(tab.id)).map(tab => tab.id)
  if (removed.length) closeTabs(removed)
})

function handleTitleBarDblClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).hasAttribute('data-tauri-drag-region')) toggleMaximizeWindow()
}
function addConnection(): void { openConnectionWindow(activeNav.value === 'databases' ? 'database' : 'ssh') }
function closeTabs(ids: string[]): void {
  const wasActive = ids.includes(activeId.value)
  workspace.closeMany(ids)
  if (wasActive) void followActiveTab()
}
function closeWarning(ids: string[]): string { return controllers.get('databases')?.closeWarning?.(ids) ?? '' }
async function newDatabaseQuery(connection: SavedConnection): Promise<void> {
  if (!isDatabaseConnection(connection)) return
  await openConnection(connection)
  await nextTick()
  await controllers.get('databases')?.newQuery?.(connection.id, connection.settings.database)
}
function refreshImportedDatabase(id: string): void { controllers.get('databases')?.refreshDatabase?.(id) }
async function tabAction(id: string, action: string): Promise<void> {
  const tab = openTabs.find(tab => tab.id === id)
  if (!tab) return
  try {
    await selectTab(id)
    await nextTick()
    await controllers.get(isDatabaseConnection(tab.connection) ? 'databases' : 'servers')?.action?.(id, action)
  } catch (error) { toast.error({ title: '连接操作失败', description: String(error) }) }
}
async function runWorkspaceAction(action: string): Promise<void> {
  if (action === 'database') { openConnectionWindow('database'); return }
  const tab = activeSshTab.value
  if (!tab) { toast.info('请先打开一个 SSH 连接'); return }
  await tabAction(tab.id, action)
}
async function runCommand(item: CommandItem): Promise<void> {
  if (item.id === 'split-terminal') { await runWorkspaceAction('split'); return }
  if (item.id === 'upload-files') { await runWorkspaceAction('upload'); return }
  const target = COMMAND_TARGETS[item.id]
  if (!target) return
  if (target.newConnection) { openConnectionWindow(target.newConnection); return }
  if (target.nav) await selectNav(target.nav)
  if (target.machineView) { layout.machineOpen = true; layout.machineView = target.machineView }
  if (target.focusSearch) await nextTick(() => searchRef.value?.focus())
}
function resetLayout(): void { layout.reset(); toast.success('已恢复默认布局') }
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (matchesShortcut(event, settings.shortcutPalette)) { event.preventDefault(); state.paletteOpen = !state.paletteOpen }
  else if (matchesShortcut(event, settings.shortcutTerminal)) { event.preventDefault(); openConnectionWindow('local') }
  else if (matchesShortcut(event, settings.shortcutSearch)) { event.preventDefault(); void nextTick(() => searchRef.value?.focus()) }
  else if (matchesShortcut(event, settings.shortcutFiles)) { event.preventDefault(); void runWorkspaceAction('files') }
  else if (event.key === 'Escape') state.paletteOpen = false
})
</script>

${template}`)
unlinkSync('src/components/workspace/MainWindow.vue')

let settings = read('src/components/settings/SettingsWindow.vue')
settings = settings.replace('reactive, shallowRef,', 'reactive,')
settings = settings.replace("import { useEventListener }", "import { useRoute, useRouter } from 'vue-router'\nimport { useEventListener }")
settings = settings.replace(/from '\.\/([^']+)'/g, "from '@/components/settings/$1'")
settings = settings.replace("const activePageId = shallowRef<SettingsPageId>('general')", `const route = useRoute()
const router = useRouter()
const activePageId = computed<SettingsPageId>({
  get: () => route.params.section as SettingsPageId,
  set: section => { void router.push({ name: 'settings', params: { section } }) },
})`)
write('src/pages/windows/SettingsPage.vue', settings)
unlinkSync('src/components/settings/SettingsWindow.vue')

let connection = read('src/components/connection/ConnectionWindow.vue')
connection = connection.replace("import { shallowRef }", "import { computed, shallowRef }")
connection = connection.replace(/from '\.\/([^']+)'/g, "from '@/components/connection/$1'")
const paramStart = connection.indexOf('const searchParams =')
const paramEnd = connection.indexOf('function closeDialog', paramStart)
connection = connection.slice(0, paramStart) + `const props = defineProps<{ kind: string; connectionId: string }>()
const isDatabase = computed(() => props.kind === 'database')
const isLocal = computed(() => props.kind === 'local')
const databaseKind = shallowRef<'mysql' | 'postgresql'>('mysql')
const title = computed(() => props.connectionId
  ? isDatabase.value ? 'Edit Database Connection' : isLocal.value ? 'Edit Local Terminal' : 'Edit SSH Connection'
  : isDatabase.value ? 'Add Database Connection' : isLocal.value ? 'Add Local Terminal' : 'Add SSH Connection')

` + connection.slice(paramEnd)
write('src/pages/windows/ConnectionPage.vue', connection)
unlinkSync('src/components/connection/ConnectionWindow.vue')

write('src/App.vue', `<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import ToastHost from '@/components/ui/ToastHost.vue'
const route = useRoute()
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" :key="route.name === 'connection' ? route.fullPath : route.meta.surface" />
  </RouterView>
  <ToastHost v-if="route.meta.surface !== 'splash'" />
</template>
`)
let main = read('src/main.ts')
main = main.replace("import { IS_TAURI } from '@/utils/window'", "import { IS_TAURI } from '@/utils/window'\nimport { getCurrentWindow } from '@tauri-apps/api/window'\nimport { pinia } from '@/stores'\nimport { createAppRouter } from '@/router'\nimport { resolveWindowEntry } from '@/router/window-entry'")
main = main.slice(0, main.indexOf('const windowSurface =')) + `const entry = resolveWindowEntry(window.location.search, window.location.hash, IS_TAURI ? getCurrentWindow().label : undefined)
const app = createApp(App)
app.use(pinia)
if (entry.surface !== 'splash') startSettingsRuntime()
// 保留旧版子窗口 query，同时让第一次导航直接命中正式路由。
if (!window.location.hash && entry.surface !== 'workspace')
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + '#' + entry.path)
const router = createAppRouter(pinia, entry)
app.use(router)
router.onError(error => { console.error('页面加载失败：', error) })
router.isReady().then(() => app.mount('#app')).catch(() => {
  const root = document.getElementById('app')
  if (root) {
    root.textContent = '页面加载失败，请重新启动 MiraiHub。'
    root.style.cssText = 'padding:32px;color:#eee'
  }
})
`
write('src/main.ts', main)
