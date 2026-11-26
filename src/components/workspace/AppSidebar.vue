<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, reactive, shallowRef, toRaw, toRef } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppCollapse from '@/components/ui/AppCollapse.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useConnections } from '@/composables/useConnections'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { useWorkspaceTabs } from '@/composables/useWorkspaceTabs'
import { NAV_ITEMS, NAV_GROUP_KIND } from '@/constants/workspace'
import { SERVER_CONNECTION_ICONS } from '@/constants/connection'
import type {
  ConnectionGroupDropPosition,
  ConnectionGroupView,
  SavedConnection,
} from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import type { NavId } from '@/types'
import { cn } from '@/utils/cn'
import { openConnectionWindow, openSettingsWindow } from '@/utils/window'
import { translateLabel } from '@/i18n'
import { isConnectionFormKind } from '@/router/window-entry'
import DatabaseTransferDialog from './database/DatabaseTransferDialog.vue'
import type { DatabaseTransferMode } from './database/DatabaseTransferDialog.vue'
import SidebarProjects from './SidebarProjects.vue'
import SshConfigTransferDialog from '@/components/connection/SshConfigTransferDialog.vue'
import OpenSshImportDialog from '@/components/connection/OpenSshImportDialog.vue'

const { t } = useI18n()
const { settings } = useSettings()

// 当前选中项来自路由；导航由 RouterLink 提交。
const props = defineProps<{ active: NavId }>()
const active = toRef(props, 'active')
const route = useRoute()
const addMenuTrigger = shallowRef<HTMLElement | null>(null)
const width = defineModel<number>('width', { required: true })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const emit = defineEmits<{
  resetLayout: []
  /** 请求打开某条连接 */
  open: [connection: SavedConnection]
  openDocker: [sshId: string]
  /** 在数据库连接的默认数据库中新建查询 */
  newDatabaseQuery: [connection: SavedConnection]
  /** SQL 导入完成，请求对应数据库工作区刷新对象树 */
  databaseImported: [connectionId: string]
}>()

const {
  connections,
  groupsFor,
  loaded,
  create: createConnection,
  update: updateConnection,
  remove: removeConnection,
  createGroup,
  renameGroup,
  reorderGroup,
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
  sshTransferOpen: false,
  // 从 ~/.ssh/config 导入对话框是否打开
  opensshImportOpen: false,
})

const addMenuItems = computed<ContextMenuItem[]>(() => [
  { id: 'ssh', label: t('SSH Connection'), icon: SERVER_CONNECTION_ICONS.ssh },
  { id: 'local', label: t('Local Terminal'), icon: SERVER_CONNECTION_ICONS.local },
  { id: 'rdp', label: t('Windows 远程桌面（RDP）'), icon: SERVER_CONNECTION_ICONS.rdp },
  {
    id: 'database',
    label: t('Database Connection'),
    icon: 'lucide:database',
    separatorBefore: true,
  },
  {
    id: 'docker',
    label: t('新建 Docker 连接'),
    icon: 'lucide:container',
  },
  {
    id: 'openssh-config',
    label: t('从 ~/.ssh/config 导入'),
    icon: 'lucide:file-input',
    separatorBefore: true,
  },
])

const currentGroupKind = computed(() => NAV_GROUP_KIND[active.value])
const projectGroups = computed(() => groupsFor(currentGroupKind.value))

const groupsLabel = computed(() =>
  t({ servers: 'Projects', databases: 'Databases', docker: 'Docker 连接' }[active.value])
)
const selectedConnectionId = computed(() =>
  active.value === 'docker' ? String(route.params.connectionId ?? '') : activeId.value
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

/** 新建连接时带上当前视图对应的类型，省一次手动切换；从分组菜单进来还预选该分组 */
function addConnection(group?: string): void {
  openConnectionWindow(
    currentGroupKind.value,
    undefined,
    group
  )
}

/** 从底部按钮向上展开新建连接菜单。 */
function openAddMenu(event: MouseEvent): void {
  if (state.addMenuOpen) {
    state.addMenuOpen = false
    return
  }
  addMenuTrigger.value = event.currentTarget as HTMLElement
  const rect = addMenuTrigger.value.getBoundingClientRect()
  state.addMenuX = rect.left
  state.addMenuY = rect.top - 220
  state.addMenuOpen = true
}

// 选择新建连接类型；导入 ~/.ssh/config 打开预览对话框
function selectConnectionKind(kind: string): void {
  if (kind === 'openssh-config') {
    state.opensshImportOpen = true
    return
  }
  if (isConnectionFormKind(kind)) openConnectionWindow(kind)
}

/** 在对应的原生子窗口编辑侧栏保存的连接。 */
function editConnection(connection: SavedConnection): void {
  openConnectionWindow(
    isConnectionFormKind(connection.kind) ? connection.kind : 'database',
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
      groupName
        ? t('连接已移动到“{value0}”', { value0: groupName })
        : t('连接已移出分组')
    )
  } catch (error) {
    toast.error({
      title: t('移动连接失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 克隆一条连接。
 *
 * 认证方式、启动命令这些都在 settings 里，深拷贝一份，
 * 之后改副本不会反过来动到原连接。
 */
async function duplicateConnection(connection: SavedConnection): Promise<void> {
  try {
    const created = await createConnection({
      name: cloneNameFor(connection.name),
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
    toast.success(t('已克隆为“{value0}”', { value0: created.name }))
  } catch (error) {
    toast.error({
      title: t('克隆连接失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 「生产库」→「生产库 副本」→「生产库 副本 2」……
 *
 * 连克隆两次得给出两个不同的名字，否则侧栏里会并排躺着两条看不出区别的记录；
 * 先剥掉已有的副本后缀，避免出现「副本 副本 副本」。
 */
function cloneNameFor(name: string): string {
  const base = name.replace(/\s*副本(\s*\d+)?$/, '').trim() || name
  const taken = new Set(connections.map(item => item.name))
  let candidate = t('{value0} 副本', { value0: base })

  for (let index = 2; taken.has(candidate); index += 1)
    candidate = t('{value0} 副本 {value1}', { value0: base, value1: index })

  return candidate
}

async function handleCreateGroup(name: string): Promise<void> {
  try {
    await createGroup(currentGroupKind.value, name)
    toast.success(t('分组“{value0}”已创建', { value0: name }))
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
    toast.success(t('分组已重命名为“{value0}”', { value0: name }))
  } catch (error) {
    toast.error({
      title: t('重命名分组失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleReorderGroup(
  groupId: string,
  targetGroupId: string,
  position: ConnectionGroupDropPosition
): Promise<void> {
  try {
    await reorderGroup(groupId, targetGroupId, position)
  } catch (error) {
    toast.error({
      title: t('调整分组顺序失败'),
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
          :active-id="selectedConnectionId"
          :connected-ids="connectedIds"
          :open-ids="openIds"
          :show-address="settings.showConnectionAddress"
          @open="emit('open', $event)"
          @open-docker="emit('openDocker', $event)"
          @add-connection="addConnection"
          @create-group="handleCreateGroup"
          @rename-group="handleRenameGroup"
          @reorder-group="handleReorderGroup"
          @remove-group="requestRemoveGroup"
          @move="moveConnection"
          @edit="editConnection"
          @duplicate="duplicateConnection"
          @new-database-query="emit('newDatabaseQuery', $event)"
          @export-database="openDatabaseTransfer($event, 'export')"
          @import-database="openDatabaseTransfer($event, 'import')"
          @transfer-ssh="state.sshTransferOpen = true"
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
        aria-haspopup="menu"
        :aria-expanded="state.addMenuOpen"
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
    :trigger="addMenuTrigger"
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

  <SshConfigTransferDialog
    :open="state.sshTransferOpen"
    @close="state.sshTransferOpen = false"
  />

  <OpenSshImportDialog
    :open="state.opensshImportOpen"
    @close="state.opensshImportOpen = false"
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
