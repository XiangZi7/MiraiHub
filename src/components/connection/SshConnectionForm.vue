<script setup lang="ts">
import { computed, reactive, shallowRef, useId } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import * as ssh from '@/api/ssh'
import { useConnections } from '@/composables/useConnections'
import type { SshAuthMethod, SshConfig } from '@/types/ssh'
import ConnectionTextField from './ConnectionTextField.vue'

type SectionId = 'general' | 'advanced' | 'ssh-key' | 'proxy'

const emit = defineEmits<{
  close: []
}>()

const { create } = useConnections()

const sections: Array<{ id: SectionId, label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'ssh-key', label: 'SSH Key' },
  { id: 'proxy', label: 'Proxy' },
]

const activeSection = shallowRef<SectionId>('general')
const feedback = shallowRef('')
// 反馈是成功还是失败，决定文案配色
const feedbackTone = shallowRef<'info' | 'error'>('info')
// 测试连接进行中，避免重复点击开出一堆连接
const testing = shallowRef(false)
// 保存中，避免重复提交存出两条一样的连接
const saving = shallowRef(false)
const savePassword = shallowRef(false)
const form = reactive({
  name: '',
  group: '',
  host: '',
  port: '22',
  username: '',
  authentication: 'password',
  password: '',
  description: '',
  timeout: '30',
  keepAlive: '60',
  terminalType: 'xterm-256color',
  startupCommand: '',
  privateKey: '',
  passphrase: '',
  proxyType: 'none',
  proxyHost: '',
  proxyPort: '',
  proxyUsername: '',
  proxyPassword: '',
})

const authId = useId()
const terminalId = useId()
const proxyTypeId = useId()
const descriptionId = useId()

const isReady = computed<boolean>(() => (
  form.name.trim().length > 0
  && form.host.trim().length > 0
  && form.username.trim().length > 0
))

/**
 * 表单的认证方式 → API 的 tag 化联合。
 *
 * `keepSecret` 为 false 时不带凭据 —— 保存到本地时用它来实现"不保存密码"，
 * 而测试连接必须带上，否则测的就不是用户填的那套凭据了。
 */
function buildAuth(keepSecret = true): SshAuthMethod {
  switch (form.authentication) {
    case 'private-key':
      return {
        type: 'privateKey',
        path: form.privateKey.trim(),
        // 空口令要传 undefined 而不是空串：后端据此判断私钥是否需要解密
        passphrase: keepSecret ? form.passphrase || undefined : undefined,
      }
    case 'agent':
      return { type: 'agent' }
    default:
      return { type: 'password', password: keepSecret ? form.password : '' }
  }
}

/** 收集表单为连接配置。端口等数值字段在表单里是字符串，这里统一转换 */
function buildConfig(): SshConfig {
  return {
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    auth: buildAuth(),
    timeoutSecs: Number(form.timeout) || 20,
    keepaliveSecs: Number(form.keepAlive) || 30,
  }
}

function setFeedback(message: string, tone: 'info' | 'error' = 'info'): void {
  feedback.value = message
  feedbackTone.value = tone
}

/** 校验必填项，不通过则跳回 General 并提示 */
function validate(): boolean {
  if (!isReady.value) {
    activeSection.value = 'general'
    setFeedback('请先填写连接名称、主机和用户名', 'error')
    return false
  }

  if (form.authentication === 'private-key' && !form.privateKey.trim()) {
    activeSection.value = 'ssh-key'
    setFeedback('请先选择私钥文件', 'error')
    return false
  }

  return true
}

/**
 * 测试连接：真连一次再立刻断开。
 * 只有这样才能验出密码对不对、密钥是否被接受 —— 光校验字段格式说明不了任何问题。
 */
async function testConnection(): Promise<void> {
  if (!validate() || testing.value)
    return

  testing.value = true
  setFeedback('正在连接…')

  try {
    const sessionId = await ssh.connect(buildConfig())
    await ssh.disconnect(sessionId)
    setFeedback('连接成功')
  }
  catch (err) {
    setFeedback(ssh.errorMessage(err), 'error')
  }
  finally {
    testing.value = false
  }
}

/**
 * 保存连接。
 *
 * 密码 / 口令一并存进本地存储：这是本地桌面应用，数据不出机器。
 * 用户没勾"保存密码"就不写，下次连接时再问 ——
 * 那时表单里的 auth 会是空密码，后端会认证失败并明确提示。
 */
async function saveConnection(): Promise<void> {
  if (!validate() || saving.value)
    return

  saving.value = true

  try {
    await create({
      name: form.name.trim(),
      kind: 'ssh',
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      group: form.group.trim(),
      description: form.description.trim(),
      settings: {
        auth: buildAuth(savePassword.value),
        timeoutSecs: Number(form.timeout) || 20,
        keepaliveSecs: Number(form.keepAlive) || 30,
        terminalType: form.terminalType,
        startupCommand: form.startupCommand.trim(),
      },
    })

    emit('close')
  }
  catch (err) {
    setFeedback(`保存失败：${ssh.errorMessage(err)}`, 'error')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="saveConnection">
    <div class="connection-tabs" role="tablist" aria-label="SSH connection settings">
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        role="tab"
        :aria-selected="activeSection === section.id"
        :class="['connection-tab', activeSection === section.id && 'connection-tab-active']"
        @click="activeSection = section.id"
      >
        {{ section.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
      <div v-if="activeSection === 'general'" class="grid gap-3.5">
        <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <ConnectionTextField
            v-model="form.name"
            label="Connection Name"
            placeholder="e.g. Production Server"
            required
            autofocus
          />
          <ConnectionTextField
            v-model="form.group"
            label="Group"
            placeholder="e.g. Production"
          />
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
          <ConnectionTextField
            v-model="form.host"
            label="Host"
            placeholder="192.168.1.100 or server.example.com"
            inputmode="url"
            required
          />
          <ConnectionTextField
            v-model="form.port"
            label="Port"
            placeholder="22"
            inputmode="numeric"
            required
          />
        </div>

        <ConnectionTextField
          v-model="form.username"
          label="Username"
          placeholder="e.g. ubuntu"
          autocomplete="username"
          required
        />

        <div class="space-y-1.5">
          <label :for="authId" class="connection-label">Authentication Method</label>
          <div class="connection-select-wrap">
            <select :id="authId" v-model="form.authentication" class="connection-select">
              <option value="password">Password</option>
              <option value="private-key">Private Key</option>
              <option value="agent">SSH Agent</option>
            </select>
            <AppIcon name="lucide:chevron-down" :size="14" class="pointer-events-none text-txt-4" />
          </div>
        </div>

        <template v-if="form.authentication === 'password'">
          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <ConnectionTextField
              v-model="form.password"
              label="Password"
              type="password"
              placeholder="Enter password"
              autocomplete="current-password"
            />
            <label class="connection-check mb-2">
              <input v-model="savePassword" type="checkbox">
              <span>Save password</span>
            </label>
          </div>
        </template>

        <div v-else-if="form.authentication === 'private-key'" class="space-y-2">
          <ConnectionTextField
            v-model="form.privateKey"
            label="Private Key"
            placeholder="Select a private key in the SSH Key tab"
          />
          <button type="button" class="text-left text-[11px] text-violet hover:text-txt" @click="activeSection = 'ssh-key'">
            Configure private key →
          </button>
        </div>

        <div class="space-y-1.5">
          <label :for="descriptionId" class="connection-label">Description (Optional)</label>
          <textarea
            :id="descriptionId"
            v-model="form.description"
            class="connection-textarea"
            rows="2"
            placeholder="Add a description for this connection…"
          />
        </div>
      </div>

      <div v-else-if="activeSection === 'advanced'" class="grid gap-3.5">
        <div class="connection-section-copy">
          Fine-tune connection stability and terminal startup behavior.
        </div>
        <div class="grid grid-cols-2 gap-3">
          <ConnectionTextField v-model="form.timeout" label="Connection Timeout (s)" inputmode="numeric" />
          <ConnectionTextField v-model="form.keepAlive" label="Keep Alive (s)" inputmode="numeric" />
        </div>
        <div class="space-y-1.5">
          <label :for="terminalId" class="connection-label">Terminal Type</label>
          <div class="connection-select-wrap">
            <select :id="terminalId" v-model="form.terminalType" class="connection-select">
              <option value="xterm-256color">xterm-256color</option>
              <option value="xterm">xterm</option>
              <option value="vt100">vt100</option>
            </select>
            <AppIcon name="lucide:chevron-down" :size="14" class="pointer-events-none text-txt-4" />
          </div>
        </div>
        <ConnectionTextField
          v-model="form.startupCommand"
          label="Startup Command"
          placeholder="e.g. tmux attach || tmux"
        />
      </div>

      <div v-else-if="activeSection === 'ssh-key'" class="grid gap-3.5">
        <div class="connection-section-copy">
          Choose the private key used when the authentication method is set to Private Key.
        </div>
        <ConnectionTextField
          v-model="form.privateKey"
          label="Private Key Path"
          placeholder="C:\Users\you\.ssh\id_ed25519"
        />
        <ConnectionTextField
          v-model="form.passphrase"
          label="Key Passphrase"
          type="password"
          placeholder="Optional passphrase"
          autocomplete="off"
        />
      </div>

      <div v-else class="grid gap-3.5">
        <div class="connection-section-copy">
          Route this SSH connection through a SOCKS or HTTP proxy.
        </div>
        <div class="space-y-1.5">
          <label :for="proxyTypeId" class="connection-label">Proxy Type</label>
          <div class="connection-select-wrap">
            <select :id="proxyTypeId" v-model="form.proxyType" class="connection-select">
              <option value="none">No Proxy</option>
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP</option>
            </select>
            <AppIcon name="lucide:chevron-down" :size="14" class="pointer-events-none text-txt-4" />
          </div>
        </div>
        <template v-if="form.proxyType !== 'none'">
          <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
            <ConnectionTextField v-model="form.proxyHost" label="Proxy Host" placeholder="127.0.0.1" />
            <ConnectionTextField v-model="form.proxyPort" label="Port" placeholder="1080" inputmode="numeric" />
          </div>
          <ConnectionTextField v-model="form.proxyUsername" label="Proxy Username" placeholder="Optional" />
          <ConnectionTextField v-model="form.proxyPassword" label="Proxy Password" type="password" placeholder="Optional" />
        </template>
      </div>
    </div>

    <footer class="connection-footer">
      <button type="button" class="btn" :disabled="testing" @click="testConnection">
        {{ testing ? 'Testing…' : 'Test Connection' }}
      </button>
      <p
        :class="['min-w-0 flex-1 truncate text-[11px]', feedbackTone === 'error' ? 'text-danger' : 'text-txt-3']"
        :title="feedback"
        aria-live="polite"
      >
        {{ feedback }}
      </p>
      <button type="button" class="btn" @click="emit('close')">
        Cancel
      </button>
      <button type="submit" class="connection-primary" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.connection-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  align-items: stretch;
  gap: 2px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 18px;
}

.connection-tab {
  position: relative;
  min-width: 74px;
  cursor: pointer;
  padding: 0 12px;
  color: var(--color-txt-3);
  font-size: 11.5px;
  transition: color 150ms ease, background-color 150ms ease;
}

.connection-tab:hover,
.connection-tab:focus-visible {
  color: var(--color-txt-2);
  outline: none;
}

.connection-tab-active {
  color: var(--color-txt);
}

.connection-tab-active::after {
  position: absolute;
  right: 10px;
  bottom: -1px;
  left: 10px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(90deg, var(--color-indigo), var(--color-violet));
  content: '';
  box-shadow: 0 0 10px color-mix(in oklch, var(--color-violet) 45%, transparent);
}

.connection-label {
  display: block;
  color: var(--color-txt-2);
  font-size: 11px;
  font-weight: 500;
}

.connection-select-wrap {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  padding-right: 10px;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.connection-select-wrap:focus-within {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.connection-select {
  min-width: 0;
  flex: 1;
  appearance: none;
  align-self: stretch;
  border: 0;
  background: transparent;
  padding: 0 10px;
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
}

.connection-select option {
  background: #1a1b22;
}

.connection-textarea {
  width: 100%;
  resize: none;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  padding: 8px 10px;
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.connection-textarea::placeholder {
  color: var(--color-txt-4);
}

.connection-textarea:focus {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.connection-check {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  color: var(--color-txt-3);
  font-size: 11px;
}

.connection-check input {
  width: 14px;
  height: 14px;
  accent-color: var(--color-violet);
}

.connection-section-copy {
  border: 1px solid var(--color-line-soft);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-card) 62%, transparent);
  padding: 10px 12px;
  color: var(--color-txt-3);
  font-size: 11.5px;
}

.connection-footer {
  display: flex;
  height: 58px;
  flex-shrink: 0;
  align-items: center;
  gap: 9px;
  border-top: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 34%, transparent);
  padding: 0 18px;
}

.connection-primary {
  display: inline-flex;
  height: 30px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in oklch, var(--color-violet) 65%, white 8%);
  border-radius: 7px;
  background: linear-gradient(135deg, var(--color-indigo), var(--color-violet));
  padding: 0 15px;
  color: white;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 5px 18px color-mix(in oklch, var(--color-violet) 24%, transparent);
  transition: filter 150ms ease, border-color 150ms ease;
}

.connection-primary:hover,
.connection-primary:focus-visible {
  border-color: color-mix(in oklch, var(--color-violet) 55%, white 28%);
  filter: brightness(1.1);
  outline: none;
}
</style>
