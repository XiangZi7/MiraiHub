<script setup lang="ts">
import { computed, reactive, toRaw } from 'vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useConnections } from '@/composables/useConnections'
import { useWorkspaceTabs } from '@/composables/useWorkspaceTabs'
import { NAV_ITEMS } from '@/constants/workspace'
import type { ConnectionGroupView, SavedConnection } from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import type { NavId } from '@/types'
import { cn } from '@/utils/cn'
import { openConnectionWindow, openSettingsWindow } from '@/utils/window'
import SidebarProjects from './SidebarProjects.vue'

// 当前选中的主视图，由 MainWindow 通过 v-model:active 控制
const active = defineModel<NavId>('active', { required: true })
const width = defineModel<number>('width', { required: true })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const emit = defineEmits<{
  /** 请求打开某条连接 */
  open: [connection: SavedConnection]
}>()

const {
  groupsFor,
  loaded,
  create: createConnection,
  update: updateConnection,
  remove: removeConnection,
  createGroup,
  renameGroup,
  removeGroup,
} = useConnections()
const { tabs, activeId } = useWorkspaceTabs()

// 响应式状态
const state = reactive({
  pendingConnection: null as SavedConnection | null,
  pendingGroup: null as ConnectionGroupView | null,
  addMenuOpen: false,
  addMenuX: 0,
  addMenuY: 0,
})

const addMenuItems: ContextMenuItem[] = [
  { id: 'ssh', label: 'SSH Connection', icon: 'lucide:server' },
  { id: 'local', label: 'Local Terminal', icon: 'lucide:square-terminal' },
  { id: 'database', label: 'Database Connection', icon: 'lucide:database', separatorBefore: true },
]

/**
 * 项目树跟随主视图切换。
 *
 * 侧栏上半区选的是"看哪一类连接"，下半区就该只列这一类 ——
 * 停在 Databases 却看到一堆 SSH 服务器，点下去还跳回终端，是自相矛盾的。
 * SSH Keys / Recent 不是连接列表，此时沿用 servers 的树，
 * 让用户从密钥页直接点服务器打开终端。
 */
const projectGroups = computed(() =>
  groupsFor(active.value === 'databases' ? 'database' : 'ssh'),
)

/** 分组标题：Databases 视图下叫 Connections 更贴切 */
const groupsLabel = computed(() =>
  active.value === 'databases' ? 'Databases' : 'Projects',
)

const currentGroupKind = computed(() =>
  active.value === 'databases' ? 'database' as const : 'ssh' as const,
)

/** 已打开且连上的连接 id，用来给节点点亮绿点 */
const connectedIds = computed(
  () => new Set(tabs.filter(tab => tab.status === 'connected').map(tab => tab.id)),
)

const openIds = computed(() => new Set(tabs.map(tab => tab.id)))

/** 新建连接时带上当前视图对应的类型，省一次手动切换 */
function addConnection(): void {
  openConnectionWindow(active.value === 'databases' ? 'database' : 'ssh')
}

function openAddMenu(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  state.addMenuX = rect.left
  state.addMenuY = rect.top - 112
  state.addMenuOpen = true
}

function selectConnectionKind(kind: string): void {
  if (kind === 'ssh' || kind === 'local' || kind === 'database')
    openConnectionWindow(kind)
}

function editConnection(connection: SavedConnection): void {
  openConnectionWindow(
    connection.kind === 'local'
      ? 'local'
      : connection.kind === 'ssh' ? 'ssh' : 'database',
    connection.id,
  )
}

async function moveConnection(connectionId: string, groupName: string): Promise<void> {
  await updateConnection(connectionId, { group: groupName })
}

async function duplicateConnection(connection: SavedConnection): Promise<void> {
  await createConnection({
    name: `${connection.name} Copy`,
    kind: connection.kind,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    group: connection.group,
    description: connection.description,
    tags: [...connection.tags],
    tagColor: connection.tagColor,
    settings: structuredClone(toRaw(connection.settings)),
  })
}

function requestRemoveConnection(connection: SavedConnection): void {
  state.pendingConnection = connection
  state.pendingGroup = null
}

function requestRemoveGroup(group: ConnectionGroupView): void {
  state.pendingConnection = null
  state.pendingGroup = group
}

function closeConfirmation(): void {
  state.pendingConnection = null
  state.pendingGroup = null
}

async function confirmRemoval(): Promise<void> {
  const connection = state.pendingConnection
  const group = state.pendingGroup
  closeConfirmation()

  if (connection)
    await removeConnection(connection.id)
  else if (group)
    await removeGroup(group.id)
}
</script>

<template>
  <aside
    class="app-sidebar"
    :style="{ width: collapsed ? '3.25rem' : `${width}px` }"
    aria-label="主侧边栏"
  >
    <!-- 顶部工具条 -->
    <div :class="['flex h-11 shrink-0 items-center gap-1 border-b border-line-soft', collapsed ? 'justify-center px-1.5' : 'px-2.5']">
      <template v-if="!collapsed">
        <IconButton icon="lucide:panel-left" title="侧边栏" @click="collapsed = true" />
        <IconButton icon="lucide:layout-grid" title="布局" />
        <div class="flex-1" />
      </template>
      <IconButton
        :icon="collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'"
        :title="collapsed ? '展开侧栏' : '折叠侧栏'"
        @click="collapsed = !collapsed"
      />
    </div>

    <div :class="['flex-1 overflow-y-auto py-3 scroll-thin', collapsed ? 'px-1.5' : 'px-2']">
      <!-- 工作区 -->
      <p v-if="!collapsed" class="group-label mb-1.5">
        Workspace
      </p>
      <nav class="space-y-0.5">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          type="button"
          :class="cn('nav-item w-full', collapsed && 'justify-center px-0', active === item.id && 'nav-item-active')"
          :title="collapsed ? item.label : undefined"
          @click="active = item.id"
        >
          <AppIcon :name="item.icon" :size="15" class="text-txt-3" />
          <span v-if="!collapsed">{{ item.label }}</span>
        </button>
      </nav>

      <SidebarProjects
        v-if="!collapsed"
        :label="groupsLabel"
        :groups="projectGroups"
        :loaded="loaded"
        :active-id="activeId"
        :connected-ids="connectedIds"
        :open-ids="openIds"
        @open="emit('open', $event)"
        @add-connection="addConnection"
        @create-group="createGroup(currentGroupKind, $event)"
        @rename-group="renameGroup"
        @remove-group="requestRemoveGroup"
        @move="moveConnection"
        @edit="editConnection"
        @duplicate="duplicateConnection"
        @remove="requestRemoveConnection"
      />
    </div>

    <!-- 底部操作 -->
    <div :class="['flex shrink-0 items-center gap-2 border-t border-line-soft', collapsed ? 'flex-col p-1.5' : 'p-2.5']">
      <button
        type="button"
        :class="['btn', collapsed ? 'size-7 px-0' : 'flex-1']"
        :title="collapsed ? 'Add Connection' : undefined"
        @click="openAddMenu"
      >
        <AppIcon name="lucide:plus" :size="14" />
        <span v-if="!collapsed">Add Connection</span>
      </button>
      <IconButton icon="lucide:settings" title="设置" @click="openSettingsWindow" />
    </div>
  </aside>

  <AppConfirmDialog
    :open="Boolean(state.pendingConnection || state.pendingGroup)"
    :title="state.pendingConnection ? '删除连接' : '删除分组'"
    :description="state.pendingConnection
      ? `确定删除“${state.pendingConnection.name}”吗？此操作不会删除服务器上的任何数据。`
      : `确定删除“${state.pendingGroup?.name ?? ''}”吗？其中的连接会移到 Ungrouped。`"
    confirm-label="删除"
    danger
    @close="closeConfirmation"
    @confirm="confirmRemoval"
  />

  <AppContextMenu
    :open="state.addMenuOpen"
    :x="state.addMenuX"
    :y="state.addMenuY"
    :items="addMenuItems"
    label="新建连接"
    @select="selectConnectionKind"
    @close="state.addMenuOpen = false"
  />
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--color-line-soft);
  background: var(--color-panel);
}
</style>
