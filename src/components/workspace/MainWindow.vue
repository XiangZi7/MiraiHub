<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { TabItem } from '@/components/ui/TabBar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import TabBar from '@/components/ui/TabBar.vue'
import TrafficLights from '@/components/ui/TrafficLights.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import AppSidebar from './AppSidebar.vue'
import CommandPalette from './CommandPalette.vue'
import DatabaseView from './DatabaseView.vue'
import FilesView from './FilesView.vue'
import ServerOverview from './ServerOverview.vue'
import TerminalPanel from './TerminalPanel.vue'

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
  activeNav: 'servers',
  // 命令面板是否展开
  paletteOpen: false,
  // 是否显示右侧终端面板
  terminalOpen: true,
})

const { tabs, activeTab, keyword, activeNav, paletteOpen, terminalOpen } = toRefs(state)

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
</script>

<template>
  <WindowFrame ambient class="h-screen w-screen">
    <!-- 标题栏：整条都是拖拽区，子元素上的按钮不受影响 -->
    <header class="win-bar relative z-10" data-tauri-drag-region>
      <TrafficLights />
      <h1 class="text-[13px] font-medium tracking-tight text-txt">
        MiraiHub
      </h1>

      <div class="flex-1" data-tauri-drag-region />

      <SearchField
        v-model="keyword"
        icon="lucide:search"
        placeholder="搜索服务器、文件、命令…"
        shortcut="⌘K"
        class="w-[300px]"
      />
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
              icon="lucide:panel-right"
              :size="14"
              title="切换终端面板"
              @click="terminalOpen = !terminalOpen"
            />
            <IconButton icon="lucide:maximize" :size="14" title="全屏" />
          </div>
        </div>

        <!-- 主视图：跟随侧栏切换 -->
        <div class="flex min-h-0 flex-1">
          <template v-if="activeNav === 'servers'">
            <ServerOverview />
            <TerminalPanel v-if="terminalOpen" @close="terminalOpen = false" />
          </template>

          <DatabaseView v-else-if="activeNav === 'databases'" />

          <FilesView v-else-if="activeNav === 'files'" />

          <!-- 尚未接入的模块，先给出明确的空状态而不是白屏 -->
          <div v-else class="grid flex-1 place-items-center">
            <div class="flex flex-col items-center gap-3 text-center">
              <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3">
                <AppIcon name="lucide:construction" :size="26" />
              </div>
              <p class="text-sm text-txt-2">
                这个模块还没接上
              </p>
              <p class="max-w-[280px] text-xs text-txt-4">
                功能实现中，可以先从 Servers、Databases、Files 开始
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
        <CommandPalette @close="paletteOpen = false" />
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
