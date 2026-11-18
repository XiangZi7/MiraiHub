<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { get } from '@/api/connections'
import { protectRdpPassword } from '@/api/rdp'
import { errorMessage } from '@/api/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { useConnections } from '@/composables/useConnections'
import { toast } from '@/composables/useToast'
import ConnectionGroupSelect from '@/pages/connection/components/connection-group-select.vue'
import { isRdpConnection, type RdpConnectionSettings } from '@/types/connection'
import { RDP_RESOLUTIONS, validRdpResolution } from '@/utils/rdp-display'
import { translateNativeMessage } from '@/i18n/native'

const props = defineProps<{ connectionId: string; defaultGroup: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const { create, update } = useConnections()
const ready = shallowRef(!props.connectionId)
const saving = shallowRef(false)
const previous = shallowRef<Parameters<typeof savedCredential>[0]>()
const form = reactive({
  name: '',
  host: '',
  port: '3389',
  username: '',
  password: '',
  group: props.defaultGroup,
  resolution: 'auto',
  width: '1920',
  height: '1080',
  scale: 'fit',
})

const resolutionOptions = computed(() => [
  { value: 'auto', label: t('跟随标签页大小') },
  ...RDP_RESOLUTIONS.map(({ width, height }) => ({
    value: width + 'x' + height,
    label: width + ' × ' + height,
  })),
  { value: 'custom', label: t('自定义分辨率') },
])
const scaleOptions = computed(() => [
  { value: 'fit', label: t('等比适应') },
  { value: 'actual', label: t('原始尺寸（100%）') },
])
const hasPassword = computed(() =>
  Boolean(
    savedCredential(previous.value, {
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username.trim(),
    })
  )
)

// 编辑时从共享连接存储回填字段，定位失败时保持表单不可提交。
onMounted(async () => {
  if (!props.connectionId) return

  try {
    const connection = await get(props.connectionId)
    if (!connection || !isRdpConnection(connection)) {
      toast.error(t('找不到要编辑的远程桌面连接'))
      return
    }
    previous.value = connection
    const size = connection.settings.resolution
    Object.assign(form, {
      name: connection.name,
      host: connection.host,
      port: String(connection.port),
      username: connection.username,
      group: connection.group,
      scale: connection.settings.scale ?? 'fit',
    })
    if (size) {
      const preset = RDP_RESOLUTIONS.some(
        item => item.width === size.width && item.height === size.height
      )
      form.resolution = preset ? size.width + 'x' + size.height : 'custom'
      form.width = String(size.width)
      form.height = String(size.height)
    }
    ready.value = true
  } catch (error) {
    toast.error({
      title: t('读取远程桌面连接失败'),
      description: errorMessage(error),
    })
  }
})

/** 接受主机名、IPv4 或 IPv6，端口从单独的输入框收集。 */
function validHost(host: string): boolean {
  if (/^[a-z0-9_][a-z0-9_.-]{0,252}$/i.test(host)) return true
  if (!host.includes(':')) return false

  const address =
    host.startsWith('[') && host.endsWith(']') ? host : '[' + host + ']'
  if (!/^\[[a-f0-9:.]+\]$/i.test(address)) return false
  try {
    return Boolean(new URL('http://' + address).hostname)
  } catch {
    return false
  }
}

/** 目标和账号未变时复用密文，编辑显示选项无需重新输入密码。 */
function savedCredential(
  connection:
    | {
        host: string
        port: number
        username: string
        settings: RdpConnectionSettings
      }
    | undefined,
  next: { host: string; port: number; username: string }
): string | undefined {
  if (
    !connection ||
    connection.host !== next.host ||
    connection.port !== next.port ||
    connection.username !== next.username
  )
    return undefined
  return connection.settings.rdpCredential
}

/** 保存当前配置，编辑时仅更新表单字段以保留现有标签和备注。 */
async function save(): Promise<void> {
  if (!ready.value || saving.value) return

  const name = form.name.trim()
  const host = form.host.trim()
  const port = Number(form.port)
  const username = form.username.trim()
  if (!name) {
    toast.warning(t('请填写连接名称'))
    return
  }
  if (!validHost(host)) {
    toast.warning(t('请输入有效的远程桌面主机名或 IP 地址'))
    return
  }
  if (!/^\d+$/.test(form.port.trim()) || port < 1 || port > 65535) {
    toast.warning(t('端口必须是 1–65535 之间的整数'))
    return
  }
  if (
    !username ||
    /[\p{Cc}\u2028\u2029]/u.test(form.username) ||
    username.length > 256
  ) {
    toast.warning(t('请输入有效的远程桌面用户名'))
    return
  }

  let resolution
  if (form.resolution !== 'auto') {
    const [width, height] =
      form.resolution === 'custom'
        ? [Number(form.width), Number(form.height)]
        : form.resolution.split('x').map(Number)
    resolution = { width: width ?? 0, height: height ?? 0 }
    if (!validRdpResolution(resolution)) {
      toast.warning(t('分辨率范围为 200 × 200 至 4096 × 2304，宽度须为偶数'))
      return
    }
  }

  saving.value = true
  try {
    const fields = { name, host, port, username, group: form.group.trim() }
    const original = props.connectionId
      ? await get(props.connectionId)
      : undefined
    if (props.connectionId && (!original || !isRdpConnection(original))) {
      toast.error(t('找不到要编辑的远程桌面连接'))
      return
    }
    let credential =
      original && isRdpConnection(original)
        ? savedCredential(original, fields)
        : undefined
    if (form.password)
      credential = await protectRdpPassword(
        { host, port, username },
        form.password
      )
    if (!credential) {
      toast.warning(t('请填写远程桌面密码'))
      return
    }
    const settings: RdpConnectionSettings = {
      rdpCredential: credential,
      resolution,
      scale: form.scale === 'actual' ? 'actual' : 'fit',
    }
    if (props.connectionId)
      await update(props.connectionId, { ...fields, settings })
    else
      await create({
        ...fields,
        kind: 'rdp',
        description: '',
        tags: [],
        tagColor: 'blue',
        settings,
      })
    toast.success(t('远程桌面连接已保存'))
    form.password = ''
    emit('close')
  } catch (error) {
    toast.error({
      title: t('保存远程桌面连接失败'),
      description: translateNativeMessage(errorMessage(error)),
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form
    class="flex min-h-0 flex-1 flex-col"
    @submit.prevent="save"
  >
    <!-- 配置区：编辑远程桌面的地址、账号和侧栏分组。 -->
    <fieldset
      class="scroll-thin grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-5 py-4"
      :disabled="!ready || saving"
    >
      <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
        <!-- 连接名称输入框：用于在服务器侧栏辨认这台 Windows 主机。 -->
        <AppTextField
          v-model="form.name"
          :label="t('Name')"
          required
          autofocus
        />
        <!-- 分组下拉框：复用服务器连接的分组目录。 -->
        <ConnectionGroupSelect
          v-model="form.group"
          kind="ssh"
        />
      </div>
      <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
        <!-- 主机输入框：填写 Windows 主机名或 IP 地址。 -->
        <AppTextField
          v-model="form.host"
          :label="t('Host')"
          placeholder="desktop.example.com"
          required
        />
        <!-- 端口输入框：默认使用标准 RDP 端口，可按目标机器的配置修改。 -->
        <AppTextField
          v-model="form.port"
          :label="t('Port')"
          inputmode="numeric"
          required
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <!-- 用户名输入框：用于 IronRDP 登录 Windows。 -->
        <AppTextField
          v-model="form.username"
          :label="t('Username')"
          required
        />
        <!-- 密码输入框：首次保存密码，已有密码时可留空以保留密文。 -->
        <AppTextField
          v-model="form.password"
          :label="t('Password')"
          type="password"
          :required="!hasPassword"
          :placeholder="hasPassword ? t('已保存，留空保留') : ''"
        />
      </div>

      <!-- 显示区：控制远端分辨率与本地画布缩放。 -->
      <section class="border-line-soft grid gap-3 border-t pt-3.5">
        <h2 class="text-txt-2 flex items-center gap-2 text-xs font-medium">
          <!-- 桌面图标：标注远程桌面显示设置。 -->
          <AppIcon
            name="lucide:monitor"
            :size="13"
          />
          {{ t('远程桌面显示') }}
        </h2>
        <div class="grid grid-cols-2 gap-3">
          <!-- 分辨率选择：支持自动、常用分辨率及自定义尺寸。 -->
          <AppSelect
            v-model="form.resolution"
            :options="resolutionOptions"
            :label="t('远端分辨率')"
            icon="lucide:monitor"
          />
          <!-- 缩放选择：在标签页中等比适应或按原始像素尺寸显示。 -->
          <AppSelect
            v-model="form.scale"
            :options="scaleOptions"
            :label="t('画面缩放')"
            icon="lucide:scaling"
          />
        </div>
        <div
          v-if="form.resolution === 'custom'"
          class="grid grid-cols-2 gap-3"
        >
          <!-- 自定义宽度输入框：填写远端桌面的宽度像素数。 -->
          <AppTextField
            v-model="form.width"
            :label="t('宽度（像素）')"
            inputmode="numeric"
            required
          />
          <!-- 自定义高度输入框：填写远端桌面的高度像素数。 -->
          <AppTextField
            v-model="form.height"
            :label="t('高度（像素）')"
            inputmode="numeric"
            required
          />
        </div>
      </section>
    </fieldset>

    <!-- 操作区：保存后关闭配置窗口，取消时保留原有记录。 -->
    <footer
      class="border-line-soft flex h-[58px] shrink-0 items-center justify-end gap-2 border-t px-[18px]"
    >
      <!-- 取消按钮：关闭编辑窗口。 -->
      <AppButton @click="emit('close')">{{ t('Cancel') }}</AppButton>
      <!-- 保存按钮：提交连接字段，保存过程中避免重复提交。 -->
      <AppButton
        type="submit"
        variant="primary"
        :disabled="!ready || saving"
      >
        {{ saving ? t('Saving…') : connectionId ? t('Update') : t('Save') }}
      </AppButton>
    </footer>
  </form>
</template>
