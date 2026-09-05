<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from "vue";
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { RouterView } from "vue-router";
import BrandLogo from "@/components/ui/BrandLogo.vue";
import IconButton from "@/components/ui/IconButton.vue";
import AppResizeHandle from "@/components/ui/AppResizeHandle.vue";
import SearchField from "@/components/ui/SearchField.vue";
import WindowControls from "@/components/ui/WindowControls.vue";
import WindowFrame from "@/components/ui/WindowFrame.vue";
import WorkspaceTabBar from "@/components/workspace/WorkspaceTabBar.vue";
import NavigationControls from "@/components/workspace/NavigationControls.vue";
import AppSidebar from "@/components/workspace/AppSidebar.vue";
import CommandPalette from "@/components/workspace/CommandPalette.vue";
import NotificationCenter from "@/components/workspace/NotificationCenter.vue";
import WorkspaceHelp from "@/components/workspace/WorkspaceHelp.vue";
import TransferCenter from "@/components/workspace/TransferCenter.vue";
import RemoteEditorHost from "@/components/operations/RemoteEditorHost.vue";
import ServerOperations from "@/components/operations/ServerOperations.vue";
import { useFullscreen } from "@/composables/useFullscreen";
import { useWorkspaceNavigation } from "@/composables/useWorkspaceNavigation";
import { provideWorkspaceControllers } from "@/composables/useWorkspaceControllers";
import { useSettingsStore } from "@/stores/settings";
import { useConnectionsStore } from "@/stores/connections";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout";
import { toast } from "@/composables/useToast";
import { COMMAND_TARGETS } from "@/constants/workspace";
import type { CommandItem } from "@/types";
import { isDatabaseConnection, type SavedConnection } from "@/types/connection";
import { formatShortcut, matchesShortcut } from "@/utils/shortcut";
import {
  appReady,
  launchAtStartupEnabled,
  openConnectionWindow,
  openSettingsWindow,
  setLaunchAtStartup,
  setMinimizeToTray,
  setTrayVisible,
  setWindowMaterial,
  toggleMaximizeWindow,
} from "@/utils/window";

const settings = useSettingsStore().values;
const connections = useConnectionsStore();
const workspace = useWorkspaceStore();
const openTabs = workspace.tabs;
const { activeId, active: activeTab } = storeToRefs(workspace);
const { reorder: reorderWorkspaceTabs } = workspace;
const layout = useWorkspaceLayoutStore();
const { sidebarWidth, sidebarCollapsed, machineOpen } = storeToRefs(layout);
const { activeNav, selectNav, openConnection, selectTab, followActiveTab } =
  useWorkspaceNavigation();
const controllers = provideWorkspaceControllers();
const { fullscreen, toggleFullscreen } = useFullscreen();
const searchRef = useTemplateRef<InstanceType<typeof SearchField>>("search");
const state = reactive({ keyword: "", paletteOpen: false });
const { keyword, paletteOpen } = toRefs(state);
const activeSshTab = computed(() =>
  activeTab.value?.connection.kind === "ssh" ? activeTab.value : undefined,
);
const activeTerminalTab = computed(() =>
  ["ssh", "local"].includes(activeTab.value?.connection.kind ?? "")
    ? activeTab.value
    : undefined,
);

onMounted(() => {
  void appReady();
});
watch(
  () => settings.windowMaterial,
  (material) => void setWindowMaterial(material),
  { immediate: true },
);
watch(
  () => [settings.showTrayIcon, settings.minimizeToTray] as const,
  ([showTray, minimize]) => {
    void setTrayVisible(showTray);
    void setMinimizeToTray(showTray && minimize);
  },
  { immediate: true },
);
watch(
  () => settings.launchAtStartup,
  async (enabled) => {
    try {
      if ((await launchAtStartupEnabled()) !== enabled)
        await setLaunchAtStartup(enabled);
    } catch (error) {
      toast.error({ title: "更新开机启动失败", description: String(error) });
    }
  },
  { immediate: true },
);

watch(
  () => connections.items.map((item) => item.id),
  (ids) => {
    if (!connections.loaded) return;
    const alive = new Set(ids);
    const removed = openTabs
      .filter((tab) => !alive.has(tab.id))
      .map((tab) => tab.id);
    if (removed.length) closeTabs(removed);
  },
);

function handleTitleBarDblClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).hasAttribute("data-tauri-drag-region"))
    toggleMaximizeWindow();
}
function addConnection(): void {
  openConnectionWindow(activeNav.value === "databases" ? "database" : "ssh");
}
function closeTabs(ids: string[]): void {
  const wasActive = ids.includes(activeId.value);
  workspace.closeMany(ids);
  if (wasActive) void followActiveTab();
}
function closeWarning(ids: string[]): string {
  return controllers.get("databases")?.closeWarning?.(ids) ?? "";
}
async function newDatabaseQuery(connection: SavedConnection): Promise<void> {
  if (!isDatabaseConnection(connection)) return;
  await openConnection(connection);
  await nextTick();
  await controllers
    .get("databases")
    ?.newQuery?.(connection.id, connection.settings.database);
}
function refreshImportedDatabase(id: string): void {
  controllers.get("databases")?.refreshDatabase?.(id);
}
async function tabAction(id: string, action: string): Promise<void> {
  const tab = openTabs.find((tab) => tab.id === id);
  if (!tab) return;
  try {
    await selectTab(id);
    await nextTick();
    await controllers
      .get(isDatabaseConnection(tab.connection) ? "databases" : "servers")
      ?.action?.(id, action);
  } catch (error) {
    toast.error({ title: "连接操作失败", description: String(error) });
  }
}
async function runWorkspaceAction(action: string): Promise<void> {
  if (action === "database") {
    openConnectionWindow("database");
    return;
  }
  const tab = activeSshTab.value;
  if (!tab) {
    toast.info("请先打开一个 SSH 连接");
    return;
  }
  await tabAction(tab.id, action);
}
async function runCommand(item: CommandItem): Promise<void> {
  if (item.id === "split-terminal") {
    await runWorkspaceAction("split");
    return;
  }
  if (item.id === "upload-files") {
    await runWorkspaceAction("upload");
    return;
  }
  const target = COMMAND_TARGETS[item.id];
  if (!target) return;
  if (target.newConnection) {
    openConnectionWindow(target.newConnection);
    return;
  }
  if (target.nav) await selectNav(target.nav);
  if (target.machineView) {
    layout.machineOpen = true;
    layout.machineView = target.machineView;
  }
  if (target.focusSearch) await nextTick(() => searchRef.value?.focus());
}
function resetLayout(): void {
  layout.reset();
  toast.success("已恢复默认布局");
}
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (matchesShortcut(event, settings.shortcutPalette)) {
    event.preventDefault();
    state.paletteOpen = !state.paletteOpen;
  } else if (matchesShortcut(event, settings.shortcutTerminal)) {
    event.preventDefault();
    openConnectionWindow("local");
  } else if (matchesShortcut(event, settings.shortcutSearch)) {
    event.preventDefault();
    void nextTick(() => searchRef.value?.focus());
  } else if (matchesShortcut(event, settings.shortcutFiles)) {
    event.preventDefault();
    void runWorkspaceAction("files");
  } else if (event.key === "Escape") state.paletteOpen = false;
});
</script>

<template>
  <WindowFrame ambient class="h-screen w-screen">
    <!-- 标题栏：Windows 形态 —— 品牌在左，窗口按钮贴右上角。
         带 data-tauri-drag-region 的区域可拖拽，按钮本身不带故不受影响 -->
    <header
      class="win-bar relative z-10"
      data-tauri-drag-region
      @dblclick="handleTitleBarDblClick"
    >
      <div class="flex items-center gap-2" data-tauri-drag-region>
        <BrandLogo />
        <h1 class="text-[13px] font-medium tracking-tight text-txt">
          MiraiHub
        </h1>
      </div>

      <NavigationControls />
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
        <IconButton
          icon="lucide:command"
          :title="`命令面板 (${formatShortcut(settings.shortcutPalette)})`"
          @click="paletteOpen = true"
        />
        <IconButton
          icon="lucide:plus"
          title="新建连接"
          @click="addConnection"
        />
        <TransferCenter />
        <NotificationCenter />
        <WorkspaceHelp />

        <button
          type="button"
          class="ml-1 size-7 shrink-0 rounded-full border border-line-strong"
          style="
            background: linear-gradient(
              140deg,
              var(--color-orange),
              var(--color-pink)
            );
          "
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
        <div
          class="flex h-11 shrink-0 items-end gap-2 border-b border-line-soft px-2.5"
        >
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
              :icon="
                machineOpen
                  ? 'lucide:panel-right-close'
                  : 'lucide:panel-right-open'
              "
              :size="14"
              :title="machineOpen ? '收起机器面板' : '展开机器面板'"
              @click="machineOpen = !machineOpen"
            />
            <IconButton
              :icon="fullscreen ? 'lucide:minimize' : 'lucide:maximize'"
              :size="14"
              :title="fullscreen ? '退出全屏 (Esc)' : '全屏 (F11)'"
              @click="toggleFullscreen"
            />
          </div>
        </div>

        <!-- 主视图：跟随侧栏切换。各视图自带 .pane，浮在窗口底色上 -->
        <div class="flex min-h-0 flex-1 p-2.5">
          <RouterView v-slot="{ Component, route }">
            <KeepAlive>
              <component :is="Component" :key="route.name" />
            </KeepAlive>
          </RouterView>
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
