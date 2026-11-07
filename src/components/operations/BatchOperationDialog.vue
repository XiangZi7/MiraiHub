<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  toRefs,
  watch,
} from 'vue'
import { useIntervalFn } from '@vueuse/core'
import * as ssh from '@/api/ssh'
import * as api from '@/api/operations'
import type { SshSessionInfo } from '@/types/ssh'
import OperationDialog from './OperationDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import { copyText } from '@/utils/clipboard'
import AppIcon from '@/components/ui/AppIcon.vue'
import { requestAgentContext } from '@/composables/useAgentContextBus'
import { toast } from '@/composables/useToast'

const { t } = useI18n()
const props = defineProps<{ initialCommand?: string }>()
const emit = defineEmits<{ close: [] }>()
// 预览后只执行后端锁定的计划，编辑表单不会改变已审批内容。
const state = reactive({
  sessions: [] as SshSessionInfo[],
  selected: [] as string[],
  command: props.initialCommand ?? '',
  plan: null as api.BatchPlan | null,
  busy: false,
  polling: false,
  error: '',
  reviewed: false,
  closing: false,
})
const { sessions, selected, command, plan, busy, error, reviewed, closing } =
  toRefs(state)
const running = computed(() => state.plan?.status === 'running')
const count = computed(
  () =>
    state.plan?.targets.filter(t =>
      ['success', 'failed', 'cancelled'].includes(t.status)
    ).length ?? 0
)
async function refresh(): Promise<void> {
  try {
    state.sessions = await ssh.listSessions()
    state.selected = state.selected.filter(id =>
      state.sessions.some(s => s.id === id)
    )
  } catch (error) {
    state.error = api.errorMessage(error)
  }
}
onMounted(refresh)
/** 与原生复选框数组 v-model 一致：勾选追加到末尾，取消时移除。 */
function setSelected(id: string, checked: boolean): void {
  if (checked === state.selected.includes(id)) return
  state.selected = checked
    ? [...state.selected, id]
    : state.selected.filter(item => item !== id)
}
async function poll(): Promise<void> {
  if (
    !state.plan ||
    state.polling ||
    !['running', 'pending'].includes(state.plan.status)
  )
    return
  state.polling = true
  const id = state.plan.id
  try {
    const next = await api.getBatch(id)
    if (state.plan?.id === id) state.plan = next
  } catch (error) {
    state.error = api.errorMessage(error)
  } finally {
    state.polling = false
  }
}
// 只有计划待执行或执行中才需要轮询；结束或未生成计划时停掉定时器。
const { pause: stopPolling, resume: startPolling } = useIntervalFn(
  () => void poll(),
  800,
  { immediate: false }
)
watch(
  () => ['running', 'pending'].includes(state.plan?.status ?? ''),
  active => (active ? startPolling() : stopPolling()),
  { immediate: true }
)
async function prepare(): Promise<void> {
  if (state.busy || !state.selected.length || !state.command.trim()) return
  state.busy = true
  state.error = ''
  try {
    state.plan = await api.prepareBatch([...state.selected], state.command)
    state.reviewed = false
  } catch (error) {
    state.error = api.errorMessage(error)
  } finally {
    state.busy = false
  }
}
async function execute(): Promise<void> {
  if (
    !state.plan ||
    !state.reviewed ||
    state.busy ||
    state.plan.status !== 'pending'
  )
    return
  state.busy = true
  state.error = ''
  try {
    state.plan = await api.runBatch(state.plan.id)
  } catch (error) {
    state.error = t('执行状态未确认：{value0}。请刷新结果，不要重复执行。', {
      value0: api.errorMessage(error),
    })
    await poll()
  } finally {
    state.busy = false
  }
}
async function stop(): Promise<void> {
  if (!state.plan) return
  try {
    await api.cancelBatch(state.plan.id)
    await poll()
  } catch (error) {
    state.error = api.errorMessage(error)
  }
}
async function reset(): Promise<void> {
  if (state.plan)
    await api.forgetBatch(state.plan.id).catch(error => {
      state.error = api.errorMessage(error)
    })
  state.plan = null
  state.reviewed = false
}
function close(): void {
  if (running.value) {
    state.closing = true
    return
  }
  emit('close')
}
async function confirmClose(): Promise<void> {
  state.closing = false
  await stop()
  emit('close')
}
onBeforeUnmount(() => {
  if (state.plan) void api.forgetBatch(state.plan.id).catch(() => {})
})
// 把失败主机的命令、退出码与输出交给该主机（或当前活动）会话的 AI Agent 分析原因。
function analyzeFailure(row: api.BatchPlan['targets'][number]): void {
  if (!state.plan) return
  const content = [
    `host: ${row.endpoint}`,
    `command: ${state.plan.command}`,
    `exit code: ${row.output?.exitCode ?? 'unknown'}`,
    row.output?.stdout ? `stdout:\n${row.output.stdout}` : '',
    row.output?.stderr ? `stderr:\n${row.output.stderr}` : '',
    row.error ? `error: ${row.error}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 60000)
  const handled = requestAgentContext({
    sessionId: row.sessionId,
    intent: 'fix',
    name: t('批量执行失败-{value0}.txt', { value0: row.endpoint }),
    content,
  })
  if (handled) toast.success(t('已添加到 AI 助手，关闭此窗口即可查看'))
  else toast.error(t('没有可用的 AI 助手，请先连接终端'))
}
async function copyResults(): Promise<void> {
  if (!state.plan) return
  try {
    await copyText(
      [
        state.plan.command,
        ...state.plan.targets.map(
          t =>
            `${t.endpoint} [${t.status}]\n${t.output?.stdout ?? ''}\n${t.output?.stderr ?? t.error}`
        ),
      ].join('\n\n')
    )
  } catch (error) {
    state.error = api.errorMessage(error)
  }
}
</script>
<template>
  <OperationDialog
    :title="t('批量服务器操作')"
    :busy="busy"
    wide
    @close="close"
    ><p class="text-txt-3 text-[11px] leading-5">
      {{
        t(
          '最多选择 20 台已连接的 SSH 服务器。先核对完整命令和目标列表，再批准本次执行。并发数为 3；一台失败不会阻止其他服务器。'
        )
      }}
    </p>
    <template v-if="!plan"
      ><div class="batch-inputs">
        <div class="server-picker">
          <div
            class="border-line flex items-center justify-between border-b p-2"
          >
            <span class="text-[11px]">{{
              t('batch.selectServers', { count: selected.length })
            }}</span
            ><AppButton
              size="sm"
              @click="refresh"
            >
              {{ t('刷新') }}
            </AppButton>
          </div>
          <p
            v-if="!sessions.length"
            class="text-txt-4 p-4 text-[11px]"
          >
            {{ t('请先打开并连接 SSH 服务器。') }}
          </p>
          <AppCheckbox
            v-for="s in sessions"
            :key="s.id"
            :model-value="selected.includes(s.id)"
            :label="`${s.username}@${s.host}`"
            :description="`${t('端口')} ${s.port}`"
            :disabled="
              busy || (!selected.includes(s.id) && selected.length >= 20)
            "
            class="border-line-soft w-full border-b px-3 py-2.5 wrap-anywhere [&_span]:whitespace-normal"
            @update:model-value="setSelected(s.id, $event)"
          />
        </div>
        <label class="command-input">
          {{ t('要执行的完整命令') }}
          <textarea
            v-model="command"
            :disabled="busy"
            maxlength="8192"
            spellcheck="false"
            :placeholder="t('batch.placeholder')"
          />
        </label>
      </div>
      <div>
        <AppButton
          variant="primary"
          :disabled="busy || !selected.length || !command.trim()"
          @click="prepare"
        >
          {{ t('生成执行预览') }}
        </AppButton>
      </div></template
    >
    <template v-else
      ><div class="batch-review">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong>{{
            plan.status === 'pending'
              ? t('待审批的执行计划')
              : plan.status === 'running'
                ? t('执行中')
                : plan.status === 'expired'
                  ? t('计划已过期')
                  : plan.status === 'cancelled'
                    ? t('已停止后续任务')
                    : t('执行结束')
          }}</strong
          ><span>{{
            t('batch.processed', { count, total: plan.targets.length })
          }}</span>
        </div>
        <pre
          class="command-preview"
          dir="ltr"
          >{{ plan.command }}</pre>
        <p
          v-if="plan.status === 'pending'"
          class="text-txt-3 text-[11px]"
        >
          {{
            t(
              '计划有效期 5 分钟。每条命令最多运行 30 秒，输出最多约 16 KB。修改操作可能立即生效，停止任务不会回滚。'
            )
          }}
        </p>
        <AppCheckbox
          v-if="plan.status === 'pending'"
          v-model="reviewed"
          :label="t('我已核对下方全部目标和完整命令')"
          class="mt-3 w-full [&_span]:whitespace-normal"
        />
        <div class="mt-3 flex flex-wrap gap-2">
          <AppButton
            v-if="plan.status === 'pending'"
            variant="danger"
            :disabled="busy || !reviewed"
            @click="execute"
            >{{ t('batch.approve', { count: plan.targets.length }) }}</AppButton
          ><AppButton
            v-if="running"
            @click="stop"
          >
            {{ t('停止尚未开始的任务') }} </AppButton
          ><AppButton
            v-if="!running"
            :disabled="busy"
            @click="reset"
            >{{
              plan.status === 'pending' ? t('取消计划并修改') : t('新建任务')
            }}</AppButton
          ><AppButton
            :disabled="busy"
            @click="copyResults"
          >
            {{ t('复制执行记录') }}
          </AppButton>
        </div>
      </div>
      <div class="batch-results">
        <details
          v-for="row in plan.targets"
          :key="row.sessionId"
        >
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
                  pending: t('等待'),
                  running: t('执行中'),
                  success: t('成功'),
                  failed: t('失败'),
                  cancelled: t('已取消'),
                }[row.status]
              }}</span
            >
          </summary>
          <p
            v-if="row.output"
            class="text-txt-4 mt-2 text-[10px]"
          >
            {{
              t('batch.exitCode', { code: row.output.exitCode ?? t('未报告') })
            }}
          </p>
          <pre v-if="row.output"
            >{{ row.output.stdout }}{{ row.output.stderr }}</pre>
          <p
            v-else
            class="text-txt-3 p-2 text-[11px]"
          >
            {{ row.error || t('尚无输出') }}
          </p>
          <button
            v-if="row.status === 'failed'"
            type="button"
            class="text-accent hover:bg-hover mt-2 inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px]"
            @click="analyzeFailure(row)"
          >
            <AppIcon
              name="lucide:sparkles"
              :size="12"
            />{{ t('AI 分析失败原因') }}
          </button>
        </details>
      </div></template
    >
    <p
      v-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p></OperationDialog
  ><AppConfirmDialog
    :open="closing"
    :title="t('停止并关闭批量任务？')"
    :description="
      t(
        '未开始的任务将被取消。正在执行的命令可能仍在远端运行，已产生的修改不会回滚。'
      )
    "
    :confirm-label="t('停止并关闭')"
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
