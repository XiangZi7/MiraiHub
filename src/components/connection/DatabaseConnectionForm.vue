<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import * as connectionsStore from '@/api/connections'
import * as databaseApi from '@/api/database'
import { useConnections } from '@/composables/useConnections'
import { settingNumber, useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import type { NewConnection } from '@/types/connection'
import { isDatabaseConnection } from '@/types/connection'
import type {
  DatabaseConfig,
  DatabaseKind,
  DatabaseSslMode,
} from '@/types/database'
import ConnectionFilePathField from './ConnectionFilePathField.vue'

const { settings } = useSettings()

type SectionId = 'general' | 'ssl'

const props = withDefaults(
  defineProps<{
    connectionId?: string
  }>(),
  {
    connectionId: '',
  }
)

const kind = defineModel<DatabaseKind>('kind', { required: true })

const emit = defineEmits<{
  close: []
}>()

const { create, update } = useConnections()

const activeSection = shallowRef<SectionId>('general')
const testing = shallowRef(false)
// 保存中，避免重复提交存出两条一样的连接
const saving = shallowRef(false)
const loadingConnection = shallowRef(Boolean(props.connectionId))
const savePassword = shallowRef<boolean>(settings.rememberPasswords)
const databaseKinds: Array<{ id: DatabaseKind; label: string; icon: string }> =
  [
    { id: 'mysql', label: 'MySQL', icon: 'lucide:database' },
    { id: 'postgresql', label: 'PostgreSQL', icon: 'lucide:cylinder' },
  ]
const sslModeOptions = [
  { value: 'disable', label: 'Disable' },
  { value: 'prefer', label: 'Prefer' },
  { value: 'require', label: 'Require' },
  { value: 'verify-ca', label: 'Verify CA' },
  { value: 'verify-full', label: 'Verify Full' },
] as const
const certificateExtensions = ['pem', 'crt', 'cer'] as const
const privateKeyExtensions = ['pem', 'key'] as const
const portForKind = (value: DatabaseKind): string =>
  value === 'mysql' ? '3306' : '5432'
const defaultPort = computed(() => portForKind(kind.value))
const databaseLabel = computed(() =>
  kind.value === 'mysql' ? 'MySQL' : 'PostgreSQL'
)

const form = reactive({
  name: '',
  group: '',
  host: '',
  port: defaultPort.value,
  database: '',
  username: '',
  password: '',
  description: '',
  sslMode: 'prefer' as DatabaseSslMode,
  caCertificate: '',
  clientCertificate: '',
  clientKey: '',
})

const isReady = computed<boolean>(
  () =>
    form.name.trim().length > 0 &&
    form.host.trim().length > 0 &&
    form.username.trim().length > 0
)

onMounted(loadConnection)

async function loadConnection(): Promise<void> {
  if (!props.connectionId) return

  try {
    const connection = await connectionsStore.get(props.connectionId)
    if (!connection || !isDatabaseConnection(connection)) {
      toast.error('找不到要编辑的数据库连接')
      return
    }

    const settings = connection.settings
    kind.value = connection.kind
    Object.assign(form, {
      name: connection.name,
      group: connection.group,
      host: connection.host,
      port: String(connection.port),
      database: settings.database,
      username: connection.username,
      password: settings.password,
      description: connection.description,
      sslMode: settings.sslMode ?? (settings.ssl ? 'prefer' : 'disable'),
      caCertificate: settings.caCertificate ?? '',
      clientCertificate: settings.clientCertificate ?? '',
      clientKey: settings.clientKey ?? '',
    })
    savePassword.value = Boolean(settings.password)
  } catch (error) {
    toast.error({
      title: '读取连接失败',
      description: databaseApi.errorMessage(error),
    })
  } finally {
    loadingConnection.value = false
  }
}

/** 切换数据库协议；端口仍是旧协议默认值时一并换成新默认值。 */
function selectKind(nextKind: DatabaseKind): void {
  if (nextKind === kind.value) return

  const previousDefaultPort = defaultPort.value
  kind.value = nextKind

  if (!form.port.trim() || form.port === previousDefaultPort)
    form.port = portForKind(nextKind)
}

function selectedFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function handleSslFileSelected(label: string, path: string): void {
  toast.success({
    title: `已选择${label}`,
    description: selectedFileName(path),
  })
}

function handleSslFileError(message: string): void {
  toast.error({ title: '选择 SSL 文件失败', description: message })
}

/** 校验必填项，不通过则跳回 General 并提示 */
function validate(): boolean {
  if (!isReady.value) {
    activeSection.value = 'general'
    toast.warning('请填写连接名称、主机和用户名')
    return false
  }

  const port = Number(form.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    activeSection.value = 'general'
    toast.warning('端口必须是 1–65535 之间的整数')
    return false
  }

  if (
    form.sslMode !== 'disable' &&
    Boolean(form.clientCertificate.trim()) !== Boolean(form.clientKey.trim())
  ) {
    activeSection.value = 'ssl'
    toast.warning('客户端证书和客户端私钥需要同时选择')
    return false
  }

  return true
}

function buildConfig(): DatabaseConfig {
  return {
    kind: kind.value,
    host: form.host.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    password: form.password,
    database: form.database.trim(),
    sslMode: form.sslMode,
    caCertificate: form.caCertificate.trim(),
    clientCertificate: form.clientCertificate.trim(),
    clientKey: form.clientKey.trim(),
    timeoutSecs: settingNumber('databaseTimeout', 30),
    maxConnections: settingNumber('maxDatabaseConnections', 10),
  }
}

/** 真正建立驱动连接并立即释放，用于验证网络、TLS 与认证配置。 */
async function testConnection(): Promise<void> {
  if (!validate() || testing.value) return

  testing.value = true
  try {
    await databaseApi.testConnection(buildConfig())
    toast.success('数据库连接成功')
  } catch (error) {
    toast.error({
      title: '数据库连接失败',
      description: databaseApi.errorMessage(error),
    })
  } finally {
    testing.value = false
  }
}

/**
 * 保存连接。
 *
 * 存下来之后侧栏的 Databases 分组就能看到它、点开成标签页；
 * 真正的查询执行要等 db 模块落地。
 */
async function saveConnection(): Promise<void> {
  if (!validate() || saving.value) return

  saving.value = true

  try {
    const input: NewConnection = {
      name: form.name.trim(),
      kind: kind.value,
      host: form.host.trim(),
      port: Number(form.port) || Number(defaultPort.value),
      username: form.username.trim(),
      group: form.group.trim(),
      description: form.description.trim(),
      tags: [],
      tagColor: 'green',
      settings: {
        database: form.database.trim(),
        // 没勾"保存密码"就不写进存储，下次连接时再问
        password: savePassword.value ? form.password : '',
        ssl: form.sslMode !== 'disable',
        sslMode: form.sslMode,
        caCertificate: form.caCertificate.trim(),
        clientCertificate: form.clientCertificate.trim(),
        clientKey: form.clientKey.trim(),
      },
    }

    if (props.connectionId) await update(props.connectionId, input)
    else await create(input)

    toast.success(props.connectionId ? '数据库连接已更新' : '数据库连接已保存')
    emit('close')
  } catch (err) {
    toast.error({
      title: '保存数据库连接失败',
      description: databaseApi.errorMessage(err),
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
      :aria-label="`${databaseLabel} connection settings`"
    >
      <AppButton
        v-for="section in [
          { id: 'general', label: 'General' },
          { id: 'ssl', label: 'SSL' },
        ] as const"
        :key="section.id"
        variant="bare"
        role="tab"
        :aria-selected="activeSection === section.id"
        :class="[
          'connection-tab',
          activeSection === section.id && 'connection-tab-active',
        ]"
        @click="activeSection = section.id"
      >
        {{ section.label }}
      </AppButton>
    </div>

    <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div
        v-if="activeSection === 'general'"
        class="grid gap-3.5"
      >
        <fieldset class="space-y-1.5">
          <legend class="connection-label">Connection Type</legend>
          <div
            class="database-kinds"
            role="radiogroup"
            aria-label="Database type"
          >
            <AppButton
              v-for="option in databaseKinds"
              :key="option.id"
              variant="bare"
              role="radio"
              :aria-checked="kind === option.id"
              :class="[
                'database-kind',
                kind === option.id && 'database-kind-active',
              ]"
              @click="selectKind(option.id)"
            >
              <AppIcon
                :name="option.icon"
                :size="13"
              />
              <span>{{ option.label }}</span>
            </AppButton>
          </div>
        </fieldset>

        <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <AppTextField
            v-model="form.name"
            label="Connection Name"
            :placeholder="`e.g. ${databaseLabel} Database`"
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
            placeholder="localhost or db.example.com"
            inputmode="url"
            required
          />
          <AppTextField
            v-model="form.port"
            label="Port"
            :placeholder="defaultPort"
            inputmode="numeric"
            required
          />
        </div>

        <AppTextField
          v-model="form.database"
          label="Database Name (Optional)"
          placeholder="e.g. production"
        />

        <AppTextField
          v-model="form.username"
          label="Username"
          :placeholder="kind === 'mysql' ? 'e.g. root' : 'e.g. postgres'"
          autocomplete="username"
          required
        />

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

        <AppTextarea
          v-model="form.description"
          label="Description (Optional)"
          :rows="2"
          class="resize-none"
          placeholder="Add a description for this connection…"
        />
      </div>

      <div
        v-else
        class="grid gap-3.5"
      >
        <div class="connection-section-copy">
          Configure encrypted transport for this {{ databaseLabel }} connection.
        </div>

        <AppSelect
          v-model="form.sslMode"
          label="SSL Mode"
          :options="sslModeOptions"
        />

        <template v-if="form.sslMode !== 'disable'">
          <ConnectionFilePathField
            v-model="form.caCertificate"
            label="CA Certificate"
            placeholder="选择或输入 CA 证书路径"
            dialog-title="选择 CA 证书"
            filter-name="CA 证书"
            :extensions="certificateExtensions"
            @selected="handleSslFileSelected('CA 证书', $event)"
            @error="handleSslFileError"
          />
          <ConnectionFilePathField
            v-model="form.clientCertificate"
            label="Client Certificate"
            placeholder="可选：选择客户端证书"
            dialog-title="选择客户端证书"
            filter-name="客户端证书"
            :extensions="certificateExtensions"
            @selected="handleSslFileSelected('客户端证书', $event)"
            @error="handleSslFileError"
          />
          <ConnectionFilePathField
            v-model="form.clientKey"
            label="Client Key"
            placeholder="可选：选择客户端私钥"
            dialog-title="选择客户端私钥"
            filter-name="客户端私钥"
            :extensions="privateKeyExtensions"
            @selected="handleSslFileSelected('客户端私钥', $event)"
            @error="handleSslFileError"
          />
        </template>
      </div>
    </div>

    <footer class="connection-footer">
      <AppButton
        :disabled="testing || loadingConnection"
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
        {{ saving ? 'Saving…' : 'Save' }}
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
  justify-content: center;
  cursor: pointer;
  padding: 0 12px;
  color: var(--color-txt-3);
  font-size: 11.5px;
  transition: color 150ms ease;
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

.database-kinds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.database-kind {
  display: inline-flex;
  height: 32px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  color: var(--color-txt-3);
  font-size: 11.5px;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.database-kind:hover,
.database-kind:focus-visible {
  border-color: var(--color-line-strong);
  color: var(--color-txt-2);
  outline: none;
}

.database-kind-active {
  border-color: color-mix(in oklch, var(--color-violet) 65%, transparent);
  background: color-mix(in oklch, var(--color-violet) 14%, var(--color-card));
  color: var(--color-txt);
  box-shadow: 0 0 0 1px
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

@media (prefers-reduced-motion: reduce) {
  .database-kind {
    transition: none;
  }
}
</style>
