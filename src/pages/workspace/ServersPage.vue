<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  MACHINE_MIN_WIDTH,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout";
import { useWorkspaceNavigation } from "@/composables/useWorkspaceNavigation";
import { registerWorkspaceController } from "@/composables/useWorkspaceControllers";
import { useWorkspaceStatus } from "@/composables/useWorkspaceStatus";
import {
  isLocalConnection,
  toSshConfig,
  type LocalConnectionSettings,
} from "@/types/connection";
import { openConnectionWindow } from "@/utils/window";
import AppResizeHandle from "@/components/ui/AppResizeHandle.vue";
import MachinePanel from "@/components/workspace/MachinePanel.vue";
import LocalTerminalPanel from "@/components/workspace/LocalTerminalPanel.vue";
import TerminalPanel from "@/components/workspace/TerminalPanel.vue";
import SshTerminalWorkspace from "@/components/workspace/SshTerminalWorkspace.vue";
const workspace = useWorkspaceStore();
const openTabs = workspace.tabs;
const { activeId, active: activeTab } = storeToRefs(workspace);
const { machineWidth, machineOpen, machineView, machineMaxWidth } = storeToRefs(
  useWorkspaceLayoutStore(),
);
const { activeNav } = useWorkspaceNavigation();
const sshWorkspaces =
  useTemplateRef<Array<InstanceType<typeof SshTerminalWorkspace>>>(
    "sshWorkspaces",
  );
const localTerminals =
  useTemplateRef<Array<InstanceType<typeof LocalTerminalPanel>>>(
    "localTerminals",
  );
const machinePanel =
  useTemplateRef<InstanceType<typeof MachinePanel>>("machinePanel");
const handleSshStatus = useWorkspaceStatus();
const sshTabViews = computed(() =>
  openTabs
    .filter((tab) => tab.connection.kind === "ssh")
    .map((tab) => {
      const settings = tab.connection.settings;

      return {
        id: tab.id,
        title: tab.connection.name,
        config: toSshConfig(tab.connection),
        terminalType:
          "terminalType" in settings ? settings.terminalType : "xterm-256color",
        startupCommand:
          "startupCommand" in settings ? settings.startupCommand : "",
      };
    }),
);

const localTabViews = computed(() =>
  openTabs.flatMap((tab) => {
    const connection = tab.connection;
    if (!isLocalConnection(connection)) return [];
    return [
      {
        id: tab.id,
        title: connection.name,
        settings: connection.settings as LocalConnectionSettings,
      },
    ];
  }),
);

/** 当前标签按主视图收窄，避免把数据库连接传进机器面板，反之亦然 */
const activeSshTab = computed(() =>
  activeTab.value?.connection.kind === "ssh" ? activeTab.value : undefined,
);

const activeTerminalTab = computed(() => {
  const tab = activeTab.value;
  return tab &&
    (tab.connection.kind === "ssh" || tab.connection.kind === "local")
    ? tab
    : undefined;
});

async function action(id: string, action: string): Promise<void> {
  if (action === "files" || action === "upload") {
    machineOpen.value = true;
    machineView.value = "files";
    await nextTick();
    if (action === "upload") await machinePanel.value?.upload();
    return;
  }
  for (const view of [
    ...(sshWorkspaces.value ?? []),
    ...(localTerminals.value ?? []),
  ]) {
    if (action === "reconnect") await view.reconnectFor(id);
    else if (action === "disconnect") await view.disconnectFor(id);
  }
  for (const view of sshWorkspaces.value ?? []) {
    if (action === "split") await view.splitFor(id);
    else if (action === "focus") view.focusFor(id);
  }
}
async function runWorkspaceAction(actionName: string): Promise<void> {
  if (actionName === "database") {
    openConnectionWindow("database");
    return;
  }
  if (activeSshTab.value) await action(activeSshTab.value.id, actionName);
}
registerWorkspaceController("servers", { action });
</script>
<template>
  <div class="contents">
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
      @status="
        (status, sessionId) => handleSshStatus(tab.id, status, sessionId)
      "
    />

    <LocalTerminalPanel
      ref="localTerminals"
      :connection-id="tab.id"
      v-for="tab in localTabViews"
      v-show="activeId === tab.id"
      :key="tab.id"
      :title="tab.title"
      :settings="tab.settings"
      @status="
        (status, sessionId) => handleSshStatus(tab.id, status, sessionId)
      "
    />

    <TerminalPanel v-if="!activeTerminalTab" key="empty-terminal" />

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
      @action="runWorkspaceAction"
      v-if="machineOpen && Boolean(activeSshTab)"
      v-model:view="machineView"
      :connection="activeSshTab?.connection"
      :session-id="activeSshTab?.sessionId ?? ''"
      :width="machineWidth"
      @close="machineOpen = false"
    />
  </div>
</template>
