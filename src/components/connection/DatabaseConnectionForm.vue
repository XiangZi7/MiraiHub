<script setup lang="ts">
import { computed, reactive, shallowRef, useId } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { useConnections } from '@/composables/useConnections'

type DatabaseKind = 'mysql' | 'postgresql'
type SectionId = 'general' | 'ssl'

const kind = defineModel<DatabaseKind>('kind', { required: true })

const emit = defineEmits<{
  close: []
}>()

const { create } = useConnections()

const activeSection = shallowRef<SectionId>('general')
const feedback = shallowRef('')
// 反馈是成功还是失败，决定文案配色
const feedbackTone = shallowRef<'info' | 'error'>('info')
// 保存中，避免重复提交存出两条一样的连接
const saving = shallowRef(false)
const savePassword = shallowRef(false)
const databaseKinds: Array<{ id: DatabaseKind, label: string, icon: string }> = [
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
const portForKind = (value: DatabaseKind): string => value === 'mysql' ? '3306' : '5432'
const defaultPort = computed(() => portForKind(kind.value))
const databaseLabel = computed(() => kind.value === 'mysql' ? 'MySQL' : 'PostgreSQL')

const form = reactive({
  name: '',
  group: '',
  host: '',
  port: defaultPort.value,
  database: '',
  username: '',
  password: '',
  description: '',
  sslMode: 'prefer',
  caCertificate: '',
  clientCertificate: '',
  clientKey: '',
})

const descriptionId = useId()

const isReady = computed<boolean>(() => (
  form.name.trim().length > 0
  && form.host.trim().length > 0
  && form.database.trim().length > 0
  && form.username.trim().length > 0
))

function setFeedback(message: string, tone: 'info' | 'error' = 'info'): void {
  feedback.value = message
  feedbackTone.value = tone
}

/** 切换数据库协议；端口仍是旧协议默认值时一并换成新默认值。 */
function selectKind(nextKind: DatabaseKind): void {
  if (nextKind === kind.value)
    return

  const previousDefaultPort = defaultPort.value
  kind.value = nextKind

  if (!form.port.trim() || form.port === previousDefaultPort)
    form.port = portForKind(nextKind)

  setFeedback('')
}

/** 校验必填项，不通过则跳回 General 并提示 */
function validate(): boolean {
  if (!isReady.value) {
    activeSection.value = 'general'
    setFeedback('请填写连接名称、主机、数据库和用户名', 'error')
    return false
  }

  return true
}

/**
 * 测试连接。
 *
 * 数据库驱动还没接上（Rust 侧的 db 模块待建），
 * 所以这里只能验字段格式 —— 说清楚这一点，别让人以为真连过了。
 */
function testConnection(): void {
  if (validate())
    setFeedback('字段检查通过；数据库连通性测试待驱动接入')
}

/**
 * 保存连接。
 *
 * 存下来之后侧栏的 Databases 分组就能看到它、点开成标签页；
 * 真正的查询执行要等 db 模块落地。
 */
async function saveConnection(): Promise<void> {
  if (!validate() || saving.value)
    return

  saving.value = true

  try {
    await create({
      name: form.name.trim(),
      kind: kind.value,
      host: form.host.trim(),
      port: Number(form.port) || Number(defaultPort.value),
      username: form.username.trim(),
      group: form.group.trim(),
      description: form.description.trim(),
      settings: {
        database: form.database.trim(),
        // 没勾"保存密码"就不写进存储，下次连接时再问
        password: savePassword.value ? form.password : '',
        ssl: form.sslMode !== 'disable',
      },
    })

    emit('close')
  }
  catch (err) {
    setFeedback(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="saveConnection">
    <div class="connection-tabs" role="tablist" :aria-label="`${databaseLabel} connection settings`">
      <button
        v-for="section in ([{ id: 'general', label: 'General' }, { id: 'ssl', label: 'SSL' }] as const)"
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
        <fieldset class="space-y-1.5">
          <legend class="connection-label">
            Connection Type
          </legend>
          <div class="database-kinds" role="radiogroup" aria-label="Database type">
            <button
              v-for="option in databaseKinds"
              :key="option.id"
              type="button"
              role="radio"
              :aria-checked="kind === option.id"
              :class="['database-kind', kind === option.id && 'database-kind-active']"
              @click="selectKind(option.id)"
            >
              <AppIcon :name="option.icon" :size="13" />
              <span>{{ option.label }}</span>
            </button>
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
          label="Database Name"
          placeholder="e.g. production"
          required
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
          <AppCheckbox v-model="savePassword" label="Save password" class="mb-2" />
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

      <div v-else class="grid gap-3.5">
        <div class="connection-section-copy">
          Configure encrypted transport for this {{ databaseLabel }} connection.
        </div>

        <AppSelect v-model="form.sslMode" label="SSL Mode" :options="sslModeOptions" />

        <template v-if="form.sslMode !== 'disable'">
          <AppTextField
            v-model="form.caCertificate"
            label="CA Certificate"
            placeholder="Path to CA certificate"
          />
          <AppTextField
            v-model="form.clientCertificate"
            label="Client Certificate"
            placeholder="Optional client certificate"
          />
          <AppTextField
            v-model="form.clientKey"
            label="Client Key"
            placeholder="Optional client key"
          />
        </template>
      </div>
    </div>

    <footer class="connection-footer">
      <AppButton @click="testConnection">
        Test Connection
      </AppButton>
      <p
        :class="['min-w-0 flex-1 truncate text-[11px]', feedbackTone === 'error' ? 'text-danger' : 'text-txt-3']"
        :title="feedback"
        aria-live="polite"
      >
        {{ feedback }}
      </p>
      <AppButton @click="emit('close')">
        Cancel
      </AppButton>
      <AppButton type="submit" variant="primary" :disabled="saving">
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
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-violet) 12%, transparent);
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
