<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onMounted, reactive, toRefs } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import * as ssh from '@/api/ssh'
import * as api from '@/api/operations'
import type { SshSessionInfo, SshTunnelKind } from '@/types/ssh'
import OperationDialog from './OperationDialog.vue'
import TunnelCreateForm from './TunnelCreateForm.vue'
import TunnelList from './TunnelList.vue'
import { copyText } from '@/utils/clipboard'

const { t } = useI18n()
const props = defineProps<{ preferredSessionId?: string }>()
const emit = defineEmits<{ close: [] }>()
// 响应式状态
const state = reactive({
  // 当前可用的 SSH 会话
  sessions: [] as SshSessionInfo[],
  // 已建立的隧道记录
  tunnels: [] as api.Tunnel[],
  // 选中的 SSH 会话
  sessionId: props.preferredSessionId ?? '',
  // 隧道类型：本地 -L / 远程 -R / 动态 -D
  kind: 'local' as SshTunnelKind,
  // 远程转发时服务器上的监听地址，仅允许服务器回环地址
  remoteBindHost: '127.0.0.1',
  // 监听端口（本机或服务器），输入框清空时保留空字符串
  bindPort: 0 as number | string,
  // 转发目标地址：本地转发由 SSH 服务器访问，远程转发由本机访问
  targetHost: '127.0.0.1',
  // 目标服务端口
  targetPort: 3306 as number | string,
  // 建立隧道期间锁定配置
  busy: false,
  // 正在刷新连接与隧道
  loading: false,
  // 操作失败时的提示
  error: '',
})
const {
  sessions,
  tunnels,
  sessionId,
  kind,
  remoteBindHost,
  bindPort,
  targetHost,
  targetPort,
  busy,
  loading,
  error,
} = toRefs(state)
// 表单是否可提交：动态转发只需监听端口，其余类型还需要目标地址
const valid = computed(
  () =>
    state.sessions.some(s => s.id === state.sessionId) &&
    state.bindPort !== '' &&
    Number.isInteger(Number(state.bindPort)) &&
    Number(state.bindPort) >= 0 &&
    Number(state.bindPort) <= 65535 &&
    (state.kind === 'dynamic' ||
      (Number.isInteger(Number(state.targetPort)) &&
        Number(state.targetPort) > 0 &&
        Number(state.targetPort) <= 65535 &&
        Boolean(state.targetHost.trim())))
)
// 刷新已连接的会话与隧道列表
async function refresh(): Promise<void> {
  if (state.loading) return
  state.loading = true
  try {
    const [sessions, tunnels] = await Promise.all([
      ssh.listSessions(),
      api.listTunnels(),
    ])
    state.sessions = sessions
    state.tunnels = tunnels
    if (!state.sessionId && sessions[0]) state.sessionId = sessions[0].id
  } catch (error) {
    state.error = api.errorMessage(error)
  } finally {
    state.loading = false
  }
}
onMounted(refresh)
useIntervalFn(() => void refresh(), 2000)
// 按当前类型建立隧道，动态转发不发送目标地址
async function start(): Promise<void> {
  if (!valid.value || state.busy) return
  state.busy = true
  state.error = ''
  const dynamic = state.kind === 'dynamic'
  try {
    await api.startTunnel({
      sessionId: state.sessionId,
      kind: state.kind,
      bindHost: state.kind === 'remote' ? state.remoteBindHost : '127.0.0.1',
      bindPort: Number(state.bindPort),
      targetHost: dynamic ? '' : state.targetHost.trim(),
      targetPort: dynamic ? 0 : Number(state.targetPort),
    })
    await refresh()
  } catch (error) {
    state.error = api.errorMessage(error)
  } finally {
    state.busy = false
  }
}
// 运行中的隧道停止，已停止的记录移除
async function action(row: api.Tunnel): Promise<void> {
  state.error = ''
  try {
    if (row.status === 'running') await api.stopTunnel(row.id)
    else await api.removeTunnel(row.id)
    await refresh()
  } catch (error) {
    state.error = api.errorMessage(error)
  }
}
// 复制监听地址，动态转发复制为 socks5:// 代理地址
async function copy(row: api.Tunnel): Promise<void> {
  const host = row.bindHost.includes(':') ? `[${row.bindHost}]` : row.bindHost
  const address = `${host}:${row.bindPort}`
  try {
    await copyText(row.kind === 'dynamic' ? `socks5://${address}` : address)
  } catch (error) {
    state.error = api.errorMessage(error)
  }
}
</script>

<template>
  <OperationDialog
    :title="t('SSH 隧道 / 端口转发')"
    :busy="busy"
    @close="emit('close')"
  >
    <div class="tunnel-manager">
      <p class="tunnel-intro">
        {{
          t(
            '通过已连接的 SSH 服务器转发端口：本地转发、远程转发或动态 SOCKS5 代理。'
          )
        }}
      </p>
      <TunnelCreateForm
        v-model:session-id="sessionId"
        v-model:kind="kind"
        v-model:remote-bind-host="remoteBindHost"
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
      <p
        v-if="error"
        role="alert"
        class="tunnel-error"
      >
        {{ error }}
      </p>
      <TunnelList
        :tunnels="tunnels"
        @copy="copy"
        @action="action"
      />
      <p class="tunnel-footer">
        {{
          t(
            '关闭此窗口后隧道继续运行，断开 SSH 或退出应用后停止。每条隧道最多 32 个并发连接。'
          )
        }}
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
