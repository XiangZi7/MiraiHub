<script setup lang="ts">
import { computed, onMounted, reactive, toRefs, watch } from 'vue'
import { open, save } from '@tauri-apps/plugin-dialog'
import * as connections from '@/api/connections'
import * as api from '@/api/operations'
import {
  createConnectionBackup,
  parseConnectionBackup,
  restorePlan,
  type ConnectionBackup,
  type ConnectionSnapshot,
  type RestoreMode,
} from '@/utils/connection-backup'
import { useSettings } from '@/composables/useSettings'
import { IS_TAURI } from '@/utils/window'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const { settings } = useSettings()
// 导入必须先验证和预览；密码仅保存在当前页面内存。
const state = reactive({
  snapshot: null as ConnectionSnapshot | null,
  archive: null as ConnectionBackup | null,
  busy: false,
  error: '',
  message: '',
  password: '',
  includeCredentials: false,
  path: '',
  restorePassword: '',
  mode: 'skip' as RestoreMode,
  restoreCredentials: false,
  startupCommands: false,
  reviewed: false,
})
const {
  snapshot,
  archive,
  busy,
  error,
  message,
  password,
  includeCredentials,
  path,
  restorePassword,
  mode,
  restoreCredentials,
  startupCommands,
  reviewed,
} = toRefs(state)
const plan = computed(() =>
  state.snapshot && state.archive
    ? restorePlan(
        state.snapshot,
        state.archive,
        {
          mode: state.mode,
          credentials: state.restoreCredentials && settings.rememberPasswords,
          startupCommands: state.startupCommands,
        },
        () => `conn-${crypto.randomUUID()}`
      )
    : null
)
const counts = computed(() => ({
  add: plan.value?.changes.filter(c => c.action === 'add').length ?? 0,
  update: plan.value?.changes.filter(c => c.action === 'update').length ?? 0,
  skip: plan.value?.changes.filter(c => c.action === 'skip').length ?? 0,
}))
watch(
  () => settings.rememberPasswords,
  value => {
    if (!value) {
      state.restoreCredentials = false
      state.reviewed = false
    }
  }
)
onMounted(async () => {
  state.snapshot = await connections.backupSnapshot()
})
async function exportBackup(): Promise<void> {
  if (state.busy) return
  state.error = ''
  state.message = ''
  if (state.includeCredentials && !state.password) {
    state.error = '包含密码或启动命令时必须设置备份密码'
    return
  }
  if (state.password && new TextEncoder().encode(state.password).length < 10) {
    state.error = '备份密码至少需要 10 字节'
    return
  }
  state.busy = true
  try {
    const payload = createConnectionBackup(
      await connections.backupSnapshot(),
      state.includeCredentials
    )
    const path = await save({
      title: '保存连接备份',
      defaultPath: `MiraiHub-connections-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'MiraiHub 连接备份', extensions: ['json'] }],
    })
    if (path) {
      await api.writeBackup(path, payload, state.password)
      state.message = `备份已保存：${path}`
      state.password = ''
    }
  } catch (error) {
    state.error = api.errorMessage(error)
  } finally {
    state.busy = false
  }
}
async function choose(): Promise<void> {
  const path = await open({
    title: '选择连接备份',
    multiple: false,
    directory: false,
    filters: [{ name: 'MiraiHub 连接备份', extensions: ['json'] }],
  })
  if (typeof path === 'string') {
    state.path = path
    state.archive = null
    state.reviewed = false
    state.message = ''
    state.error = ''
  }
}
async function preview(): Promise<void> {
  if (!state.path || state.busy) return
  state.busy = true
  state.error = ''
  state.message = ''
  state.archive = null
  state.reviewed = false
  try {
    const archive = parseConnectionBackup(
      await api.readBackup(state.path, state.restorePassword)
    )
    state.snapshot = await connections.backupSnapshot()
    state.archive = archive
    state.restorePassword = ''
    state.restoreCredentials = false
    state.startupCommands = false
  } catch (error) {
    state.error = api.errorMessage(error)
  } finally {
    state.busy = false
  }
}
function apply(): void {
  if (!state.reviewed || !state.snapshot || !plan.value || state.busy) return
  state.error = ''
  try {
    connections.applyBackupSnapshot(state.snapshot, plan.value.next)
    state.message = `恢复完成：新增 ${counts.value.add}，更新 ${counts.value.update}，跳过 ${counts.value.skip}。未自动连接任何服务器。`
    state.snapshot = plan.value.next
    state.archive = null
    state.reviewed = false
  } catch (error) {
    state.error = api.errorMessage(error)
  }
}
</script>
<template>
  <section class="backup-settings">
    <h2>
      <AppIcon
        name="lucide:archive-restore"
        :size="20"
      />连接备份与恢复
    </h2>
    <p class="muted">
      备份连接、分组和标签。AI 配置、私钥文件、查询历史不包含在内。
    </p>
    <p
      v-if="!IS_TAURI"
      class="muted"
    >
      请在桌面程序中选择文件进行备份或恢复。
    </p>
    <div class="backup-card">
      <h3>
        导出备份
        <span class="muted"
          >{{ snapshot?.connections.length ?? 0 }} 个连接</span
        >
      </h3>
      <label class="check"
        ><input
          v-model="includeCredentials"
          type="checkbox"
          :disabled="busy"
        />包含连接密码、私钥口令和 SSH 启动命令（需要加密）</label
      ><label class="backup-field"
        >备份密码<input
          v-model="password"
          type="password"
          autocomplete="new-password"
          :disabled="busy"
          placeholder="可选；设置后使用密码加密，恢复时需要此密码"
      /></label>
      <p class="muted">
        默认导出不含密码和启动命令。加密备份使用独立密码，可在其他电脑恢复。
      </p>
      <AppButton
        :disabled="busy || !IS_TAURI"
        variant="primary"
        @click="exportBackup"
        >导出连接备份</AppButton
      >
    </div>
    <div class="backup-card">
      <h3>恢复备份</h3>
      <div class="flex items-center gap-2">
        <AppButton
          :disabled="busy || !IS_TAURI"
          @click="choose"
          >选择备份文件</AppButton
        ><span
          class="text-txt-3 min-w-0 truncate text-[10px]"
          :title="path"
          >{{ path || '尚未选择' }}</span
        >
      </div>
      <label class="backup-field"
        >解密密码<input
          v-model="restorePassword"
          type="password"
          autocomplete="off"
          :disabled="busy"
          placeholder="未加密备份留空" /></label
      ><AppButton
        :disabled="busy || !path || !IS_TAURI"
        @click="preview"
        >{{ busy ? '处理中…' : '读取并预览恢复内容' }}</AppButton
      >
      <template v-if="archive && plan"
        ><label class="backup-field"
          >同 ID 连接的处理方式<select
            v-model="mode"
            @change="reviewed = false"
          >
            <option value="skip">跳过已有连接（默认）</option>
            <option value="update">更新同 ID 连接，保留其他连接</option>
            <option value="copy">全部作为新连接导入</option>
          </select></label
        ><label class="check"
          ><input
            v-model="restoreCredentials"
            type="checkbox"
            :disabled="!settings.rememberPasswords"
            @change="reviewed = false"
          />恢复备份中的连接密码和私钥口令</label
        ><label class="check"
          ><input
            v-model="startupCommands"
            type="checkbox"
            @change="reviewed = false"
          />恢复 SSH 启动命令（下次连接时会自动执行，请先核对备份来源）</label
        >
        <details
          v-if="startupCommands"
          class="startup-review"
          open
        >
          <summary>核对备份中的 SSH 启动命令</summary>
          <div
            v-for="connection in archive.connections.filter(
              c => c.kind === 'ssh'
            )"
            :key="connection.id"
          >
            <strong
              >{{ connection.name }} · {{ connection.username }}@{{
                connection.host
              }}:{{ connection.port }}</strong
            >
            <pre>{{
              'startupCommand' in connection.settings
                ? connection.settings.startupCommand || '（无启动命令）'
                : ''
            }}</pre>
          </div>
        </details>
        <div class="restore-summary">
          新增 {{ counts.add }} · 更新 {{ counts.update }} · 跳过
          {{ counts.skip }}
        </div>
        <div class="restore-list">
          <div
            v-for="(item, index) in plan.changes"
            :key="index"
          >
            <span>{{
              { add: '新增', update: '更新', skip: '跳过' }[item.action]
            }}</span
            ><span
              >{{ item.name
              }}<small>{{ item.kind }} · {{ item.host }}</small></span
            >
          </div>
        </div>
        <label class="check"
          ><input
            v-model="reviewed"
            type="checkbox"
          />已核对连接目标和恢复方式</label
        ><AppButton
          variant="primary"
          :disabled="!reviewed || busy"
          @click="apply"
          >确认恢复 {{ counts.add + counts.update }} 个连接</AppButton
        >
        <p class="muted">
          仅恢复配置，不会自动连接服务器或执行备份中的命令。
        </p></template
      >
    </div>
    <p
      v-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="text-success"
    >
      {{ message }}
    </p>
  </section>
</template>
<style scoped>
.backup-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px;
  font-size: 12px;
}
.backup-settings h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}
.backup-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  border: 1px solid var(--color-line);
  padding: 15px;
  border-radius: 9px;
}
.backup-card h3 {
  font-size: 13px;
  font-weight: 500;
}
.muted {
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--color-txt-3);
}
.backup-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.backup-field input,
.backup-field select {
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-txt);
  font-size: 11px;
  min-width: 0;
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 11px;
  line-height: 1.6;
}
.check input {
  margin-top: 3px;
  accent-color: var(--color-accent);
}
.startup-review {
  font-size: 11px;
  overflow-wrap: anywhere;
}
.startup-review pre {
  white-space: pre-wrap;
  padding: 8px;
  border: 1px solid var(--color-line);
  margin: 8px 0;
  max-height: 130px;
  overflow: auto;
}
.restore-summary {
  font-size: 11px;
  color: var(--color-accent);
}
.restore-list {
  max-height: 230px;
  overflow: auto;
  border: 1px solid var(--color-line);
  border-radius: 6px;
}
.restore-list > div {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 11px;
}
.restore-list small {
  display: block;
  color: var(--color-txt-4);
  margin-top: 3px;
  overflow-wrap: anywhere;
}
</style>
