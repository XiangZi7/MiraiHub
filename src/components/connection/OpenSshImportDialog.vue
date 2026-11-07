<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, toRefs, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import * as connections from '@/api/connections'
import * as privateKeys from '@/api/private-keys'
import { errorMessage } from '@/api/ssh'
import { previewOpenSshConfig } from '@/api/ssh-keys-config'
import { settingNumber, settingsSnapshot } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import {
  isSshConnection,
  type NewConnection,
  type SavedConnection,
  type SshConnectionSettings,
} from '@/types/connection'
import type {
  OpenSshHost,
  OpenSshImportPreview,
  OpenSshJumpHop,
  OpenSshWarning,
} from '@/types/ssh-keys-config'

const { t } = useI18n()

/**
 * 从 ~/.ssh/config 导入 SSH 连接。
 * 解析在 Rust 侧完成，这里只负责预览、标注已存在项，并在确认后写入连接存储。
 */

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  imported: [count: number]
}>()

/** 跳板链上限，与 resolveSshRoute 的限制一致 */
const MAX_JUMP_HOPS = 5

// 响应式状态
const state = reactive({
  // 是否正在读取配置
  loading: false,
  // 是否正在导入
  importing: false,
  // 读取失败的原因
  error: '',
  // 解析结果
  preview: null as OpenSshImportPreview | null,
  // 当前已保存的 SSH 连接，用于标注重复项
  existing: [] as SavedConnection[],
  // 勾选要导入的主机别名
  selected: [] as string[],
})
const { loading, importing, error, preview, selected } = toRefs(state)

// 计算预览里每个主机对应的已存在连接（按地址、端口、用户名判断）
const duplicates = computed(() => {
  const map = new Map<string, SavedConnection>()
  for (const host of state.preview?.hosts ?? []) {
    const found = findConnection(state.existing, host.host, host.port, host.user)
    if (found) map.set(host.alias, found)
  }
  return map
})

// 全选状态：勾选或清空全部主机（含已存在项）
const allSelected = computed({
  get: () => {
    const hosts = state.preview?.hosts ?? []
    return hosts.length > 0 && hosts.every(host => state.selected.includes(host.alias))
  },
  set: value => {
    state.selected = value
      ? (state.preview?.hosts ?? []).map(host => host.alias)
      : []
  },
})

watch(
  () => props.open,
  open => {
    if (open) void load()
  },
  { immediate: true }
)

// 读取 ~/.ssh/config 与现有连接，默认勾选所有非重复项
async function load(): Promise<void> {
  state.loading = true
  state.error = ''
  state.preview = null
  try {
    const [preview, saved] = await Promise.all([
      previewOpenSshConfig(),
      connections.list(),
    ])
    state.existing = saved.filter(isSshConnection)
    state.preview = preview
    state.selected = preview.hosts
      .filter(host => !duplicates.value.has(host.alias))
      .map(host => host.alias)
  } catch (caught) {
    state.error = errorMessage(caught)
  } finally {
    state.loading = false
  }
}

// 勾选或取消单个主机
function toggle(alias: string, value: boolean): void {
  const next = new Set(state.selected)
  if (value) next.add(alias)
  else next.delete(alias)
  state.selected = [...next]
}

// 按地址、端口、用户名在连接列表中查找同一台机器
function findConnection(
  list: readonly SavedConnection[],
  host: string,
  port: number,
  user: string
): SavedConnection | undefined {
  const target = host.toLowerCase()
  return list.find(
    item =>
      item.host.toLowerCase() === target &&
      item.port === port &&
      item.username === user
  )
}

// 格式化一跳跳板为 user@host:port
function hopText(hop: OpenSshJumpHop): string {
  const host = hop.host.includes(':') ? `[${hop.host}]` : hop.host
  return `${hop.user}@${host}:${hop.port}`
}

// 把后端的警告标识翻译成可读文案
function warningText(warning: OpenSshWarning): string {
  const messages: Record<string, string> = {
    syntax: t('语法错误，已跳过该行'),
    matchSkipped: t('不支持 Match 块，已跳过'),
    includeDepth: t('Include 嵌套过深'),
    includeCycle: t('Include 存在循环引用'),
    includeFailed: t('Include 文件读取失败'),
    includeUnsupported: t('不支持目录通配的 Include'),
    tooManyHosts: t('主机过多，仅列出前一部分'),
    userDefaulted: t('未配置 User，使用本机用户名'),
    multipleIdentityFiles: t('配置了多个 IdentityFile，仅使用第一个'),
    forwardIgnored: t('端口转发设置不会导入'),
    proxyCommand: t('不支持 ProxyCommand，导入后将直连'),
    jumpInvalid: t('ProxyJump 格式无效'),
    jumpCycle: t('ProxyJump 存在循环引用'),
    jumpTooLong: t('ProxyJump 跳板链过长'),
    unsupportedToken: t('IdentityFile 含不支持的占位符'),
    relativeIdentityFile: t('IdentityFile 不是绝对路径'),
    invalidPort: t('端口无效，使用 22'),
    identityFileMissing: t('私钥文件不存在'),
  }
  const label = messages[warning.kind] ?? warning.kind
  return warning.detail ? `${label}：${warning.detail}` : label
}

// 把一个主机映射成新连接的入参；跳板链在第二轮补齐
function toNewConnection(host: OpenSshHost): NewConnection {
  const defaultKey = privateKeys.getSnapshot().defaultPath
  const auth: SshConnectionSettings['auth'] = host.identityFile
    ? { type: 'privateKey', path: host.identityFile }
    : defaultKey
      ? { type: 'privateKey', path: defaultKey }
      : { type: 'agent' }
  const settings: SshConnectionSettings = {
    auth,
    timeoutSecs: settingNumber('sshTimeout', 30),
    keepaliveSecs: settingsSnapshot().keepConnectionAlive ? 60 : 0,
    terminalType: 'xterm-256color',
    startupCommand: '',
  }
  return {
    name: host.alias,
    kind: 'ssh',
    host: host.host,
    port: host.port,
    username: host.user,
    group: '',
    description: host.jump.length
      ? `ProxyJump ${host.jump.map(hopText).join(',')}`
      : '',
    tags: [],
    tagColor: 'green',
    settings,
  }
}

// 为带 ProxyJump 的主机解析跳板连接；全部能对上已保存连接时才写入 jumpHostIds
async function linkJumpHosts(
  created: { host: OpenSshHost; connection: SavedConnection }[]
): Promise<number> {
  const all = (await connections.list()).filter(isSshConnection)
  let unresolved = 0
  for (const { host, connection } of created) {
    if (!host.jump.length) continue
    const ids = host.jump.map(
      hop => findConnection(all, hop.host, hop.port, hop.user)?.id
    )
    if (
      ids.length > MAX_JUMP_HOPS ||
      ids.some(id => !id || id === connection.id) ||
      new Set(ids).size !== ids.length
    ) {
      unresolved += 1
      continue
    }
    await connections.update(connection.id, {
      settings: {
        ...(connection.settings as SshConnectionSettings),
        jumpHostIds: ids as string[],
      },
    })
  }
  return unresolved
}

// 导入勾选的主机，完成后提示新增、跳过与未能关联跳板的数量
async function importSelected(): Promise<void> {
  if (!state.preview || state.importing || !state.selected.length) return
  state.importing = true
  try {
    const targets = state.preview.hosts.filter(host =>
      state.selected.includes(host.alias)
    )
    const created: { host: OpenSshHost; connection: SavedConnection }[] = []
    for (const host of targets) {
      created.push({ host, connection: await connections.create(toNewConnection(host)) })
    }
    const identities = targets
      .map(host => host.identityFile)
      .filter((path): path is string => Boolean(path))
    if (identities.length) privateKeys.rememberImported(identities)

    const unresolved = await linkJumpHosts(created)
    const skipped = state.preview.hosts.length - targets.length
    toast.success({
      title: t('已从 ~/.ssh/config 导入 {value0} 条连接', {
        value0: created.length,
      }),
      description: unresolved
        ? t('未导入 {value0} 条；{value1} 条跳板未能匹配已保存连接，已写入备注。', {
            value0: skipped,
            value1: unresolved,
          })
        : t('未导入 {value0} 条。不会自动连接服务器。', { value0: skipped }),
    })
    emit('imported', created.length)
    emit('close')
  } catch (caught) {
    toast.error({ title: t('导入失败'), description: errorMessage(caught) })
  } finally {
    state.importing = false
  }
}
</script>

<template>
  <Teleport to="body">
    <AppDialog
      v-if="open"
      :title="t('从 ~/.ssh/config 导入')"
      :description="
        t('解析 Host、HostName、User、Port、IdentityFile 与 ProxyJump，通配 Host 与 Match 块不会导入。')
      "
      wide
      @close="emit('close')"
    >
      <AppSkeleton
        v-if="loading"
        :rows="5"
      />

      <p
        v-else-if="error"
        role="alert"
        class="text-danger text-[11px]"
      >
        {{ error }}
      </p>

      <template v-else-if="preview">
        <p class="text-txt-3 mb-2.5 flex items-center gap-1.5 font-mono text-[10.5px]">
          <AppIcon
            name="lucide:file-text"
            :size="13"
            class="shrink-0"
          />
          <span
            class="truncate"
            :title="preview.path"
            >{{ preview.path }}</span
          >
        </p>

        <p
          v-if="!preview.found"
          class="text-txt-3 text-[11px]"
        >
          {{ t('没有找到 ~/.ssh/config 文件') }}
        </p>
        <p
          v-else-if="!preview.hosts.length"
          class="text-txt-3 text-[11px]"
        >
          {{ t('配置文件里没有可导入的 Host') }}
        </p>

        <p
          v-for="(warning, index) in preview.warnings"
          :key="`file-${index}`"
          class="text-amber mb-1.5 flex items-start gap-1.5 text-[10.5px]"
        >
          <AppIcon
            name="lucide:triangle-alert"
            :size="12"
            class="mt-px shrink-0"
          />
          <span class="break-all">{{ warningText(warning) }}</span>
        </p>

        <div
          v-if="preview.hosts.length"
          class="card mt-2 overflow-hidden"
        >
          <div class="border-line-soft border-b px-3 py-2">
            <AppCheckbox
              v-model="allSelected"
              :label="
                t('全选（{value0}/{value1}）', {
                  value0: selected.length,
                  value1: preview.hosts.length,
                })
              "
              :disabled="importing"
            />
          </div>
          <ul class="scroll-thin max-h-80 overflow-y-auto">
            <li
              v-for="host in preview.hosts"
              :key="host.alias"
              class="border-line-soft flex items-start gap-2.5 border-b px-3 py-2 last:border-b-0"
            >
              <AppCheckbox
                :model-value="selected.includes(host.alias)"
                :label="host.alias"
                hide-label
                :disabled="importing"
                @update:model-value="toggle(host.alias, $event)"
              />
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2 text-xs">
                  <span class="text-txt truncate font-medium">{{ host.alias }}</span>
                  <span
                    v-if="duplicates.has(host.alias)"
                    class="bg-amber/15 text-amber shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                    :title="duplicates.get(host.alias)?.name"
                  >
                    {{
                      t('已存在：{value0}', {
                        value0: duplicates.get(host.alias)?.name ?? '',
                      })
                    }}
                  </span>
                </p>
                <p class="text-txt-3 mt-0.5 truncate font-mono text-[10.5px]">
                  {{ host.user }}@{{ host.host }}:{{ host.port }}
                </p>
                <p
                  v-if="host.identityFile"
                  class="text-txt-4 mt-0.5 flex items-center gap-1 truncate font-mono text-[10px]"
                  :title="host.identityFile"
                >
                  <AppIcon
                    name="lucide:key-round"
                    :size="11"
                    class="shrink-0"
                  />
                  <span class="truncate">{{ host.identityFile }}</span>
                </p>
                <p
                  v-if="host.jump.length"
                  class="text-txt-4 mt-0.5 flex items-center gap-1 truncate font-mono text-[10px]"
                >
                  <AppIcon
                    name="lucide:route"
                    :size="11"
                    class="shrink-0"
                  />
                  <span class="truncate">{{ host.jump.map(hopText).join(' → ') }}</span>
                </p>
                <p
                  v-for="(warning, index) in host.warnings"
                  :key="index"
                  class="text-amber mt-0.5 text-[10px] break-all"
                >
                  {{ warningText(warning) }}
                </p>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <template #footer>
        <AppButton
          variant="ghost"
          :disabled="loading || importing"
          @click="load"
        >
          {{ t('重新读取') }}
        </AppButton>
        <div class="flex-1" />
        <AppButton
          :disabled="importing"
          @click="emit('close')"
        >
          {{ t('取消') }}
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="loading || importing || !selected.length"
          @click="importSelected"
        >
          {{
            importing
              ? t('导入中…')
              : t('导入 {value0} 条', { value0: selected.length })
          }}
        </AppButton>
      </template>
    </AppDialog>
  </Teleport>
</template>
