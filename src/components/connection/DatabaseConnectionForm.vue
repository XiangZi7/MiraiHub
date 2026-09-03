<script setup lang="ts">
import { computed, reactive, shallowRef, useId } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import ConnectionTextField from './ConnectionTextField.vue'

type DatabaseKind = 'mysql' | 'postgresql'
type SectionId = 'general' | 'ssl'

const props = defineProps<{
  kind: DatabaseKind
}>()

const emit = defineEmits<{
  close: []
}>()

const activeSection = shallowRef<SectionId>('general')
const feedback = shallowRef('')
const savePassword = shallowRef(false)
const defaultPort = props.kind === 'mysql' ? '3306' : '5432'
const databaseLabel = props.kind === 'mysql' ? 'MySQL' : 'PostgreSQL'

const form = reactive({
  name: '',
  host: '',
  port: defaultPort,
  database: '',
  username: '',
  password: '',
  description: '',
  sslMode: 'prefer',
  caCertificate: '',
  clientCertificate: '',
  clientKey: '',
})

const sslModeId = useId()
const descriptionId = useId()

const isReady = computed<boolean>(() => (
  form.name.trim().length > 0
  && form.host.trim().length > 0
  && form.database.trim().length > 0
  && form.username.trim().length > 0
))

function showValidationFeedback(successMessage: string): boolean {
  if (!isReady.value) {
    activeSection.value = 'general'
    feedback.value = '请填写连接名称、主机、数据库和用户名'
    return false
  }

  feedback.value = successMessage
  return true
}

function testConnection(): void {
  showValidationFeedback('配置格式检查通过')
}

function saveConnection(): void {
  if (showValidationFeedback(`${databaseLabel} 连接配置已就绪`))
    emit('close')
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
        <ConnectionTextField
          v-model="form.name"
          label="Connection Name"
          :placeholder="`e.g. ${databaseLabel} Database`"
          required
          autofocus
        />

        <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
          <ConnectionTextField
            v-model="form.host"
            label="Host"
            placeholder="localhost or db.example.com"
            inputmode="url"
            required
          />
          <ConnectionTextField
            v-model="form.port"
            label="Port"
            :placeholder="defaultPort"
            inputmode="numeric"
            required
          />
        </div>

        <ConnectionTextField
          v-model="form.database"
          label="Database Name"
          placeholder="e.g. production"
          required
        />

        <ConnectionTextField
          v-model="form.username"
          label="Username"
          :placeholder="kind === 'mysql' ? 'e.g. root' : 'e.g. postgres'"
          autocomplete="username"
          required
        />

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

        <div class="space-y-1.5">
          <label :for="sslModeId" class="connection-label">SSL Mode</label>
          <div class="connection-select-wrap">
            <select :id="sslModeId" v-model="form.sslMode" class="connection-select">
              <option value="disable">Disable</option>
              <option value="prefer">Prefer</option>
              <option value="require">Require</option>
              <option value="verify-ca">Verify CA</option>
              <option value="verify-full">Verify Full</option>
            </select>
            <AppIcon name="lucide:chevron-down" :size="14" class="pointer-events-none text-txt-4" />
          </div>
        </div>

        <template v-if="form.sslMode !== 'disable'">
          <ConnectionTextField
            v-model="form.caCertificate"
            label="CA Certificate"
            placeholder="Path to CA certificate"
          />
          <ConnectionTextField
            v-model="form.clientCertificate"
            label="Client Certificate"
            placeholder="Optional client certificate"
          />
          <ConnectionTextField
            v-model="form.clientKey"
            label="Client Key"
            placeholder="Optional client key"
          />
        </template>
      </div>
    </div>

    <footer class="connection-footer">
      <button type="button" class="btn" @click="testConnection">
        Test Connection
      </button>
      <p class="min-w-0 flex-1 truncate text-[11px] text-txt-3" aria-live="polite">
        {{ feedback }}
      </p>
      <button type="button" class="btn" @click="emit('close')">
        Cancel
      </button>
      <button type="submit" class="connection-primary">
        Save
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
