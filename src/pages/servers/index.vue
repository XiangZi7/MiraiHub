<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceLayoutStore } from '@/stores/workspace-layout'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { registerWorkspaceController } from '@/composables/useWorkspaceControllers'
import { injectWorkspaceTabSplit } from '@/composables/useWorkspaceTabSplit'
import { type SshSessionStatus } from '@/types/ssh'
import {
  isLocalConnection,
  toSshConfig,
  type LocalConnectionSettings,
} from '@/types/connection'
import LocalTerminalPanel from '@/pages/servers/components/local-terminal-panel.vue'
import RemoteDesktopPanel from '@/pages/servers/components/remote-desktop-panel.vue'
import TerminalPanel from '@/components/workspace/TerminalPanel.vue'
import SshTerminalWorkspace from '@/pages/servers/components/ssh-terminal-workspace.vue'

const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const layout = useWorkspaceLayoutStore()
const { activeNav, openDockerForSsh } = useWorkspaceNavigation()
const tabSplit = injectWorkspaceTabSplit()
/** 按当前分屏或活动标签判断会话是否可见，切换标签时保留已挂载的终端。 */
function visible(id: string): boolean {
  return tabSplit ? tabSplit.isVisible(id) : activeId.value === id
}
const sshWorkspaces =
  useTemplateRef<Array<InstanceType<typeof SshTerminalWorkspace>>>(
    'sshWorkspaces'
  )
const localTerminals =
  useTemplateRef<Array<InstanceType<typeof LocalTerminalPanel>>>(
    'localTerminals'
  )
const remoteDesktops =
  useTemplateRef<Array<InstanceType<typeof RemoteDesktopPanel>>>(
    'remoteDesktops'
  )
/** 接收服务器面板的会话状态，同步工作区标签与会话标识。 */
const handleSessionStatus = (
  id: string,
  status: SshSessionStatus,
  sessionId: string
) => workspace.setStatus(id, status, sessionId)
const sshTabViews = computed(() =>
  openTabs
    .filter(tab => tab.connection.kind === 'ssh')
    .map(tab => {
      const settings = tab.connection.settings

      return {
        id: tab.id,
        connection: tab.connection,
        title: tab.connection.name,
        config: toSshConfig(tab.connection),
        terminalType:
          'terminalType' in settings ? settings.terminalType : 'xterm-256color',
        startupCommand:
          'startupCommand' in settings ? settings.startupCommand : '',
      }
    })
)

const localTabViews = computed(() =>
  openTabs.flatMap(tab => {
    const connection = tab.connection
    if (!isLocalConnection(connection)) return []
    return [
      {
        id: tab.id,
        title: connection.name,
        settings: connection.settings as LocalConnectionSettings,
      },
    ]
  })
)

const rdpTabViews = computed(() =>
  openTabs.filter(tab => tab.connection.kind === 'rdp')
)

const activeServerTab = computed(() => {
  const tab = activeTab.value
  return tab &&
    (tab.connection.kind === 'ssh' ||
      tab.connection.kind === 'local' ||
      tab.connection.kind === 'rdp')
    ? tab
    : undefined
})

/** 将工作区菜单操作交给对应终端实例，文件操作同时展开目标连接的文件面板。 */
async function action(id: string, action: string): Promise<void> {
  const kind = openTabs.find(tab => tab.id === id)?.connection.kind
  if (kind === 'rdp') {
    for (const view of remoteDesktops.value ?? [])
      await view.actionFor(id, action)
    return
  }
  if (action === 'files' || action === 'upload') {
    if (kind !== 'ssh' && !(kind === 'local' && action === 'files')) return
    layout.openMachinePane(id, 'files')
    if (action === 'upload') {
      for (const view of sshWorkspaces.value ?? []) await view.uploadFor(id)
    }
    return
  }
  for (const view of [
    ...(sshWorkspaces.value ?? []),
    ...(localTerminals.value ?? []),
  ]) {
    if (action === 'reconnect') await view.reconnectFor(id)
    else if (action === 'disconnect') await view.disconnectFor(id)
  }
  for (const view of sshWorkspaces.value ?? []) {
    if (action === 'split') await view.splitFor(id)
    else if (action === 'focus') view.focusFor(id)
  }
}
registerWorkspaceController('servers', { action })
</script>
<template>
  <div class="contents">
    <!-- SSH 标签保持挂载，只隐藏非活动项；关闭标签时才真正卸载并断开 -->
    <Teleport
      v-for="tab in sshTabViews"
      :key="tab.id"
      :to="tabSplit?.targetFor(tab.id) ?? 'body'"
      :disabled="!tabSplit?.targetFor(tab.id)"
    >
      <SshTerminalWorkspace
        ref="sshWorkspaces"
        :connection-id="tab.id"
        :connection="tab.connection"
        :active="
          visible(tab.id) && (Boolean(tabSplit) || activeNav === 'servers')
        "
        v-show="visible(tab.id)"
        :config="tab.config"
        :title="tab.title"
        :terminal-type="tab.terminalType"
        @open-docker="openDockerForSsh(tab.id)"
        :startup-command="tab.startupCommand"
        @status="
          (status, sessionId) => handleSessionStatus(tab.id, status, sessionId)
        "
      />
    </Teleport>

    <Teleport
      v-for="tab in localTabViews"
      :key="tab.id"
      :to="tabSplit?.targetFor(tab.id) ?? 'body'"
      :disabled="!tabSplit?.targetFor(tab.id)"
    >
      <LocalTerminalPanel
        ref="localTerminals"
        :connection-id="tab.id"
        :active="visible(tab.id)"
        v-show="visible(tab.id)"
        :title="tab.title"
        :settings="tab.settings"
        @status="
          (status, sessionId) => handleSessionStatus(tab.id, status, sessionId)
        "
      />
    </Teleport>

    <!-- RDP 标签保留已连接的 IronRDP 会话，在工作区分屏中显示画布。 -->
    <Teleport
      v-for="tab in rdpTabViews"
      :key="tab.id"
      :to="tabSplit?.targetFor(tab.id) ?? 'body'"
      :disabled="!tabSplit?.targetFor(tab.id)"
    >
      <!-- 远程桌面面板使用已保存凭据连接，并呈现 Windows 画面与键鼠交互。 -->
      <RemoteDesktopPanel
        v-show="visible(tab.id)"
        ref="remoteDesktops"
        :connection="tab.connection"
        :connect-request="tab.rdpConnectRequest"
        :active="visible(tab.id)"
        @status="
          (status, sessionId) => handleSessionStatus(tab.id, status, sessionId)
        "
      />
    </Teleport>

    <Teleport
      :to="tabSplit?.targetFor(activeId) ?? 'body'"
      :disabled="!tabSplit?.targetFor(activeId)"
    >
      <TerminalPanel
        v-if="!tabSplit && !activeServerTab"
        v-show="activeNav === 'servers'"
        key="empty-terminal"
      />
    </Teleport>
  </div>
</template>
