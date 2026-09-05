<script setup lang="ts">
import { computed, nextTick, reactive, toRefs, useTemplateRef, watch } from 'vue'
import { useEventListener, useStorage, useWindowSize } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import SearchField from '@/components/ui/SearchField.vue'
import WorkspaceTabBar from './WorkspaceTabBar.vue'
import WindowControls from '@/components/ui/WindowControls.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { useFullscreen } from '@/composables/useFullscreen'
import { useConnections } from '@/composables/useConnections'
import { settings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { useWorkspaceTabs } from '@/composables/useWorkspaceTabs'
import { COMMAND_TARGETS } from '@/constants/workspace'
import type { CommandItem, MachineViewId, NavId } from '@/types'
import type { LocalConnectionSettings, SavedConnection } from '@/types/connection'
import { isDatabaseConnection, isLocalConnection, toSshConfig } from '@/types/connection'
import { formatShortcut, matchesShortcut } from '@/utils/shortcut'
import {
  launchAtStartupEnabled,
  openConnectionWindow,
  openSettingsWindow,
  setLaunchAtStartup,
  setMinimizeToTray,
  setTrayVisible,
  setWindowMaterial,
  toggleMaximizeWindow,
} from '@/utils/window'
import AppSidebar from './AppSidebar.vue'
import CommandPalette from './CommandPalette.vue'
import DatabaseView from './DatabaseView.vue'
import MachinePanel from './MachinePanel.vue'
import LocalTerminalPanel from './LocalTerminalPanel.vue'
import RecentView from './RecentView.vue'
import SshKeysView from './SshKeysView.vue'
import TerminalPanel from './TerminalPanel.vue'
import SshTerminalWorkspace from './SshTerminalWorkspace.vue'
import NotificationCenter from './NotificationCenter.vue'
import WorkspaceHelp from './WorkspaceHelp.vue'
import TransferCenter from './TransferCenter.vue'
import RemoteEditorHost from '@/components/operations/RemoteEditorHost.vue'
import ServerOperations from '@/components/operations/ServerOperations.vue'

const { fullscreen, toggleFullscreen } = useFullscreen()

const sshWorkspaces = useTemplateRef<Array<InstanceType<typeof SshTerminalWorkspace>>>('sshWorkspaces')
const localTerminals = useTemplateRef<Array<InstanceType<typeof LocalTerminalPanel>>>('localTerminals')
const machinePanel = useTemplateRef<InstanceType<typeof MachinePanel>>('machinePanel')

const searchRef = useTemplateRef<InstanceType<typeof SearchField>>('search')
const databaseViews = useTemplateRef<Array<{
  refreshForConnection: (connectionId: string) => void
  reconnectFor: (connectionId: string) => Promise<void>
  disconnectFor: (connectionId: string) => Promise<void>
  closeWarningFor: (ids: string[]) => string
  newQueryForConnection: (connectionId: string, database: string) => Promise<void>
}>>('databaseViews')
const { width: viewportWidth } = useWindowSize()

const SIDEBAR_MIN_WIDTH = 184
const SIDEBAR_MAX_WIDTH = 380
const MACHINE_MIN_WIDTH = 384
const MACHINE_MAX_WIDTH = 720
const DEFAULT_SIDEBAR_WIDTH = 224
const DEFAULT_MACHINE_WIDTH = Math.min(
  620,
  Math.max(MACHINE_MIN_WIDTH, (window.innerWidth - DEFAULT_SIDEBAR_WIDTH - 20) * 0.42),
)

const { connections, loaded: connectionsLoaded, touch } = useConnections()
const {
  tabs: openTabs,
  activeId,
  active: activeTab,
  open,
  close,
  closeMany,
  activate,
  reorder: reorderWorkspaceTabs,
  setStatus,
  restore,
} = useWorkspaceTabs()

watch(connectionsLoaded, (loaded) => {
  if (loaded)
    restore(connections)
}, { immediate: true })

watch(
  () => settings.windowMaterial,
  material => void setWindowMaterial(material),
  { immediate: true },
)

watch(
  () => [settings.showTrayIcon, settings.minimizeToTray] as const,
  ([showTray, minimizeToTray]) => {
    void setTrayVisible(showTray)
    void setMinimizeToTray(showTray && minimizeToTray)
  },
  { immediate: true },
)

watch(
  () => settings.launchAtStartup,
  async (enabled) => {
    try {
      if (await launchAtStartupEnabled() !== enabled)
        await setLaunchAtStartup(enabled)
    }
    catch (error) {
      toast.error({ title: '更新开机启动失败', description: error instanceof Error ? error.message : String(error) })
    }
  },
  { immediate: true },
)

const cachedActiveNav = useStorage<NavId>('miraihub:workspace-route', 'servers')

// 响应式状态
const state = reactive({
  // 顶部搜索关键词
  keyword: '',
  // 侧栏选中的主视图
  activeNav: cachedActiveNav.value,
  // 命令面板是否展开
  paletteOpen: false,
  // 两个分隔条的实时宽度由主窗口统一保存，切换视图不会丢失
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false,
  machineWidth: DEFAULT_MACHINE_WIDTH,
  // 是否显示右侧机器详情面板（概览 / 文件）
  machineOpen: true,
  // 机器面板当前视图，放在这里是为了让命令面板能直接切过去
  machineView: 'overview' as MachineViewId,
})

const {
  keyword,
  activeNav,
  paletteOpen,
  sidebarWidth,
  sidebarCollapsed,
  machineWidth,
  machineOpen,
  machineView,
} = toRefs(state)

watch(activeNav, (nav) => {
  cachedActiveNav.value = nav
})

const unsupportedNav = computed(() => !['servers', 'databases', 'ssh-keys', 'recent'].includes(activeNav.value))

/** 始终给终端至少留出 360px，窗口变窄时同步收紧右侧面板上限。 */
const machineMaxWidth = computed(() => {
  const visibleSidebarWidth = state.sidebarCollapsed ? 52 : state.sidebarWidth
  const available = viewportWidth.value - visibleSidebarWidth - 390
  return Math.max(MACHINE_MIN_WIDTH, Math.min(MACHINE_MAX_WIDTH, available))
})

watch(machineMaxWidth, (maxWidth) => {
  if (state.machineWidth > maxWidth)
    state.machineWidth = maxWidth
}, { immediate: true })

/**
 * 每个 SSH 标签各自持有一个终端实例。
 *
 * 标签切换时只用 v-show 隐藏，不卸载组件；这样后台会话、终端缓冲和正在运行的命令
 * 都能保留。真正关闭标签时 v-for 才移除组件，由 TerminalPanel 负责断开会话。
 */
const sshTabViews = computed(() =>
  openTabs
    .filter(tab => tab.connection.kind === 'ssh')
    .map((tab) => {
      const settings = tab.connection.settings

      return {
        id: tab.id,
        title: tab.connection.name,
        config: toSshConfig(tab.connection),
        terminalType: 'terminalType' in settings ? settings.terminalType : 'xterm-256color',
        startupCommand: 'startupCommand' in settings ? settings.startupCommand : '',
      }
    }),
)

const localTabViews = computed(() =>
  openTabs
    .flatMap((tab) => {
      const connection = tab.connection
      if (!isLocalConnection(connection))
        return []
      return [{
        id: tab.id,
        title: connection.name,
        settings: connection.settings as LocalConnectionSettings,
      }]
    }),
)

/** 当前标签按主视图收窄，避免把数据库连接传进机器面板，反之亦然 */
const activeSshTab = computed(() =>
  activeTab.value?.connection.kind === 'ssh' ? activeTab.value : undefined,
)

const activeTerminalTab = computed(() => {
  const tab = activeTab.value
  return tab && (tab.connection.kind === 'ssh' || tab.connection.kind === 'local')
    ? tab
    : undefined
})

const activeDatabaseConnection = computed(() => {
  const connection = activeTab.value?.connection
  return connection && isDatabaseConnection(connection) ? connection : undefined
})

/** 数据库标签独立挂载，使每条连接的连接池、SQL 草稿与结果互不覆盖。 */
const databaseTabViews = computed(() =>
  openTabs.flatMap((tab) => {
    const connection = tab.connection
    return isDatabaseConnection(connection) ? [{ id: tab.id, connection }] : []
  }),
)

/**
 * 连接被删除时关掉对应标签。
 *
 * 删除可能发生在独立的连接配置窗口里，这边只能靠 store 的变更通知发现；
 * 留着标签会指向一份不存在的配置，重连时报错莫名其妙。
 */
watch(
  () => connections.map(item => item.id).join(','),
  () => {
    const alive = new Set(connections.map(item => item.id))

    for (const tab of [...openTabs]) {
      if (!alive.has(tab.id))
        closeTab(tab.id)
    }
  },
)

/** 用户可配置的全局快捷键；Esc 始终关闭命令面板。 */
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (matchesShortcut(event, settings.shortcutPalette)) {
    event.preventDefault()
    state.paletteOpen = !state.paletteOpen
    return
  }

  if (matchesShortcut(event, settings.shortcutTerminal)) {
    event.preventDefault()
    openConnectionWindow('local')
    return
  }

  if (matchesShortcut(event, settings.shortcutSearch)) {
    event.preventDefault()
    void nextTick(() => searchRef.value?.focus())
    return
  }

  if (matchesShortcut(event, settings.shortcutFiles)) {
    event.preventDefault()
    if (activeSshTab.value) {
      state.activeNav = 'servers'
      state.machineOpen = true
      state.machineView = 'files'
    }
    else {
      toast.info('请先打开一个 SSH 连接')
    }
    return
  }

  if (event.key === 'Escape' && state.paletteOpen)
    state.paletteOpen = false
})

/**
 * 双击标题栏最大化 / 还原 —— Windows 的固有习惯。
 * 只认拖拽区本身，落在搜索框、按钮上的双击不算。
 */
function handleTitleBarDblClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).hasAttribute('data-tauri-drag-region'))
    toggleMaximizeWindow()
}

/**
 * 打开一条连接：建标签、切到对应视图、记录最近使用时间（不改变侧栏顺序）。
 * 数据库连接落到 Databases 视图，SSH 落到 Servers。
 */
function openConnection(connection: SavedConnection): void {
  open(connection)
  state.activeNav = isDatabaseConnection(connection) ? 'databases' : 'servers'
  void touch(connection.id)
}

/** 从左侧连接列表新建查询：先打开连接，再让查询绑定到连接配置的默认数据库。 */
async function newDatabaseQuery(connection: SavedConnection): Promise<void> {
  if (!isDatabaseConnection(connection))
    return

  openConnection(connection)
  await nextTick()
  for (const view of databaseViews.value ?? [])
    await view.newQueryForConnection(connection.id, connection.settings.database)
}

function refreshImportedDatabase(connectionId: string): void {
  for (const view of databaseViews.value ?? [])
    view.refreshForConnection(connectionId)
}

/**
 * 切换标签时同步主视图。
 * 标签栏是跨类型的（SSH 和数据库标签排在一起），
 * 点到数据库标签却停在终端视图，看到的就不是这个标签的内容。
 */
function selectTab(id: string): void {
  activate(id)

  const tab = openTabs.find(item => item.id === id)
  if (tab)
    state.activeNav = isDatabaseConnection(tab.connection) ? 'databases' : 'servers'
}

/**
 * 切换 Servers / Databases 时优先恢复该类型最近打开的标签。
 * 没有对应标签则保留全局标签选择，主视图会展示该类型的空状态。
 */
function selectNav(nav: NavId): void {
  state.activeNav = nav

  if (nav !== 'servers' && nav !== 'databases')
    return

  const activeKindMatches = nav === 'servers'
    ? activeTab.value?.connection.kind === 'ssh' || activeTab.value?.connection.kind === 'local'
    : Boolean(activeTab.value && isDatabaseConnection(activeTab.value.connection))

  if (activeKindMatches)
    return

  const candidate = [...openTabs]
    .reverse()
    .find(tab => nav === 'servers'
      ? tab.connection.kind === 'ssh' || tab.connection.kind === 'local'
      : isDatabaseConnection(tab.connection))

  if (candidate)
    activate(candidate.id)
}

/** 关闭当前标签后，让主视图跟随新的活动标签类型 */
function closeTab(id: string): void {
  const wasActive = activeId.value === id
  close(id)

  if (!wasActive || !activeTab.value)
    return

  state.activeNav = isDatabaseConnection(activeTab.value.connection) ? 'databases' : 'servers'
}

function closeTabs(ids: string[]): void {
  closeMany(ids)
  if (activeTab.value) state.activeNav = isDatabaseConnection(activeTab.value.connection) ? 'databases' : 'servers'
}
function closeWarning(ids: string[]): string { return (databaseViews.value ?? []).map(view => view.closeWarningFor(ids)).filter(Boolean).join('；') }
async function tabAction(id: string, action: string): Promise<void> {
  if (!openTabs.some(tab => tab.id === id)) return
  selectTab(id)
  if (action === 'split' || action === 'files') { await runWorkspaceAction(action); return }
  try {
    for (const view of [...(sshWorkspaces.value ?? []), ...(localTerminals.value ?? []), ...(databaseViews.value ?? [])]) {
      if (action === 'reconnect') await view.reconnectFor(id)
      else if (action === 'disconnect') await view.disconnectFor(id)
    }
  } catch (error) { toast.error({ title: '连接操作失败', description: error instanceof Error ? error.message : String(error) }) }
}

function handleSshStatus(
  tabId: string,
  status: Parameters<typeof setStatus>[1],
  sessionId: string,
): void {
  const previous = openTabs.find(tab => tab.id === tabId)?.status
  setStatus(tabId, status, sessionId)

  if (!settings.notifyConnectionChanges || previous === status)
    return

  const name = openTabs.find(tab => tab.id === tabId)?.connection.name ?? '连接'
  if (status === 'connected')
    toast.success(`${name} 已连接`)
  else if (previous === 'connected' && status === 'disconnected')
    toast.warning(`${name} 已断开`)
}

/** 当前主视图决定“新建”打开 SSH 表单还是数据库表单。 */
function addConnection(): void {
  openConnectionWindow(state.activeNav === 'databases' ? 'database' : 'ssh')
}

/**
 * 执行命令面板选中的命令。
 * 命令 → 落点的对应表见 COMMAND_TARGETS。
 */
function runCommand(item: CommandItem): void {
  if (item.id === 'split-terminal') { void runWorkspaceAction('split'); return }
  if (item.id === 'upload-files') { void runWorkspaceAction('upload'); return }
  const target = COMMAND_TARGETS[item.id]
  if (!target)
    return

  // 新建类命令直接开配置窗口，而不是把人送到某个视图再让他自己找按钮
  if (target.newConnection) {
    openConnectionWindow(target.newConnection)
    return
  }

  if (target.nav)
    state.activeNav = target.nav

  if (target.machineView) {
    state.machineOpen = true
    state.machineView = target.machineView
  }

  // 等面板关闭后再抢焦点，否则会被卸载中的输入框吞掉
  if (target.focusSearch)
    void nextTick(() => searchRef.value?.focus())
}
function resetLayout(): void {
  state.sidebarWidth = DEFAULT_SIDEBAR_WIDTH
  state.sidebarCollapsed = false
  state.machineWidth = Math.min(DEFAULT_MACHINE_WIDTH, machineMaxWidth.value)
  state.machineOpen = true
  toast.success('已恢复默认布局')
}

async function runWorkspaceAction(action: string): Promise<void> {
  if (action === 'database') { openConnectionWindow('database'); return }
  const tab = activeSshTab.value
  if (!tab) { toast.info('请先打开一个 SSH 连接'); return }
  state.activeNav = 'servers'
  if (action === 'files' || action === 'upload') {
    state.machineOpen = true
    state.machineView = 'files'
    await nextTick()
    if (action === 'upload') await machinePanel.value?.upload()
    return
  }
  await nextTick()
  for (const workspace of sshWorkspaces.value ?? []) {
    if (action === 'split') await workspace.splitFor(tab.id)
    else workspace.focusFor(tab.id)
  }
}
</script>

<template>
  <WindowFrame ambient class="h-screen w-screen">
    <!-- 标题栏：Windows 形态 —— 品牌在左，窗口按钮贴右上角。
         带 data-tauri-drag-region 的区域可拖拽，按钮本身不带故不受影响 -->
    <header class="win-bar relative z-10" data-tauri-drag-region @dblclick="handleTitleBarDblClick">
      <div class="flex items-center gap-2" data-tauri-drag-region>
        <BrandLogo />
        <h1 class="text-[13px] font-medium tracking-tight text-txt">
          MiraiHub
        </h1>
      </div>

      <div class="flex-1" data-tauri-drag-region />

      <SearchField
        ref="search"
        v-model="keyword"
        icon="lucide:search"
        placeholder="搜索服务器、文件、命令…"
        :shortcut="formatShortcut(settings.shortcutPalette)"
        class="w-75"
      />

      <div class="flex items-center gap-1.5">
        <IconButton icon="lucide:command" :title="`命令面板 (${formatShortcut(settings.shortcutPalette)})`" @click="paletteOpen = true" />
        <IconButton icon="lucide:plus" title="新建连接" @click="addConnection" />
        <TransferCenter />
        <NotificationCenter />
        <WorkspaceHelp />

        <button
          type="button"
          class="ml-1 size-7 shrink-0 rounded-full border border-line-strong"
          style="background: linear-gradient(140deg, var(--color-orange), var(--color-pink))"
          title="设置"
          aria-label="打开设置"
          @click="openSettingsWindow"
        />
      </div>

      <WindowControls />
    </header>

    <!-- 主体 -->
    <div class="relative z-10 flex min-h-0 flex-1">
      <AppSidebar
        :active="activeNav"
        v-model:width="sidebarWidth"
        v-model:collapsed="sidebarCollapsed"
        @update:active="selectNav"
        @open="openConnection"
        @new-database-query="newDatabaseQuery"
        @database-imported="refreshImportedDatabase"
        @reset-layout="resetLayout"
      />
      <AppResizeHandle
        v-if="!sidebarCollapsed"
        v-model="sidebarWidth"
        pane-side="left"
        :min="SIDEBAR_MIN_WIDTH"
        :max="SIDEBAR_MAX_WIDTH"
        label="调整主侧栏宽度"
        overlay
      />

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- 连接标签栏 -->
        <div class="flex h-11 shrink-0 items-end gap-2 border-b border-line-soft px-2.5">
          <WorkspaceTabBar
            :active="activeId"
            :tabs="openTabs"
            :close-warning="closeWarning"
            addable
            class="flex-1"
            @update:active="selectTab"
            @add="addConnection"
            @close-many="closeTabs"
            @action="tabAction"
            @reorder="reorderWorkspaceTabs"
          />
          <div class="flex items-center gap-0.5 pb-1.5">
            <ServerOperations :session-id="activeSshTab?.sessionId" />
            <IconButton
              v-if="!activeTerminalTab || activeSshTab"
              :icon="machineOpen ? 'lucide:panel-right-close' : 'lucide:panel-right-open'"
              :size="14"
              :title="machineOpen ? '收起机器面板' : '展开机器面板'"
              @click="machineOpen = !machineOpen"
            />
            <IconButton :icon="fullscreen ? 'lucide:minimize' : 'lucide:maximize'" :size="14" :title="fullscreen ? '退出全屏 (Esc)' : '全屏 (F11)'" @click="toggleFullscreen" />
          </div>
        </div>

        <!-- 主视图：跟随侧栏切换。各视图自带 .pane，浮在窗口底色上 -->
        <div class="flex min-h-0 flex-1 p-2.5">
          <div v-show="activeNav === 'servers'" class="contents">
            <!-- SSH 标签保持挂载，只隐藏非活动项；关闭标签时才真正卸载并断开 -->
            <SshTerminalWorkspace
              v-for="tab in sshTabViews"
              ref="sshWorkspaces"
              :connection-id="tab.id"
              :active="activeId === tab.id && activeNav === 'servers'"
              v-show="activeId === tab.id"
              :key="tab.id"
              :config="tab.config"
              :title="tab.title"
              :terminal-type="tab.terminalType"
              :startup-command="tab.startupCommand"
              @status="(status, sessionId) => handleSshStatus(tab.id, status, sessionId)"
            />

            <LocalTerminalPanel
              ref="localTerminals"
              :connection-id="tab.id"
              v-for="tab in localTabViews"
              v-show="activeId === tab.id"
              :key="tab.id"
              :title="tab.title"
              :settings="tab.settings"
              @status="(status, sessionId) => handleSshStatus(tab.id, status, sessionId)"
            />

            <TerminalPanel
              v-if="!activeTerminalTab"
              key="empty-terminal"
            />

            <AppResizeHandle
              v-if="machineOpen && Boolean(activeSshTab)"
              v-model="machineWidth"
              pane-side="right"
              :min="MACHINE_MIN_WIDTH"
              :max="machineMaxWidth"
              label="调整机器面板宽度"
            />

            <MachinePanel
              ref="machinePanel"
              @action="runWorkspaceAction"              v-if="machineOpen && Boolean(activeSshTab)"
              v-model:view="machineView"
              :connection="activeSshTab?.connection"
              :session-id="activeSshTab?.sessionId ?? ''"
              :width="machineWidth"
              @close="machineOpen = false"
            />
          </div>

          <div v-show="activeNav === 'databases'" class="contents">
            <DatabaseView
              v-for="tab in databaseTabViews"
              v-show="activeId === tab.id"
              ref="databaseViews"
              :key="tab.id"
              :connection="tab.connection"
              :active="activeId === tab.id && activeNav === 'databases'"
              @status="(status, sessionId) => handleSshStatus(tab.id, status, sessionId)"
            />
            <DatabaseView v-if="!activeDatabaseConnection" />
          </div>

          <SshKeysView v-show="activeNav === 'ssh-keys'" />

          <RecentView v-show="activeNav === 'recent'" @open="openConnection" />

          <!-- 兜底：以后新增侧栏项但视图还没落地时，给出空状态而不是白屏 -->
          <div v-show="unsupportedNav" class="pane flex-1 items-center justify-center">
            <div class="flex flex-col items-center gap-3 text-center">
              <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3">
                <AppIcon name="lucide:construction" :size="26" />
              </div>
              <p class="text-sm text-txt-2">
                这个模块还没接上
              </p>
              <p class="max-w-70 text-xs text-txt-4">
                功能实现中，可以先从 Servers、Databases 开始
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <RemoteEditorHost />

    <!-- 命令面板浮层 -->
    <Transition name="palette">
      <div
        v-if="paletteOpen"
        class="absolute inset-0 z-50 flex justify-center bg-black/45 pt-[13vh]"
        @click.self="paletteOpen = false"
      >
        <CommandPalette @close="paletteOpen = false" @run="runCommand" />
      </div>
    </Transition>
  </WindowFrame>
</template>

<style scoped>
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.15s ease;
}

.palette-enter-active :deep(> *),
.palette-leave-active :deep(> *) {
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}

.palette-enter-from :deep(> *),
.palette-leave-to :deep(> *) {
  transform: translateY(-8px) scale(0.98);
  opacity: 0;
}
</style>
