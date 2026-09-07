<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, reactive, toRaw, toRef } from 'vue'
import { RouterLink } from 'vue-router'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppCollapse from '@/components/ui/AppCollapse.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useConnections } from '@/composables/useConnections'
import { toast } from '@/composables/useToast'
import { useWorkspaceTabs } from '@/composables/useWorkspaceTabs'
import { NAV_ITEMS } from '@/constants/workspace'
import type { ConnectionGroupView, SavedConnection } from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import type { NavId } from '@/types'
import { cn } from '@/utils/cn'
import { openConnectionWindow, openSettingsWindow } from '@/utils/window'
import { translateLabel } from '@/i18n'
import DatabaseTransferDialog from './database/DatabaseTransferDialog.vue'
import type { DatabaseTransferMode } from './database/DatabaseTransferDialog.vue'
import SidebarProjects from './SidebarProjects.vue'

const { t } = useI18n()

// 当前选中项来自路由；导航由 RouterLink 提交。
const props = defineProps<{ active: NavId }>()
const active = toRef(props, 'active')
const width = defineModel<number>('width', { required: true })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const emit = defineEmits<{
  resetLayout: []
  /** 请求打开某条连接 */
  open: [connection: SavedConnection]
  /** 在数据库连接的默认数据库中新建查询 */
  newDatabaseQuery: [connection: SavedConnection]
  /** SQL 导入完成，请求对应数据库工作区刷新对象树 */
  databaseImported: [connectionId: string]
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
  transferConnection: null as SavedConnection | null,
  transferMode: 'export' as DatabaseTransferMode,
})

const addMenuItems = computed<ContextMenuItem[]>(() => [
  { id: 'ssh', label: t('SSH Connection'), icon: 'lucide:server' },
  { id: 'local', label: t('Local Terminal'), icon: 'lucide:square-terminal' },
  {
    id: 'database',
    label: t('Database Connection'),
    icon: 'lucide:database',
    separatorBefore: true,
  },
])

/**
 * 项目树跟随主视图切换。
 *
 * 侧栏上半区选的是"看哪一类连接"，下半区就该只列这一类 ——
 * 停在 Databases 却看到一堆 SSH 服务器，点下去还跳回终端，是自相矛盾的。
 * SSH Keys / Recent 不是连接列表，此时沿用 servers 的树，
 * 让用户从密钥页直接点服务器打开终端。
 */
const projectGroups = computed(() =>
  groupsFor(active.value === 'databases' ? 'database' : 'ssh')
)

/** 分组标题：Databases 视图下叫 Connections 更贴切 */
const groupsLabel = computed(() =>
  active.value === 'databases' ? t('Databases') : t('Projects')
)

const currentGroupKind = computed(() =>
  active.value === 'databases' ? ('database' as const) : ('ssh' as const)
)

/** 已打开且连上的连接 id，用来给节点点亮绿点 */
const connectedIds = computed(
  () =>
    new Set(tabs.filter(tab => tab.status === 'connected').map(tab => tab.id))
)

const openIds = computed(() => new Set(tabs.map(tab => tab.id)))

const transferSessionId = computed(() => {
  const connectionId = state.transferConnection?.id
  return (
    tabs.find(tab => tab.id === connectionId && tab.status === 'connected')
      ?.sessionId ?? ''
  )
})

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
      : connection.kind === 'ssh'
        ? 'ssh'
        : 'database',
    connection.id
  )
}

async function moveConnection(
  connectionId: string,
  groupName: string
): Promise<void> {
  try {
    await updateConnection(connectionId, { group: groupName })
    toast.success(
      groupName ? `连接已移动到“${groupName}”` : t('连接已移到 Ungrouped')
    )
  } catch (error) {
    toast.error({
      title: t('移动连接失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

async function duplicateConnection(connection: SavedConnection): Promise<void> {
  try {
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
    toast.success(`连接“${connection.name}”已复制`)
  } catch (error) {
    toast.error({
      title: t('复制连接失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleCreateGroup(name: string): Promise<void> {
  try {
    await createGroup(currentGroupKind.value, name)
    toast.success(`分组“${name}”已创建`)
  } catch (error) {
    toast.error({
      title: t('创建分组失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleRenameGroup(groupId: string, name: string): Promise<void> {
  try {
    await renameGroup(groupId, name)
    toast.success(`分组已重命名为“${name}”`)
  } catch (error) {
    toast.error({
      title: t('重命名分组失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

function requestRemoveConnection(connection: SavedConnection): void {
  state.pendingConnection = connection
  state.pendingGroup = null
}

function requestRemoveGroup(group: ConnectionGroupView): void {
  state.pendingConnection = null
  state.pendingGroup = group
}

function openDatabaseTransfer(
  connection: SavedConnection,
  mode: DatabaseTransferMode
): void {
  state.transferConnection = connection
  state.transferMode = mode
}

function closeDatabaseTransfer(): void {
  state.transferConnection = null
}

function handleDatabaseTransferFinished(mode: DatabaseTransferMode): void {
  if (mode === 'import' && state.transferConnection)
    emit('databaseImported', state.transferConnection.id)
}

function closeConfirmation(): void {
  state.pendingConnection = null
  state.pendingGroup = null
}

async function confirmRemoval(): Promise<void> {
  const connection = state.pendingConnection
  const group = state.pendingGroup
  closeConfirmation()

  try {
    if (connection) {
      await removeConnection(connection.id)
      toast.success(t('workspace.connectionDeleted', { name: connection.name }))
    } else if (group) {
      await removeGroup(group.id)
      toast.success(t('workspace.groupDeleted', { name: group.name }))
    }
  } catch (error) {
    toast.error({
      title: t('删除失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}
</script>

<template>
  <aside
    class="app-sidebar"
    :class="{ 'is-collapsed': collapsed }"
    :style="{ width: collapsed ? '3.25rem' : `${width}px` }"
    :aria-label="t('主侧边栏')"
  >
    <!-- 顶部工具条 -->
    <div
      :class="[
        'border-line-soft flex h-11 shrink-0 items-center gap-1 border-b',
        collapsed ? 'justify-center px-1.5' : 'px-2.5',
      ]"
    >
      <template v-if="!collapsed">
        <IconButton
          icon="lucide:panel-left"
          :title="t('侧边栏')"
          @click="collapsed = true"
        />
        <IconButton
          icon="lucide:layout-grid"
          :title="t('恢复默认布局')"
          @click="emit('resetLayout')"
        />
        <div class="flex-1" />
      </template>
      <IconButton
        :icon="collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'"
        :title="collapsed ? t('展开侧栏') : t('折叠侧栏')"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      />
    </div>

    <div
      :class="[
        'scroll-thin flex-1 overflow-y-auto py-3',
        collapsed ? 'px-1.5' : 'px-2',
      ]"
    >
      <!-- 工作区 -->
      <AppCollapse :open="!collapsed">
        <p class="group-label mb-1.5">{{ t('Workspace') }}</p>
      </AppCollapse>
      <nav class="space-y-0.5">
        <RouterLink
          v-for="item in NAV_ITEMS"
          :key="item.id"
          :to="{ name: item.id }"
          :aria-current="active === item.id ? 'page' : undefined"
          :class="
            cn(
              'nav-item w-full',
              collapsed && 'justify-center px-0',
              active === item.id && 'nav-item-active'
            )
          "
          :title="collapsed ? translateLabel(item.label) : undefined"
        >
          <AppIcon
            :name="item.icon"
            :size="15"
            class="text-txt-3"
          />
          <span
            class="sidebar-label"
            :aria-hidden="collapsed"
            >{{ translateLabel(item.label) }}</span
          >
        </RouterLink>
      </nav>

      <AppCollapse :open="!collapsed">
        <SidebarProjects
          :kind="currentGroupKind"
          :label="groupsLabel"
          :groups="projectGroups"
          :loaded="loaded"
          :active-id="activeId"
          :connected-ids="connectedIds"
          :open-ids="openIds"
          @open="emit('open', $event)"
          @add-connection="addConnection"
          @create-group="handleCreateGroup"
          @rename-group="handleRenameGroup"
          @remove-group="requestRemoveGroup"
          @move="moveConnection"
          @edit="editConnection"
          @duplicate="duplicateConnection"
          @new-database-query="emit('newDatabaseQuery', $event)"
          @export-database="openDatabaseTransfer($event, 'export')"
          @import-database="openDatabaseTransfer($event, 'import')"
          @remove="requestRemoveConnection"
        />
      </AppCollapse>
    </div>

    <!-- 底部操作 -->
    <div
      :class="[
        'border-line-soft flex shrink-0 items-center gap-2 border-t',
        collapsed ? 'flex-col p-1.5' : 'p-2.5',
      ]"
    >
      <button
        type="button"
        :class="['btn', collapsed ? 'size-7 px-0' : 'flex-1']"
        :title="collapsed ? t('Add Connection') : undefined"
        @click="openAddMenu"
      >
        <AppIcon
          name="lucide:plus"
          :size="14"
        />
        <span
          class="sidebar-label"
          :aria-hidden="collapsed"
          >{{ t('Add Connection') }}</span
        >
      </button>
      <IconButton
        icon="lucide:settings"
        :title="t('设置')"
        @click="openSettingsWindow"
      />
    </div>
  </aside>

  <AppConfirmDialog
    :open="Boolean(state.pendingConnection || state.pendingGroup)"
    :title="state.pendingConnection ? t('删除连接') : t('删除分组')"
    :description="
      state.pendingConnection
        ? t('workspace.deleteConnection', {
            name: state.pendingConnection.name,
          })
        : t('workspace.deleteGroup', { name: state.pendingGroup?.name ?? '' })
    "
    :confirm-label="t('删除')"
    danger
    @close="closeConfirmation"
    @confirm="confirmRemoval"
  />

  <AppContextMenu
    :open="state.addMenuOpen"
    :x="state.addMenuX"
    :y="state.addMenuY"
    :items="addMenuItems"
    :label="t('新建连接')"
    @select="selectConnectionKind"
    @close="state.addMenuOpen = false"
  />

  <DatabaseTransferDialog
    :open="Boolean(state.transferConnection)"
    :mode="state.transferMode"
    :connection="state.transferConnection"
    :session-id="transferSessionId"
    @close="closeDatabaseTransfer"
    @finished="handleDatabaseTransferFinished"
  />
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--color-line-soft);
  background: var(--color-panel);
  overflow: hidden;
  transition: width var(--motion-panel);
}
.sidebar-label {
  max-width: 200px;
  opacity: 1;
  overflow: hidden;
  white-space: nowrap;
  transition:
    max-width var(--motion-panel),
    opacity 180ms ease;
}
.is-collapsed .sidebar-label {
  max-width: 0;
  opacity: 0;
}
.is-collapsed .nav-item,
.is-collapsed .btn {
  gap: 0;
}
.app-sidebar :deep(.app-collapse) {
  min-width: 0;
}
</style>
