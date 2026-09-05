<script setup lang="ts">
import { computed, onMounted, reactive, toRefs } from "vue";
import { useIntervalFn } from "@vueuse/core";
import * as ssh from "@/api/ssh";
import * as api from "@/api/operations";
import type { SshSessionInfo } from "@/types/ssh";
import OperationDialog from "./OperationDialog.vue";
import AppButton from "@/components/ui/AppButton.vue";
import IconButton from "@/components/ui/IconButton.vue";
import { copyText } from "@/utils/clipboard";
const props = defineProps<{ preferredSessionId?: string }>();
const emit = defineEmits<{ close: [] }>();
const state = reactive({
  sessions: [] as SshSessionInfo[],
  tunnels: [] as api.Tunnel[],
  sessionId: props.preferredSessionId ?? "",
  bindPort: 0,
  targetHost: "127.0.0.1",
  targetPort: 3306,
  busy: false,
  loading: false,
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
  error,
} = toRefs(state);
const valid = computed(
  () =>
    state.sessions.some((s) => s.id === state.sessionId) &&
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
    ><p class="text-[11px] leading-5 text-txt-3">
      将本机端口通过已连接的 SSH 转发到远端目标。监听地址固定为
      127.0.0.1，其他电脑无法直接访问；断开 SSH 或退出应用后隧道关闭。
    </p>
    <form class="tunnel-form" @submit.prevent="start">
      <label class="field col-span-2"
        >SSH 连接<select v-model="sessionId" :disabled="busy">
          <option value="" disabled>请选择已连接服务器</option>
          <option v-for="s in sessions" :key="s.id" :value="s.id">
            {{ s.username }}@{{ s.host }}:{{ s.port }}
          </option>
        </select></label
      ><label class="field"
        >本地端口<input
          v-model="bindPort"
          type="number"
          min="0"
          max="65535"
          :disabled="busy"
        /><small>0 表示自动分配空闲端口</small></label
      ><label class="field"
        >远端目标端口<input
          v-model="targetPort"
          type="number"
          min="1"
          max="65535"
          :disabled="busy" /></label
      ><label class="field col-span-2"
        >远端目标主机<input
          v-model="targetHost"
          :disabled="busy"
          placeholder="127.0.0.1 或内网数据库地址"
        /><small
          >由 SSH 服务器访问此地址；127.0.0.1 指 SSH 服务器自身。</small
        ></label
      ><AppButton type="submit" variant="primary" :disabled="busy || !valid"
        >建立本地隧道</AppButton
      ><AppButton :disabled="busy" @click="refresh">刷新连接</AppButton>
    </form>
    <p v-if="!sessions.length" class="text-txt-3">
      请先在工作区连接一台 SSH 服务器。
    </p>
    <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
    <div class="tunnel-list">
      <p v-if="!tunnels.length" class="p-5 text-center text-txt-4">
        还没有建立隧道
      </p>
      <article v-for="row in tunnels" :key="row.id">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="break-all font-mono text-[12px]">
              {{ row.bindHost }}:{{ row.bindPort }} → {{ row.targetHost }}:{{
                row.targetPort
              }}
            </p>
            <p class="mt-1 text-[10px] text-txt-3">
              通过 {{ row.endpoint }} ·
              {{ row.status === "running" ? "监听中" : "已停止" }} ·
              {{ row.connections }} 个活动连接
            </p>
            <p v-if="row.error" class="mt-2 break-words text-[10px] text-amber">
              {{ row.error }}
            </p>
          </div>
          <IconButton
            icon="lucide:copy"
            title="复制本地连接地址"
            :size="14"
            @click="copy(row)"
          /><AppButton size="sm" @click="action(row)">{{
            row.status === "running" ? "停止" : "移除"
          }}</AppButton>
        </div>
      </article>
    </div>
    <p class="text-[10px] text-txt-4">
      关闭此窗口会保留正在运行的隧道。每条隧道最多 32
      个并发连接；远端目标不可达时在记录中显示错误。
    </p></OperationDialog
  >
</template>
<style scoped>
.tunnel-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}
.field input,
.field select {
  min-width: 0;
  padding: 8px 10px;
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  color: var(--color-txt);
}
.field small {
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-txt-4);
}
.tunnel-list {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  max-height: 300px;
  overflow: auto;
}
.tunnel-list article {
  padding: 13px;
  border-bottom: 1px solid var(--color-line-soft);
}
</style>
