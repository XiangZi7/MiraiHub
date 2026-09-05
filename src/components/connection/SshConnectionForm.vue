<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, useId, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import * as connectionsStore from '@/api/connections'
import * as privateKeysStore from '@/api/private-keys'
import * as ssh from '@/api/ssh'
import { useConnections } from '@/composables/useConnections'
import { usePrivateKeys } from '@/composables/usePrivateKeys'
import { settingNumber, useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import type { ConnectionTagColor, NewConnection } from '@/types/connection'
import { isSshConnection } from '@/types/connection'
import type { SshAuthMethod, SshConfig } from '@/types/ssh'
import ConnectionTagEditor from './ConnectionTagEditor.vue'
import PrivateKeySelector from './PrivateKeySelector.vue'
import StartupCommandPresetField from './StartupCommandPresetField.vue'

const { settings } = useSettings()

type SectionId = 'general' | 'advanced' | 'ssh-key' | 'proxy'

const props = withDefaults(
  defineProps<{
    connectionId?: string
  }>(),
  {
    connectionId: '',
  }
)

const emit = defineEmits<{
  close: []
}>()

const { create, update, tags: sharedTags } = useConnections()
const {
  keys: privateKeys,
  defaultPath: defaultPrivateKey,
  loading: loadingPrivateKeys,
  rememberImported,
  setDefault: setDefaultPrivateKey,
  refreshLocalKeys,
} = usePrivateKeys()

const sections: Array<{ id: SectionId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'ssh-key', label: 'SSH Key' },
  { id: 'proxy', label: 'Proxy' },
]

const authenticationOptions = [
  { value: 'password', label: 'Password' },
  { value: 'private-key', label: 'Private Key' },
  { value: 'agent', label: 'SSH Agent' },
] as const

const terminalOptions = [
  { value: 'xterm-256color', label: 'xterm-256color' },
  { value: 'xterm', label: 'xterm' },
  { value: 'vt100', label: 'vt100' },
] as const

const proxyOptions = [
  { value: 'none', label: 'No Proxy' },
  { value: 'socks5', label: 'SOCKS5' },
  { value: 'http', label: 'HTTP' },
] as const

const activeSection = shallowRef<SectionId>('general')
// 测试连接进行中，避免重复点击开出一堆连接
const testing = shallowRef(false)
// 保存中，避免重复提交存出两条一样的连接
const saving = shallowRef(false)
const browsingPrivateKeys = shallowRef(false)
const loadingConnection = shallowRef(Boolean(props.connectionId))
const savePassword = shallowRef<boolean>(settings.rememberPasswords)
const form = reactive({
  name: '',
  group: '',
  host: '',
  port: '22',
  username: 'root',
  tags: '',
  tagColor: 'green' as ConnectionTagColor,
  authentication: 'private-key',
  password: '',
  description: '',
  timeout: String(settingNumber('sshTimeout', 30)),
  keepAlive: settings.keepConnectionAlive ? '60' : '0',
  terminalType: 'xterm-256color',
  startupCommand: '',
  privateKey: defaultPrivateKey.value,
  passphrase: '',
  proxyType: 'none',
  proxyHost: '',
  proxyPort: '',
  proxyUsername: '',
  proxyPassword: '',
})

const descriptionId = useId()

watch(defaultPrivateKey, path => {
  // 初次扫描 ~/.ssh 找到默认项时自动带入；不覆盖用户已经手动选好的路径。
  if (!form.privateKey.trim()) form.privateKey = path
})

onMounted(async () => {
  await Promise.all([refreshLocalKeys(), loadConnection()])
  if (!form.privateKey.trim()) form.privateKey = defaultPrivateKey.value
})

async function loadConnection(): Promise<void> {
  if (!props.connectionId) return

  try {
    const connection = await connectionsStore.get(props.connectionId)
    if (!connection || !isSshConnection(connection)) {
      toast.error('找不到要编辑的 SSH 连接')
      return
    }

    const settings = connection.settings
    Object.assign(form, {
      name: connection.name,
      group: connection.group,
      host: connection.host,
      port: String(connection.port),
      username: connection.username,
      tags: connection.tags.join(', '),
      tagColor: connection.tagColor,
      description: connection.description,
      timeout: String(settings.timeoutSecs),
      keepAlive: String(settings.keepaliveSecs),
      terminalType: settings.terminalType,
      startupCommand: settings.startupCommand,
      authentication:
        settings.auth.type === 'privateKey'
          ? 'private-key'
          : settings.auth.type,
      password: settings.auth.type === 'password' ? settings.auth.password : '',
      privateKey:
        settings.auth.type === 'privateKey'
          ? settings.auth.path
          : defaultPrivateKey.value,
      passphrase:
        settings.auth.type === 'privateKey'
          ? (settings.auth.passphrase ?? '')
          : '',
    })
    savePassword.value =
      settings.auth.type === 'password' && Boolean(settings.auth.password)
  } catch (error) {
    toast.error({
      title: '读取 SSH 连接失败',
      description: ssh.errorMessage(error),
    })
  } finally {
    loadingConnection.value = false
  }
}

const isReady = computed<boolean>(
  () =>
    form.name.trim().length > 0 &&
    form.host.trim().length > 0 &&
    form.username.trim().length > 0
)

function numericSettings(): {
  port: number
  timeoutSecs: number
  keepaliveSecs: number
} {
  return {
    port: Number(form.port),
    timeoutSecs: Number(form.timeout),
    keepaliveSecs: Number(form.keepAlive),
  }
}

function normalizedTags(): string[] {
  return [
    ...new Set(
      form.tags
        .split(/[,，]/)
        .map(tag => tag.trim())
        .filter(Boolean)
    ),
  ]
}

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
  const { port, timeoutSecs, keepaliveSecs } = numericSettings()

  return {
    host: form.host.trim(),
    port,
    username: form.username.trim(),
    auth: buildAuth(),
    timeoutSecs,
    keepaliveSecs,
    verifyHostKey: settings.verifyHostKey,
  }
}

function rememberPrivateKey(path: string): void {
  const trimmed = path.trim()
  if (!trimmed || trimmed.toLocaleLowerCase().endsWith('.pub')) return

  rememberImported([trimmed])
}

async function browsePrivateKeys(): Promise<void> {
  if (browsingPrivateKeys.value) return

  browsingPrivateKeys.value = true

  try {
    const paths = await privateKeysStore.pickPrivateKeys()
    if (!paths.length) return

    const remembered = rememberImported(paths)
    form.privateKey = remembered[0]?.path ?? paths[0]
    toast.success(
      paths.length > 1 ? `已保存 ${paths.length} 把私钥` : '已选择私钥'
    )
  } catch (error) {
    toast.error({ title: '选择私钥失败', description: ssh.errorMessage(error) })
  } finally {
    browsingPrivateKeys.value = false
  }
}

/** 校验必填项，不通过则跳回 General 并提示 */
function validate(): boolean {
  if (!isReady.value) {
    activeSection.value = 'general'
    toast.warning('请先填写连接名称、主机和用户名')
    return false
  }

  const { port, timeoutSecs, keepaliveSecs } = numericSettings()

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    activeSection.value = 'general'
    toast.warning('端口必须是 1–65535 之间的整数')
    return false
  }

  if (!Number.isInteger(timeoutSecs) || timeoutSecs < 1 || timeoutSecs > 3600) {
    activeSection.value = 'advanced'
    toast.warning('连接超时必须是 1–3600 秒之间的整数')
    return false
  }

  // 0 是明确支持的“关闭 keepalive”，不能用 `Number(value) || 30` 把它改回默认值。
  if (
    !Number.isInteger(keepaliveSecs) ||
    keepaliveSecs < 0 ||
    keepaliveSecs > 86400
  ) {
    activeSection.value = 'advanced'
    toast.warning('Keep Alive 必须是 0–86400 秒之间的整数')
    return false
  }

  if (form.authentication === 'private-key' && !form.privateKey.trim()) {
    activeSection.value = 'ssh-key'
    toast.warning('请先选择私钥文件')
    return false
  }

  if (
    form.authentication === 'private-key' &&
    form.privateKey.trim().toLocaleLowerCase().endsWith('.pub')
  ) {
    activeSection.value = 'ssh-key'
    toast.warning('请选择私钥文件，不要选择 .pub 公钥文件')
    return false
  }

  return true
}

/**
 * 测试连接：真连一次再立刻断开。
 * 只有这样才能验出密码对不对、密钥是否被接受 —— 光校验字段格式说明不了任何问题。
 */
async function testConnection(): Promise<void> {
  if (!validate() || testing.value) return

  testing.value = true
  try {
    const sessionId = await ssh.connect(buildConfig())
    await ssh.disconnect(sessionId)
    toast.success('SSH 连接成功')
  } catch (err) {
    toast.error({ title: 'SSH 连接失败', description: ssh.errorMessage(err) })
  } finally {
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
  if (!validate() || saving.value) return

  saving.value = true

  try {
    if (form.authentication === 'private-key')
      rememberPrivateKey(form.privateKey)

    const { port, timeoutSecs, keepaliveSecs } = numericSettings()

    const input: NewConnection = {
      name: form.name.trim(),
      kind: 'ssh',
      host: form.host.trim(),
      port,
      username: form.username.trim(),
      group: form.group.trim(),
      description: form.description.trim(),
      tags: normalizedTags(),
      tagColor: form.tagColor,
      settings: {
        auth: buildAuth(savePassword.value),
        timeoutSecs,
        keepaliveSecs,
        terminalType: form.terminalType,
        startupCommand: form.startupCommand.trim(),
      },
    }

    if (props.connectionId) await update(props.connectionId, input)
    else await create(input)

    toast.success(props.connectionId ? 'SSH 连接已更新' : 'SSH 连接已保存')
    emit('close')
  } catch (err) {
    toast.error({
      title: '保存 SSH 连接失败',
      description: ssh.errorMessage(err),
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form
    class="flex min-h-0 flex-1 flex-col"
    @submit.prevent="saveConnection"
  >
    <div
      class="connection-tabs"
      role="tablist"
      aria-label="SSH connection settings"
    >
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        role="tab"
        :aria-selected="activeSection === section.id"
        :class="[
          'connection-tab',
          activeSection === section.id && 'connection-tab-active',
        ]"
        @click="activeSection = section.id"
      >
        {{ section.label }}
      </button>
    </div>

    <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div
        v-if="activeSection === 'general'"
        class="grid gap-3.5"
      >
        <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <AppTextField
            v-model="form.name"
            label="Connection Name"
            placeholder="e.g. Production Server"
            required
            autofocus
          />
          <AppTextField
            v-model="form.group"
            label="Group"
            placeholder="e.g. Production"
          />
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
          <AppTextField
            v-model="form.host"
            label="Host"
            placeholder="192.168.1.100 or server.example.com"
            inputmode="url"
            required
          />
          <AppTextField
            v-model="form.port"
            label="Port"
            placeholder="22"
            inputmode="numeric"
            required
          />
        </div>

        <AppTextField
          v-model="form.username"
          label="Username"
          placeholder="e.g. ubuntu"
          autocomplete="username"
          required
        />

        <ConnectionTagEditor
          v-model="form.tags"
          v-model:color="form.tagColor"
          :available-tags="sharedTags"
        />

        <AppSelect
          v-model="form.authentication"
          label="Authentication Method"
          :options="authenticationOptions"
        />

        <template v-if="form.authentication === 'password'">
          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <AppTextField
              v-model="form.password"
              label="Password"
              type="password"
              placeholder="Enter password"
              autocomplete="current-password"
            />
            <AppCheckbox
              v-model="savePassword"
              label="Save password"
              :disabled="!settings.rememberPasswords"
              class="mb-2"
            />
          </div>
        </template>

        <div
          v-else-if="form.authentication === 'private-key'"
          class="space-y-2"
        >
          <AppTextField
            v-model="form.privateKey"
            label="Private Key"
            placeholder="选择或输入私钥路径（支持 PEM）"
            action-icon="lucide:folder-open"
            :action-title="
              browsingPrivateKeys ? '正在打开文件选择器…' : '选择 SSH 私钥文件'
            "
            :action-disabled="browsingPrivateKeys"
            @action="browsePrivateKeys"
          />
          <AppButton
            variant="bare"
            class="text-violet hover:text-txt w-fit text-left text-[11px]"
            @click="activeSection = 'ssh-key'"
          >
            Configure private key →
          </AppButton>
        </div>

        <div class="space-y-1.5">
          <label
            :for="descriptionId"
            class="connection-label"
            >Description (Optional)</label
          >
          <textarea
            :id="descriptionId"
            v-model="form.description"
            class="connection-textarea"
            rows="2"
            placeholder="Add a description for this connection…"
          />
        </div>
      </div>

      <div
        v-else-if="activeSection === 'advanced'"
        class="grid gap-3.5"
      >
        <div class="connection-section-copy">
          Fine-tune connection stability and terminal startup behavior.
        </div>
        <div class="grid grid-cols-2 gap-3">
          <AppTextField
            v-model="form.timeout"
            label="Connection Timeout (s)"
            inputmode="numeric"
          />
          <AppTextField
            v-model="form.keepAlive"
            label="Keep Alive (s)"
            inputmode="numeric"
          />
        </div>
        <AppSelect
          v-model="form.terminalType"
          label="Terminal Type"
          :options="terminalOptions"
        />
        <StartupCommandPresetField v-model="form.startupCommand" />
      </div>

      <div
        v-else-if="activeSection === 'ssh-key'"
        class="grid gap-3.5"
      >
        <div class="connection-section-copy">
          Choose a saved private key or add several keys with the native file
          picker.
        </div>
        <PrivateKeySelector
          v-model="form.privateKey"
          :keys="privateKeys"
          :default-path="defaultPrivateKey"
          :browsing="browsingPrivateKeys || loadingPrivateKeys"
          @browse="browsePrivateKeys"
          @set-default="setDefaultPrivateKey"
          @remember="rememberPrivateKey"
        />
        <AppTextField
          v-model="form.passphrase"
          label="Key Passphrase"
          type="password"
          placeholder="Optional passphrase"
          autocomplete="off"
        />
      </div>

      <div
        v-else
        class="grid gap-3.5"
      >
        <div class="connection-section-copy">
          Route this SSH connection through a SOCKS or HTTP proxy.
        </div>
        <AppSelect
          v-model="form.proxyType"
          label="Proxy Type"
          :options="proxyOptions"
        />
        <template v-if="form.proxyType !== 'none'">
          <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
            <AppTextField
              v-model="form.proxyHost"
              label="Proxy Host"
              placeholder="127.0.0.1"
            />
            <AppTextField
              v-model="form.proxyPort"
              label="Port"
              placeholder="1080"
              inputmode="numeric"
            />
          </div>
          <AppTextField
            v-model="form.proxyUsername"
            label="Proxy Username"
            placeholder="Optional"
          />
          <AppTextField
            v-model="form.proxyPassword"
            label="Proxy Password"
            type="password"
            placeholder="Optional"
          />
        </template>
      </div>
    </div>

    <footer class="connection-footer">
      <AppButton
        :disabled="testing"
        @click="testConnection"
      >
        {{ testing ? 'Testing…' : 'Test Connection' }}
      </AppButton>
      <div class="flex-1" />
      <AppButton @click="emit('close')"> Cancel </AppButton>
      <AppButton
        type="submit"
        variant="primary"
        :disabled="saving || loadingConnection"
      >
        {{ saving ? 'Saving…' : props.connectionId ? 'Update' : 'Save' }}
      </AppButton>
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
  transition:
    color 150ms ease,
    background-color 150ms ease;
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
  background: var(--color-violet);
  content: '';
  box-shadow: 0 0 10px color-mix(in oklch, var(--color-violet) 45%, transparent);
}

.connection-label {
  display: block;
  color: var(--color-txt-2);
  font-size: 11px;
  font-weight: 500;
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
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.connection-textarea::placeholder {
  color: var(--color-txt-4);
}

.connection-textarea:focus {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--color-violet) 12%, transparent);
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
</style>
