<script setup lang="ts">
import { nextTick, reactive, ref, toRefs } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { TabItem } from '@/components/ui/TabBar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import TabBar from '@/components/ui/TabBar.vue'
import WindowControls from '@/components/ui/WindowControls.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { COMMAND_TARGETS } from '@/constants/workspace'
import type { CommandItem, MachineViewId, NavId, RecentSession } from '@/types'
import { toggleMaximizeWindow } from '@/utils/window'
import AppSidebar from './AppSidebar.vue'
import CommandPalette from './CommandPalette.vue'
import DatabaseView from './DatabaseView.vue'
import MachinePanel from './MachinePanel.vue'
import RecentView from './RecentView.vue'
import SshKeysView from './SshKeysView.vue'
import TerminalPanel from './TerminalPanel.vue'

const searchRef = ref<InstanceType<typeof SearchField>>()

// 响应式状态
const state = reactive({
  // 顶部连接标签页
  tabs: [
    { id: 'prod', label: 'Production Server', dot: 'accent', closable: true },
    { id: 'web', label: 'Web Server', icon: 'lucide:circle-dot', closable: true },
    { id: 'mysql', label: 'MySQL', icon: 'lucide:circle-dot', closable: true },
    { id: 'pg', label: 'PostgreSQL', icon: 'lucide:circle-dot', closable: true },
  ] as TabItem[],
  // 当前激活的连接标签
  activeTab: 'prod',
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

const { tabs, activeTab, keyword, activeNav, paletteOpen, machineOpen, machineView } = toRefs(state)

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
 * 执行命令面板选中的命令。
 * 会话层还没接上，所以这里只做导航：切视图、必要时展开机器面板、把焦点交给搜索框。
 * 命令 → 落点的对应表见 COMMAND_TARGETS。
 */
function runCommand(item: CommandItem): void {
  const target = COMMAND_TARGETS[item.id]
  if (!target)
    return

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

/** 从最近会话重连：数据库会话回数据库视图，其余回终端视图 */
function reopenSession(session: RecentSession): void {
  state.activeNav = session.kind === 'database' ? 'databases' : 'servers'

  if (session.kind === 'sftp') {
    state.machineOpen = true
    state.machineView = 'files'
  }
}
</script>

<template>
  <WindowFrame ambient class="h-screen w-screen">
    <!-- 标题栏：Windows 形态 —— 品牌在左，窗口按钮贴右上角。
         带 data-tauri-drag-region 的区域可拖拽，按钮本身不带故不受影响 -->
    <header class="win-bar relative z-10" data-tauri-drag-region @dblclick="handleTitleBarDblClick">
      <div class="flex items-center gap-2" data-tauri-drag-region>
        <div
          class="grid size-5 place-items-center rounded-md text-black/80"
          style="background: linear-gradient(140deg, var(--color-accent), var(--color-cyan))"
        >
          <AppIcon name="lucide:server" :size="12" />
        </div>
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
        <IconButton icon="lucide:plus" title="新建连接" />
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
      <AppSidebar v-model:active="activeNav" />

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- 连接标签栏 -->
        <div class="flex h-11 shrink-0 items-end gap-2 border-b border-line-soft px-2.5">
          <TabBar v-model:active="activeTab" :tabs="tabs" addable class="flex-1" />
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
            <TerminalPanel />
            <MachinePanel
              v-if="machineOpen"
              v-model:view="machineView"
              @close="machineOpen = false"
            />
          </template>

          <DatabaseView v-else-if="activeNav === 'databases'" />

          <SshKeysView v-else-if="activeNav === 'ssh-keys'" />

          <RecentView v-else-if="activeNav === 'recent'" @open="reopenSession" />

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
