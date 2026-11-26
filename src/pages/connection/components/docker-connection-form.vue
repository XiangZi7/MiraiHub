<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { get } from '@/api/connections'
import { testConnection } from '@/api/docker'
import { errorMessage } from '@/api/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { useConnections } from '@/composables/useConnections'
import { toast } from '@/composables/useToast'
import { translateNativeMessage } from '@/i18n/native'
import ConnectionColorPicker from '@/pages/connection/components/connection-color-picker.vue'
import ConnectionGroupSelect from '@/pages/connection/components/connection-group-select.vue'
import { isDockerConnection, type ConnectionTagColor } from '@/types/connection'
import type { DatabaseEnvironment } from '@/types/database'
import type { DockerConnectionSettings } from '@/types/docker'
import {
  DOCKER_NAMED_PIPE,
  DOCKER_UNIX_SOCKET,
  dockerSettingsProblem,
} from '@/utils/docker-connection'
import { DESKTOP_PLATFORM } from '@/utils/platform'

const props = defineProps<{ connectionId: string; defaultGroup: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const { connections, create, update } = useConnections()
const windows = DESKTOP_PLATFORM === 'windows'
const ready = shallowRef(!props.connectionId)
const busy = shallowRef<'' | 'test' | 'save'>('')
const section = shallowRef<'General' | 'Proxy'>('General')
const protocol = shallowRef<DockerConnectionSettings['protocol']>(
  windows ? 'npipe' : 'unix'
)
const transport = shallowRef<DockerConnectionSettings['transport']>('direct')
const endpoints = reactive({
  unix: DOCKER_UNIX_SOCKET,
  npipe: DOCKER_NAMED_PIPE,
  http: 'http://127.0.0.1:2375',
  https: 'https://127.0.0.1:2376',
})
const form = reactive({
  name: '',
  group: props.defaultGroup,
  description: '',
  color: 'blue' as ConnectionTagColor,
  environment: '' as DatabaseEnvironment | '',
  sshConnectionId: '',
  proxyUrl: '',
})
const protocols = computed(() => [
  { value: 'unix', label: 'Unix Socket' },
  ...(windows || protocol.value === 'npipe'
    ? [{ value: 'npipe', label: t('Windows 命名管道') }]
    : []),
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
])
const environments = computed(() => [
  { value: '', label: t('无') },
  { value: 'development', label: t('开发环境') },
  { value: 'testing', label: t('测试环境') },
  { value: 'production', label: t('生产环境') },
])
const transports = computed(() => [
  { value: 'direct', label: t('直接连接') },
  { value: 'ssh', label: 'SSH' },
])
const sshOptions = computed(() =>
  connections
    .filter(connection => connection.kind === 'ssh')
    .map(connection => ({
      value: connection.id,
      label: connection.name,
      description:
        connection.username + '@' + connection.host + ':' + connection.port,
    }))
)
const endpointLabel = computed(() =>
  protocol.value === 'unix'
    ? t('Unix Socket 路径')
    : protocol.value === 'npipe'
      ? t('命名管道路径')
      : t('Docker 引擎地址')
)
const proxyAvailable = computed(
  () =>
    transport.value === 'direct' && ['http', 'https'].includes(protocol.value)
)

/** 切换协议时保留各协议已填写的地址，并选择本机可用的连接方式。 */
function setProtocol(value: string): void {
  if (!(
    value === 'unix' ||
    value === 'npipe' ||
    value === 'http' ||
    value === 'https'
  ))
    return
  protocol.value = value
  if (value === 'npipe') transport.value = 'direct'
  if (windows && value === 'unix') transport.value = 'ssh'
}

/** Windows 在直连和 SSH 间切换时自动选用对应的本地管道或远端 Socket。 */
function setTransport(value: string): void {
  if (value !== 'direct' && value !== 'ssh') return
  transport.value = value
  if (value === 'ssh' && protocol.value === 'npipe') protocol.value = 'unix'
  if (value === 'direct' && windows && protocol.value === 'unix')
    protocol.value = 'npipe'
}

/** 回填独立 Docker 配置，保留原有 SSH 引用供用户辨认及重新选择。 */
onMounted(async () => {
  if (!props.connectionId) return
  try {
    const existing = await get(props.connectionId)
    if (!existing || !isDockerConnection(existing)) {
      toast.error(t('找不到要编辑的 Docker 连接'))
      return
    }
    const settings = existing.settings
    protocol.value = settings.protocol
    transport.value = settings.transport
    endpoints[settings.protocol] = settings.endpoint
    Object.assign(form, {
      name: existing.name,
      group: existing.group,
      description: existing.description,
      color: existing.tagColor,
      environment: settings.environment ?? '',
      sshConnectionId: settings.sshConnectionId ?? '',
      proxyUrl: settings.proxyUrl ?? '',
    })
    ready.value = true
  } catch (error) {
    toast.error({ title: t('读取连接失败'), description: errorMessage(error) })
  }
})

/** 测试与保存共享端点校验，只提交当前协议和传输方式实际使用的字段。 */
function settingsFromForm(): DockerConnectionSettings | undefined {
  const settings: DockerConnectionSettings = {
    protocol: protocol.value,
    transport: transport.value,
    endpoint: endpoints[protocol.value].trim(),
    ...(transport.value === 'ssh'
      ? { sshConnectionId: form.sshConnectionId }
      : {}),
    ...(form.environment ? { environment: form.environment } : {}),
    ...(proxyAvailable.value && form.proxyUrl.trim()
      ? { proxyUrl: form.proxyUrl.trim() }
      : {}),
  }
  const problem = dockerSettingsProblem(settings)
  if (problem) {
    toast.warning(t(problem))
    return
  }
  if (
    settings.transport === 'ssh' &&
    !sshOptions.value.some(option => option.value === settings.sshConnectionId)
  ) {
    toast.warning(t('隧道使用的 SSH 连接不存在，请重新选择'))
    return
  }
  return settings
}

/** 向当前端点请求 Docker 版本以验证连接。 */
async function test(): Promise<void> {
  if (!ready.value || busy.value) return
  const settings = settingsFromForm()
  if (!settings) return
  busy.value = 'test'
  try {
    await testConnection(settings)
    toast.success(t('Docker 连接成功'))
  } catch (error) {
    toast.error({
      title: t('Docker 连接失败'),
      description: translateNativeMessage(errorMessage(error)),
    })
  } finally {
    busy.value = ''
  }
}

/** 新建或更新 Docker 配置，SSH 登录信息始终来自所引用的连接。 */
async function save(): Promise<void> {
  if (!ready.value || busy.value) return
  const name = form.name.trim()
  if (!name) {
    section.value = 'General'
    toast.warning(t('请填写连接名称'))
    return
  }
  const settings = settingsFromForm()
  if (!settings) return
  busy.value = 'save'
  try {
    const fields = {
      name,
      settings,
      group: form.group,
      tagColor: form.color,
      description: form.description.trim(),
    }
    if (props.connectionId) {
      const existing = await get(props.connectionId)
      if (!existing || !isDockerConnection(existing)) {
        toast.error(t('找不到要编辑的 Docker 连接'))
        return
      }
      await update(props.connectionId, fields)
    } else {
      await create({
        ...fields,
        kind: 'docker',
        host: '',
        port: 0,
        username: '',
        tags: [],
      })
    }
    toast.success(t('Docker 连接已保存'))
    emit('close')
  } catch (error) {
    toast.error({
      title: t('保存 Docker 连接失败'),
      description: errorMessage(error),
    })
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <form
    class="flex min-h-0 flex-1 flex-col"
    @submit.prevent="save"
  >
    <fieldset
      class="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4"
      :disabled="!ready || !!busy"
    >
      <div class="mb-4 flex justify-center">
        <div
          class="border-line-soft bg-panel inline-flex gap-1 rounded-lg border p-1"
          role="group"
          :aria-label="t('Docker 连接')"
        >
          <!-- 配置分区：在常规端点与代理设置之间切换。 -->
          <AppButton
            v-for="tab in ['General', 'Proxy'] as const"
            :key="tab"
            variant="bare"
            size="sm"
            class="rounded-md px-3 py-1 text-xs"
            :class="
              section === tab
                ? 'bg-raised text-violet font-semibold shadow-sm'
                : 'text-txt-3 hover:bg-hover'
            "
            :aria-pressed="section === tab"
            @click="section = tab"
            >{{ t(tab) }}</AppButton
          >
        </div>
      </div>
      <div
        v-if="section === 'General'"
        class="grid grid-cols-2 gap-x-4 gap-y-3.5"
      >
        <!-- 颜色与环境：用于区分不同引擎。 -->
        <ConnectionColorPicker v-model="form.color" />
        <AppSelect
          v-model="form.environment"
          :label="t('环境')"
          :options="environments"
        />
        <!-- 标识与协议：名称用于侧栏，协议决定端点输入格式。 -->
        <AppTextField
          v-model="form.name"
          :label="t('Name')"
          :maxlength="200"
          required
          autofocus
        />
        <AppSelect
          :model-value="protocol"
          :label="t('协议')"
          :options="protocols"
          @update:model-value="setProtocol"
        />
        <!-- 端点：分别保留 Socket、命名管道和 HTTP(S) 地址。 -->
        <AppTextField
          v-model="endpoints[protocol]"
          class="col-span-2"
          :label="endpointLabel"
          :maxlength="4096"
          required
          spellcheck="false"
        />
        <!-- 连接方式与 SSH 隧道：通过名称引用已保存的服务器。 -->
        <AppSelect
          :model-value="transport"
          :label="t('连接方式')"
          :options="transports"
          @update:model-value="setTransport"
        />
        <AppSelect
          :model-value="transport === 'ssh' ? form.sshConnectionId : ''"
          @update:model-value="form.sshConnectionId = $event"
          :label="t('SSH 隧道')"
          :options="sshOptions"
          :disabled="transport !== 'ssh'"
          :required="transport === 'ssh'"
          :placeholder="transport === 'ssh' ? t('请选择 SSH 连接') : t('无')"
          searchable
        />
        <!-- 分组与备注：用于整理和说明 Docker 连接。 -->
        <ConnectionGroupSelect
          v-model="form.group"
          kind="docker"
          class="col-span-2"
        />
        <AppTextarea
          v-model="form.description"
          :label="t('备注')"
          class="col-span-2"
          :rows="2"
          :maxlength="4096"
        />
      </div>
      <div
        v-else
        class="grid gap-2"
      >
        <!-- 代理地址：仅对直接 HTTP(S) 连接启用，SSH 复用服务器已有设置。 -->
        <AppTextField
          v-if="proxyAvailable"
          v-model="form.proxyUrl"
          :label="t('HTTP(S) 代理地址')"
          placeholder="http://127.0.0.1:8080"
          :maxlength="4096"
          spellcheck="false"
        />
        <p class="text-txt-3 text-xs leading-relaxed">
          {{
            proxyAvailable
              ? t('留空以直接连接 Docker 引擎')
              : transport === 'ssh'
                ? t('使用所选 SSH 连接的代理设置')
                : t('本地 Socket 和命名管道直接连接 Docker 引擎')
          }}
        </p>
      </div>
    </fieldset>
    <footer
      class="border-line-soft flex h-[58px] shrink-0 items-center justify-end gap-2 border-t px-[18px]"
    >
      <!-- 测试连接：验证当前表单目标，无需先保存。 -->
      <AppButton
        class="mr-auto"
        :disabled="!ready || !!busy"
        @click="test"
        >{{ busy === 'test' ? t('Testing…') : t('Test Connection') }}</AppButton
      >
      <!-- 配置操作：返回或保存到 Docker 分组。 -->
      <AppButton
        :disabled="busy === 'save'"
        @click="emit('close')"
        >{{ t('Cancel') }}</AppButton
      >
      <AppButton
        type="submit"
        variant="primary"
        :disabled="!ready || !!busy"
        >{{ busy === 'save' ? t('Saving…') : t('Save') }}</AppButton
      >
    </footer>
  </form>
</template>
