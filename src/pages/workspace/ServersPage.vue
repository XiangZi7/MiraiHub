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
import LocalTerminalPanel from '@/components/workspace/LocalTerminalPanel.vue'
import TerminalPanel from '@/components/workspace/TerminalPanel.vue'
import SshTerminalWorkspace from '@/components/workspace/SshTerminalWorkspace.vue'

const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const layout = useWorkspaceLayoutStore()
const { activeNav } = useWorkspaceNavigation()
const tabSplit = injectWorkspaceTabSplit()
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
const handleSshStatus = (
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

const activeTerminalTab = computed(() => {
  const tab = activeTab.value
  return tab &&
    (tab.connection.kind === 'ssh' || tab.connection.kind === 'local')
    ? tab
    : undefined
})

async function action(id: string, action: string): Promise<void> {
  if (action === 'files' || action === 'upload') {
    if (!openTabs.some(tab => tab.id === id && tab.connection.kind === 'ssh'))
      return
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
        :startup-command="tab.startupCommand"
        @status="
          (status, sessionId) => handleSshStatus(tab.id, status, sessionId)
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
        v-show="visible(tab.id)"
        :title="tab.title"
        :settings="tab.settings"
        @status="
          (status, sessionId) => handleSshStatus(tab.id, status, sessionId)
        "
      />
    </Teleport>

    <Teleport
      :to="tabSplit?.targetFor(activeId) ?? 'body'"
      :disabled="!tabSplit?.targetFor(activeId)"
    >
      <TerminalPanel
        v-if="!activeTerminalTab"
        v-show="activeNav === 'servers'"
        key="empty-terminal"
      />
    </Teleport>
  </div>
</template>
