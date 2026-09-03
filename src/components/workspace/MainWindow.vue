<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRefs, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { TabItem } from '@/components/ui/TabBar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import TabBar from '@/components/ui/TabBar.vue'
import WindowControls from '@/components/ui/WindowControls.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { useConnections } from '@/composables/useConnections'
import { useWorkspaceTabs } from '@/composables/useWorkspaceTabs'
import { COMMAND_TARGETS } from '@/constants/workspace'
import type { CommandItem, MachineViewId, NavId } from '@/types'
import type { SavedConnection } from '@/types/connection'
import { toSshConfig } from '@/types/connection'
import { openConnectionWindow, toggleMaximizeWindow } from '@/utils/window'
import AppSidebar from './AppSidebar.vue'
import CommandPalette from './CommandPalette.vue'
import DatabaseView from './DatabaseView.vue'
import MachinePanel from './MachinePanel.vue'
import RecentView from './RecentView.vue'
import SshKeysView from './SshKeysView.vue'
import TerminalPanel from './TerminalPanel.vue'

const searchRef = ref<InstanceType<typeof SearchField>>()

const { connections, touch } = useConnections()
const {
  tabs: openTabs,
  activeId,
  active: activeTab,
  open,
  close,
  activate,
  setStatus,
} = useWorkspaceTabs()

// 响应式状态
const state = reactive({
  // 顶部搜索关键词
  keyword: '',
  // 侧栏选中的主视图
  activeNav: 'servers' as NavId,
  // 命令面板是否展开
  paletteOpen: false,
  // 是否显示右侧机器详情面板（概览 / 文件）
  machineOpen: true,
  // 机器面板当前视图，放在这里是为了让命令面板能直接切过去
  machineView: 'overview' as MachineViewId,
})

const { keyword, activeNav, paletteOpen, machineOpen, machineView } = toRefs(state)

/**
 * 打开的连接 → 标签栏数据。
 * 状态点直接反映连接状态：连上是绿的、连接中是黄的、断开是灰的，
 * 不用切进标签也能看出哪台机器掉线了。
 */
const tabItems = computed<TabItem[]>(() =>
  openTabs.map(tab => ({
    id: tab.id,
    label: tab.connection.name,
    dot: tab.status === 'connected'
      ? 'accent'
      : tab.status === 'connecting' ? 'amber' : 'txt-3',
    closable: true,
  })),
)

/** 当前标签对应的 SSH 连接参数，非 SSH 或无标签时为 undefined */
const activeSshConfig = computed(() => {
  const connection = activeTab.value?.connection
  if (!connection || connection.kind !== 'ssh')
    return undefined

  return toSshConfig(connection)
})

/** 当前标签的连接，给右侧机器面板与数据库视图 */
const activeConnection = computed(() => activeTab.value?.connection)

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
        close(tab.id)
    }
  },
)

/** 全局快捷键：⌘K / Ctrl+K 开合命令面板，Esc 关闭 */
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    state.paletteOpen = !state.paletteOpen
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
 * 打开一条连接：建标签、切到对应视图、记一次使用。
 * 数据库连接落到 Databases 视图，SSH 落到 Servers。
 */
function openConnection(connection: SavedConnection): void {
  open(connection)
  state.activeNav = connection.kind === 'ssh' ? 'servers' : 'databases'
  void touch(connection.id)
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
    state.activeNav = tab.connection.kind === 'ssh' ? 'servers' : 'databases'
}

/**
 * 执行命令面板选中的命令。
 * 命令 → 落点的对应表见 COMMAND_TARGETS。
 */
function runCommand(item: CommandItem): void {
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
        ref="searchRef"
        v-model="keyword"
        icon="lucide:search"
        placeholder="搜索服务器、文件、命令…"
        shortcut="⌘K"
        class="w-75"
      />

      <div class="flex items-center gap-1.5">
        <IconButton icon="lucide:command" title="命令面板 (⌘K)" @click="paletteOpen = true" />
        <IconButton icon="lucide:plus" title="新建连接" @click="openConnectionWindow()" />
        <IconButton icon="lucide:bell" title="通知" />
        <IconButton icon="lucide:life-buoy" title="帮助" />

        <button
          type="button"
          class="ml-1 size-7 shrink-0 rounded-full border border-line-strong"
          style="background: linear-gradient(140deg, var(--color-orange), var(--color-pink))"
          title="账户"
        />
      </div>

      <WindowControls />
    </header>

    <!-- 主体 -->
    <div class="relative z-10 flex min-h-0 flex-1">
      <AppSidebar v-model:active="activeNav" @open="openConnection" />

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- 连接标签栏 -->
        <div class="flex h-11 shrink-0 items-end gap-2 border-b border-line-soft px-2.5">
          <TabBar
            :active="activeId"
            :tabs="tabItems"
            addable
            class="flex-1"
            @update:active="selectTab"
            @add="openConnectionWindow()"
            @close="close"
          />
          <div class="flex items-center gap-0.5 pb-1.5">
            <IconButton
              :icon="machineOpen ? 'lucide:panel-right-close' : 'lucide:panel-right-open'"
              :size="14"
              :title="machineOpen ? '收起机器面板' : '展开机器面板'"
              @click="machineOpen = !machineOpen"
            />
            <IconButton icon="lucide:maximize" :size="14" title="全屏" />
          </div>
        </div>

        <!-- 主视图：跟随侧栏切换。各视图自带 .pane，浮在窗口底色上 -->
        <div class="flex min-h-0 flex-1 gap-2.5 p-2.5">
          <template v-if="activeNav === 'servers'">
            <!-- key 绑到标签 id：切换连接时重建终端实例，
                 否则上一台机器的输出会留在屏幕上 -->
            <TerminalPanel
              :key="activeId || 'empty'"
              :config="activeSshConfig"
              :title="activeConnection?.name"
              @status="(status, sessionId) => activeId && setStatus(activeId, status, sessionId)"
            />
            <MachinePanel
              v-if="machineOpen"
              v-model:view="machineView"
              :connection="activeConnection"
              :session-id="activeTab?.sessionId ?? ''"
              @close="machineOpen = false"
            />
          </template>

          <DatabaseView v-else-if="activeNav === 'databases'" :connection="activeConnection" />

          <SshKeysView v-else-if="activeNav === 'ssh-keys'" />

          <RecentView v-else-if="activeNav === 'recent'" @open="openConnection" />

          <!-- 兜底：以后新增侧栏项但视图还没落地时，给出空状态而不是白屏 -->
          <div v-else class="pane flex-1 items-center justify-center">
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
