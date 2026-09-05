<script setup lang="ts">
import { computed, onMounted, reactive, toRefs } from "vue";
import { useIntervalFn } from "@vueuse/core";
import * as ssh from "@/api/ssh";
import * as api from "@/api/operations";
import type { SshSessionInfo } from "@/types/ssh";
import OperationDialog from "./OperationDialog.vue";
import TunnelCreateForm from "./TunnelCreateForm.vue";
import TunnelList from "./TunnelList.vue";
import { copyText } from "@/utils/clipboard";
const props = defineProps<{ preferredSessionId?: string }>();
const emit = defineEmits<{ close: [] }>();
// 响应式状态
const state = reactive({
  // 当前可用的 SSH 会话
  sessions: [] as SshSessionInfo[],
  // 已建立的隧道记录
  tunnels: [] as api.Tunnel[],
  // 选中的 SSH 会话
  sessionId: props.preferredSessionId ?? "",
  // 本地监听端口，输入框清空时保留空字符串
  bindPort: 0 as number | string,
  // SSH 服务器访问的目标地址
  targetHost: "127.0.0.1",
  // 目标服务端口
  targetPort: 3306 as number | string,
  // 建立隧道期间锁定配置
  busy: false,
  // 正在刷新连接与隧道
  loading: false,
  // 操作失败时的提示
  error: "",
});
const {
  sessions,
  tunnels,
  sessionId,
  bindPort,
  targetHost,
  targetPort,
  busy,
  loading,
  error,
} = toRefs(state);
const valid = computed(
  () =>
    state.sessions.some((s) => s.id === state.sessionId) &&
    state.bindPort !== "" &&
    Number.isInteger(Number(state.bindPort)) &&
    Number(state.bindPort) >= 0 &&
    Number(state.bindPort) <= 65535 &&
    Number.isInteger(Number(state.targetPort)) &&
    Number(state.targetPort) > 0 &&
    Number(state.targetPort) <= 65535 &&
    Boolean(state.targetHost.trim()),
);
async function refresh(): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  try {
    const [sessions, tunnels] = await Promise.all([
      ssh.listSessions(),
      api.listTunnels(),
    ]);
    state.sessions = sessions;
    state.tunnels = tunnels;
    if (!state.sessionId && sessions[0]) state.sessionId = sessions[0].id;
  } catch (error) {
    state.error = api.errorMessage(error);
  } finally {
    state.loading = false;
  }
}
onMounted(refresh);
useIntervalFn(() => void refresh(), 2000);
async function start(): Promise<void> {
  if (!valid.value || state.busy) return;
  state.busy = true;
  state.error = "";
  try {
    await api.startTunnel({
      sessionId: state.sessionId,
      bindHost: "127.0.0.1",
      bindPort: Number(state.bindPort),
      targetHost: state.targetHost.trim(),
      targetPort: Number(state.targetPort),
    });
    await refresh();
  } catch (error) {
    state.error = api.errorMessage(error);
  } finally {
    state.busy = false;
  }
}
async function action(row: api.Tunnel): Promise<void> {
  state.error = "";
  try {
    if (row.status === "running") await api.stopTunnel(row.id);
    else await api.removeTunnel(row.id);
    await refresh();
  } catch (error) {
    state.error = api.errorMessage(error);
  }
}
async function copy(row: api.Tunnel): Promise<void> {
  try {
    await copyText(`${row.bindHost}:${row.bindPort}`);
  } catch (error) {
    state.error = api.errorMessage(error);
  }
}
</script>

<template>
  <OperationDialog
    title="SSH 隧道 / 本地端口转发"
    :busy="busy"
    @close="emit('close')"
  >
    <div class="tunnel-manager">
      <p class="tunnel-intro">
        通过已连接的 SSH 服务器，将本机端口转发到远端服务。
      </p>
      <TunnelCreateForm
        v-model:session-id="sessionId"
        v-model:bind-port="bindPort"
        v-model:target-host="targetHost"
        v-model:target-port="targetPort"
        :sessions="sessions"
        :busy="busy"
        :loading="loading"
        :valid="valid"
        @submit="start"
        @refresh="refresh"
      />
      <p v-if="error" role="alert" class="tunnel-error">{{ error }}</p>
      <TunnelList :tunnels="tunnels" @copy="copy" @action="action" />
      <p class="tunnel-footer">
        关闭此窗口后隧道继续运行，断开 SSH 或退出应用后停止。每条隧道最多 32
        个并发连接。
      </p>
    </div>
  </OperationDialog>
</template>

<style scoped>
.tunnel-manager {
  display: grid;
  flex: none;
  min-width: 0;
  gap: 20px;
}
.tunnel-intro {
  color: var(--color-txt-2);
  font-size: 12px;
  line-height: 1.7;
}
.tunnel-error {
  padding: 10px 12px;
  border: 1px solid color-mix(in oklch, var(--color-danger) 25%, transparent);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-danger) 7%, transparent);
  color: var(--color-danger);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.tunnel-footer {
  color: var(--color-txt-3);
  font-size: 11px;
  line-height: 1.7;
}
</style>
