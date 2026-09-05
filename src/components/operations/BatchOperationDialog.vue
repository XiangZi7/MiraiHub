<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, toRefs } from "vue";
import { useIntervalFn } from "@vueuse/core";
import * as ssh from "@/api/ssh";
import * as api from "@/api/operations";
import type { SshSessionInfo } from "@/types/ssh";
import OperationDialog from "./OperationDialog.vue";
import AppButton from "@/components/ui/AppButton.vue";
import AppConfirmDialog from "@/components/ui/AppConfirmDialog.vue";
import { copyText } from "@/utils/clipboard";
const emit = defineEmits<{ close: [] }>();
// 预览后只执行后端锁定的计划，编辑表单不会改变已审批内容。
const state = reactive({
  sessions: [] as SshSessionInfo[],
  selected: [] as string[],
  command: "",
  plan: null as api.BatchPlan | null,
  busy: false,
  polling: false,
  error: "",
  reviewed: false,
  closing: false,
});
const { sessions, selected, command, plan, busy, error, reviewed, closing } =
  toRefs(state);
const running = computed(() => state.plan?.status === "running");
const count = computed(
  () =>
    state.plan?.targets.filter((t) =>
      ["success", "failed", "cancelled"].includes(t.status),
    ).length ?? 0,
);
async function refresh(): Promise<void> {
  try {
    state.sessions = await ssh.listSessions();
    state.selected = state.selected.filter((id) =>
      state.sessions.some((s) => s.id === id),
    );
  } catch (error) {
    state.error = api.errorMessage(error);
  }
}
onMounted(refresh);
async function poll(): Promise<void> {
  if (
    !state.plan ||
    state.polling ||
    !["running", "pending"].includes(state.plan.status)
  )
    return;
  state.polling = true;
  const id = state.plan.id;
  try {
    const next = await api.getBatch(id);
    if (state.plan?.id === id) state.plan = next;
  } catch (error) {
    state.error = api.errorMessage(error);
  } finally {
    state.polling = false;
  }
}
useIntervalFn(() => void poll(), 800);
async function prepare(): Promise<void> {
  if (state.busy || !state.selected.length || !state.command.trim()) return;
  state.busy = true;
  state.error = "";
  try {
    state.plan = await api.prepareBatch([...state.selected], state.command);
    state.reviewed = false;
  } catch (error) {
    state.error = api.errorMessage(error);
  } finally {
    state.busy = false;
  }
}
async function execute(): Promise<void> {
  if (
    !state.plan ||
    !state.reviewed ||
    state.busy ||
    state.plan.status !== "pending"
  )
    return;
  state.busy = true;
  state.error = "";
  try {
    state.plan = await api.runBatch(state.plan.id);
  } catch (error) {
    state.error = `执行状态未确认：${api.errorMessage(error)}。请刷新结果，不要重复执行。`;
    await poll();
  } finally {
    state.busy = false;
  }
}
async function stop(): Promise<void> {
  if (!state.plan) return;
  try {
    await api.cancelBatch(state.plan.id);
    await poll();
  } catch (error) {
    state.error = api.errorMessage(error);
  }
}
async function reset(): Promise<void> {
  if (state.plan)
    await api.forgetBatch(state.plan.id).catch((error) => {
      state.error = api.errorMessage(error);
    });
  state.plan = null;
  state.reviewed = false;
}
function close(): void {
  if (running.value) {
    state.closing = true;
    return;
  }
  emit("close");
}
async function confirmClose(): Promise<void> {
  state.closing = false;
  await stop();
  emit("close");
}
onBeforeUnmount(() => {
  if (state.plan) void api.forgetBatch(state.plan.id).catch(() => {});
});
async function copyResults(): Promise<void> {
  if (!state.plan) return;
  try {
    await copyText(
      [
        state.plan.command,
        ...state.plan.targets.map(
          (t) =>
            `${t.endpoint} [${t.status}]\n${t.output?.stdout ?? ""}\n${t.output?.stderr ?? t.error}`,
        ),
      ].join("\n\n"),
    );
  } catch (error) {
    state.error = api.errorMessage(error);
  }
}
</script>
<template>
  <OperationDialog title="批量服务器操作" :busy="busy" wide @close="close"
    ><p class="text-[11px] leading-5 text-txt-3">
      最多选择 20 台已连接的 SSH
      服务器。先核对完整命令和目标列表，再批准本次执行。并发数为
      3；一台失败不会阻止其他服务器。
    </p>
    <template v-if="!plan"
      ><div class="batch-inputs">
        <div class="server-picker">
          <div
            class="flex items-center justify-between border-b border-line p-2"
          >
            <span class="text-[11px]">选择服务器（{{ selected.length }}）</span
            ><AppButton size="sm" @click="refresh">刷新</AppButton>
          </div>
          <p v-if="!sessions.length" class="p-4 text-[11px] text-txt-4">
            请先打开并连接 SSH 服务器。
          </p>
          <label v-for="s in sessions" :key="s.id"
            ><input
              v-model="selected"
              type="checkbox"
              :value="s.id"
              :disabled="
                busy || (!selected.includes(s.id) && selected.length >= 20)
              "
            /><span
              >{{ s.username }}@{{ s.host
              }}<small>端口 {{ s.port }}</small></span
            ></label
          >
        </div>
        <label class="command-input"
          >要执行的完整命令<textarea
            v-model="command"
            :disabled="busy"
            maxlength="8192"
            spellcheck="false"
            placeholder="例如：df -h&#10;每台服务器使用独立命令通道。"
          />
        </label>
      </div>
      <div>
        <AppButton
          variant="primary"
          :disabled="busy || !selected.length || !command.trim()"
          @click="prepare"
          >生成执行预览</AppButton
        >
      </div></template
    >
    <template v-else
      ><div class="batch-review">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong>{{
            plan.status === "pending"
              ? "待审批的执行计划"
              : plan.status === "running"
                ? "执行中"
                : plan.status === "expired"
                  ? "计划已过期"
                  : plan.status === "cancelled"
                    ? "已停止后续任务"
                    : "执行结束"
          }}</strong
          ><span>{{ count }} / {{ plan.targets.length }} 已处理</span>
        </div>
        <pre class="command-preview" dir="ltr">{{ plan.command }}</pre>
        <p v-if="plan.status === 'pending'" class="text-[11px] text-txt-3">
          计划有效期 5 分钟。每条命令最多运行 30 秒，输出最多约 16
          KB。修改操作可能立即生效，停止任务不会回滚。
        </p>
        <label
          v-if="plan.status === 'pending'"
          class="mt-3 flex items-center gap-2 text-[11px]"
          ><input
            v-model="reviewed"
            type="checkbox"
          />我已核对下方全部目标和完整命令</label
        >
        <div class="mt-3 flex flex-wrap gap-2">
          <AppButton
            v-if="plan.status === 'pending'"
            variant="danger"
            :disabled="busy || !reviewed"
            @click="execute"
            >批准在 {{ plan.targets.length }} 台服务器执行一次</AppButton
          ><AppButton v-if="running" @click="stop">停止尚未开始的任务</AppButton
          ><AppButton v-if="!running" :disabled="busy" @click="reset">{{
            plan.status === "pending" ? "取消计划并修改" : "新建任务"
          }}</AppButton
          ><AppButton :disabled="busy" @click="copyResults"
            >复制执行记录</AppButton
          >
        </div>
      </div>
      <div class="batch-results">
        <details v-for="row in plan.targets" :key="row.sessionId">
          <summary>
            <span>{{ row.endpoint }}</span
            ><span
              :class="
                row.status === 'failed'
                  ? 'text-danger'
                  : row.status === 'success'
                    ? 'text-success'
                    : 'text-txt-3'
              "
              >{{
                {
                  pending: "等待",
                  running: "执行中",
                  success: "成功",
                  failed: "失败",
                  cancelled: "已取消",
                }[row.status]
              }}</span
            >
          </summary>
          <p v-if="row.output" class="mt-2 text-[10px] text-txt-4">
            退出码 {{ row.output.exitCode ?? "未报告" }}
          </p>
          <pre v-if="row.output"
            >{{ row.output.stdout }}{{ row.output.stderr }}</pre>
          <p v-else class="p-2 text-[11px] text-txt-3">
            {{ row.error || "尚无输出" }}
          </p>
        </details>
      </div></template
    >
    <p v-if="error" role="alert" class="text-danger">
      {{ error }}
    </p></OperationDialog
  ><AppConfirmDialog
    :open="closing"
    title="停止并关闭批量任务？"
    description="未开始的任务将被取消。正在执行的命令可能仍在远端运行，已产生的修改不会回滚。"
    confirm-label="停止并关闭"
    @close="closing = false"
    @confirm="confirmClose"
  />
</template>
<style scoped>
.batch-inputs {
  display: grid;
  grid-template-columns: minmax(200px, 30%) minmax(0, 1fr);
  gap: 15px;
  min-height: 250px;
  flex: 1;
}
.server-picker {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  overflow: auto;
}
.server-picker > label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-line-soft);
  overflow-wrap: anywhere;
  font-size: 11px;
}
.server-picker input {
  margin-top: 3px;
  accent-color: var(--color-accent);
}
.server-picker small {
  display: block;
  margin-top: 3px;
  color: var(--color-txt-4);
}
.command-input {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 11px;
}
.command-input textarea {
  flex: 1;
  min-height: 200px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: #0003;
  padding: 12px;
  outline: none;
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
  line-height: 1.8;
}
.batch-review {
  padding: 13px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 12px;
}
.command-preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 200px;
  overflow: auto;
  padding: 12px;
  margin: 10px 0;
  background: #0004;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.7;
}
.batch-results {
  flex: 1;
  overflow: auto;
  min-height: 100px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
}
.batch-results details {
  border-bottom: 1px solid var(--color-line-soft);
  padding: 11px;
}
.batch-results summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.batch-results pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 11px;
  max-height: 250px;
  overflow: auto;
  background: #0003;
  margin-top: 9px;
  padding: 10px;
}
</style>
