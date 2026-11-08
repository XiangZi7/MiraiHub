<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  nextTick,
  onMounted,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'

import * as agent from '@/api/agent'
import DatabaseConnectionIcon from '@/components/connection/DatabaseConnectionIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCollapse from '@/components/ui/AppCollapse.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import IconButton from '@/components/ui/IconButton.vue'
import DatabaseConnectingSkeleton from '@/components/workspace/database/DatabaseConnectingSkeleton.vue'
import { useConnections } from '@/composables/useConnections'
import { settingNumber } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { DATABASE_CONNECTION_ICONS } from '@/constants/connection'
import { isDatabaseConnection, type SavedConnection } from '@/types/connection'
import type { AppErrorKind, SshSessionStatus } from '@/types/ssh'
import { copyText } from '@/utils/clipboard'
import {
  classifyConnectionError,
  connectionErrorCopy,
  connectionErrorTips,
  hostKind,
  redactConnectionError,
  type ConnectionErrorField,
} from '@/utils/connection-error'
import { IS_TAURI, openConnectionWindow } from '@/utils/window'

const props = withDefaults(
  defineProps<{
    status: SshSessionStatus
    needsPassword: boolean
    error?: string
    /** 有 connection 时以 connection.kind 为准 */
    kind?: 'database' | 'redis'
    /** 连接目标：信息条、编辑入口与分类上下文 */
    connection?: SavedConnection
    /** 后端 AppErrorKind，没有时只按文本分类 */
    errorKind?: AppErrorKind | ''
    /** 标签是否可见，不可见时不抢焦点 */
    active?: boolean
  }>(),
  { error: '', kind: 'database', errorKind: '', active: true }
)

const emit = defineEmits<{
  connect: [password?: string]
  cancel: []
}>()

const password = defineModel<string>('password', { required: true })
const { t, locale } = useI18n()
const { find } = useConnections()

/** 调用方没有监听 cancel 时隐藏取消按钮，旧用法保持不变 */
const cancellable = !!getCurrentInstance()?.vnode.props?.onCancel
const uid = useId()
const titleId = `${uid}-title`
const explainId = `${uid}-explain`
const detailId = `${uid}-detail`
const hintId = `${uid}-hint`
const root = useTemplateRef<HTMLElement>('root')
const passwordWrap = useTemplateRef<HTMLElement>('passwordWrap')
const primaryButton =
  useTemplateRef<InstanceType<typeof AppButton>>('primaryButton')

/** 可疑字段的高亮：颜色之外再加虚下划线，不只靠颜色表达 */
const SUSPECT =
  'text-danger underline decoration-danger/50 decoration-dotted underline-offset-2'

// ---------- 推导状态 ----------
const connecting = computed(() => props.status === 'connecting')
/** 上一次连接结束时的结果；composable 重连时会先清空错误，重连中仍展示它 */
const settled = shallowRef<'none' | 'failed' | 'idle'>(
  connecting.value ? 'none' : props.error ? 'failed' : 'idle'
)
const lastError = shallowRef(props.error)
const lastErrorKind = shallowRef<AppErrorKind | ''>(props.errorKind)
const attempt = shallowRef(1)
const cancelled = shallowRef(false)
const passwordRejected = shallowRef(false)
/** 重连期间 needsPassword 会被清空，密码框仍需保持可见（禁用） */
const passwordWasShown = shallowRef(props.needsPassword)
/** null 表示按分类决定默认展开 */
const detailOpen = shallowRef<boolean | null>(null)
const aiText = shallowRef('')
const aiLoading = shallowRef(false)
const hadFocus = shallowRef(false)
let attemptWithPassword = false
let pendingFocus = false
let aiRequest = 0

const phase = computed<'connecting' | 'retrying' | 'failed' | 'idle'>(() =>
  connecting.value
    ? settled.value === 'none'
      ? 'connecting'
      : 'retrying'
    : props.error
      ? 'failed'
      : 'idle'
)
const shownError = computed(() =>
  connecting.value ? lastError.value : props.error
)
const shownKind = computed(() =>
  connecting.value ? lastErrorKind.value : props.errorKind
)
/** 失败版式：失败态，或从失败进入的重连 */
const failedView = computed(() => !!shownError.value)
const showPassword = computed(
  () => props.needsPassword || (connecting.value && passwordWasShown.value)
)

// ---------- 连接目标 ----------
const database = computed(() =>
  props.connection && isDatabaseConnection(props.connection)
    ? props.connection
    : undefined
)
const engine = computed(
  () =>
    database.value?.kind ?? (props.kind === 'redis' ? 'redis' : undefined)
)
const isRedis = computed(() => engine.value === 'redis')
const engineLabel = computed(() =>
  engine.value ? DATABASE_CONNECTION_ICONS[engine.value].label : t('数据库')
)
const displayName = computed(
  () => props.connection?.name || engineLabel.value
)

/** 连接目标摘要：信息条、路线、复制报告与 AI 脱敏共用 */
const target = computed(() => {
  const connection = database.value
  if (!connection) return null
  const settings = connection.settings
  const isFile = connection.kind === 'sqlite'
  const tunnel =
    !isFile && settings.sshTunnel?.enabled ? settings.sshTunnel : undefined
  const saved = tunnel?.connectionId ? find(tunnel.connectionId) : undefined
  const manual = tunnel
    ? `${tunnel.username ? `${tunnel.username}@` : ''}${tunnel.host}:${tunnel.port}`
    : ''
  return {
    user: isFile ? '' : connection.username,
    host: connection.host,
    port: isFile ? '' : String(connection.port),
    database: isFile
      ? ''
      : connection.kind === 'redis'
        ? settings.database || '0'
        : settings.database,
    isFile,
    tunnelLabel: tunnel ? saved?.name || manual : '',
    tunnelHost: tunnel ? (saved?.host ?? tunnel.host) : '',
    environment: settings.environment ?? 'development',
    readOnly: !!settings.readOnly,
    sslMode: settings.sslMode ?? (settings.ssl ? 'prefer' : 'disable'),
  }
})
const viaTunnel = computed(() => !!target.value?.tunnelLabel)
const fileName = computed(
  () => target.value?.host.split(/[\\/]/).pop() || target.value?.host || ''
)
/** 连接中底栏的路线：本机 → 隧道 → host:port；SQLite 只显示文件名 */
const route = computed<string[]>(() => {
  const value = target.value
  if (!value) return []
  if (value.isFile) return [fileName.value]
  const endpoint = `${value.host}:${value.port}`
  return value.tunnelLabel
    ? [t('本机'), value.tunnelLabel, endpoint]
    : [endpoint]
})

// ---------- 诊断 ----------
const context = computed(() => ({
  engine: engine.value,
  viaTunnel: viaTunnel.value,
}))
const info = computed(() =>
  classifyConnectionError(shownError.value, shownKind.value, context.value)
)
const copy = computed(() =>
  connectionErrorCopy(info.value.category, context.value)
)
const timeoutSecs = computed(() => settingNumber('databaseTimeout', 30))
const params = computed<Record<string, string>>(() => ({
  user: target.value?.user ?? '',
  host: target.value?.isFile ? fileName.value : (target.value?.host ?? ''),
  port: target.value?.port ?? '',
  database: target.value?.database ?? '',
  secs: info.value.timeoutSecs === null ? '' : String(info.value.timeoutSecs),
  via: target.value?.tunnelLabel ?? '',
}))

/** 解释所需的插值有任一为空时改用回退文案，避免出现“服务器拒绝了  的登录凭据” */
function explainFor(key: string, fallback: string): string {
  const missing = [...key.matchAll(/\{(\w+)\}/g)].some(
    ([, name]) => !params.value[name]
  )
  return missing ? t(fallback) : t(key, params.value)
}

const title = computed(() => {
  if (failedView.value) return t(copy.value.title)
  return isRedis.value ? t('Redis 连接未建立') : t('数据库连接未建立')
})
const explain = computed(() => {
  if (failedView.value)
    return explainFor(copy.value.explain, copy.value.explainFallback)
  if (cancelled.value) return t('已取消连接。')
  return isRedis.value
    ? t('连接后即可浏览键值并执行命令。')
    : t('连接后即可浏览数据库对象并运行查询。')
})
const tips = computed(() =>
  failedView.value
    ? connectionErrorTips(info.value.category, context.value).map(key =>
        t(key, params.value)
      )
    : []
)
const detailExpanded = computed(
  () => detailOpen.value ?? info.value.category === 'unknown'
)
const canDiagnose = computed(
  () => IS_TAURI && failedView.value && info.value.category !== 'config'
)

/** 信息条中命中可疑字段的片段：返回高亮类与指向解释段的 aria-describedby */
function mark(...fields: ConnectionErrorField[]) {
  const field = info.value.field
  return failedView.value && field && fields.includes(field)
    ? { class: SUSPECT, 'aria-describedby': explainId }
    : {}
}

// ---------- 已等待计时 ----------
const elapsed = shallowRef(0)
let startedAt = Date.now()
const timer = useIntervalFn(
  () => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000)
  },
  1000,
  { immediate: false }
)
const overdue = computed(() => elapsed.value > timeoutSecs.value)
/** 3 秒后才显示，避免快速连接时闪一下 */
const elapsedText = computed(() => {
  if (!connecting.value || elapsed.value < 3) return ''
  return overdue.value
    ? t('仍在等待服务器响应…')
    : t('{n} 秒', { n: elapsed.value })
})

// 开始计时：每次进入连接中都从 0 计
function startTimer(): void {
  startedAt = Date.now()
  elapsed.value = 0
  timer.resume()
}

// 状态切换：进入连接中时计数并清空 AI 结果；离开时记下本次结果供重连期间展示
watch(
  () => props.status,
  (next, previous) => {
    if (next === 'connecting') {
      if (settled.value === 'failed') attempt.value++
      cancelled.value = false
      aiText.value = ''
      aiLoading.value = false
      aiRequest++
      startTimer()
      return
    }
    if (previous !== 'connecting') return
    timer.pause()
    settled.value = props.error ? 'failed' : 'idle'
    lastError.value = props.error
    lastErrorKind.value = props.errorKind
    passwordRejected.value =
      attemptWithPassword && !!props.error && info.value.category === 'auth'
    passwordWasShown.value = props.needsPassword
    attemptWithPassword = false
  }
)

// 认证失败时记住“已显示过密码框”，重连期间保持它可见
watch(
  () => props.needsPassword,
  value => {
    if (value) passwordWasShown.value = true
  }
)

// ---------- 动作 ----------
// 发起连接；连接中忽略（主按钮用 aria-disabled 保留焦点，点击会走到这里）
function submit(): void {
  if (connecting.value) return
  attemptWithPassword = props.needsPassword && !!password.value
  emit('connect', props.needsPassword ? password.value : undefined)
}

// 取消正在进行的连接，视图调用 disconnect() 后进入未连接态
function cancel(): void {
  if (!connecting.value || !cancellable) return
  cancelled.value = true
  emit('cancel')
}

// 打开原生连接编辑窗口；保存后连接指纹变化，会话 composable 会自动重连
function editConnection(): void {
  if (props.connection) openConnectionWindow('database', props.connection.id)
}

// 展开或收起原始错误，状态在重连期间保留
function toggleDetail(): void {
  detailOpen.value = !detailExpanded.value
}

/** 复制报告第一行：引擎 + 地址 + 隧道，不含密码 */
function summaryLine(): string {
  const value = target.value
  if (!value) return engineLabel.value
  const address = value.isFile
    ? value.host
    : `${value.user ? `${value.user}@` : ''}${value.host}:${value.port}${value.database ? `/${value.database}` : ''}`
  const via = value.tunnelLabel ? ` (SSH ${value.tunnelLabel})` : ''
  return `${engineLabel.value} ${address}${via}`
}

// 复制带上下文的错误报告（目标、分类、错误码、原文），供工单或 AI 使用；结果统一走 toast 反馈
async function copyError(): Promise<void> {
  const heading = info.value.code
    ? `${title.value} · ${info.value.code}`
    : title.value
  try {
    await copyText([summaryLine(), heading, shownError.value].join('\n'))
    toast.success(t('已复制错误信息'))
  } catch {
    toast.error(t('复制失败'))
  }
}

// 一次性 AI 诊断：只发送分类、错误码与脱敏后的错误，不含主机、用户名和密码
async function diagnose(): Promise<void> {
  if (aiLoading.value || connecting.value || !shownError.value) return
  const value = target.value
  const request = ++aiRequest
  const payload = {
    engine: engine.value ?? props.kind,
    category: info.value.category,
    code: info.value.code,
    port: value && !value.isFile ? Number(value.port) : undefined,
    hostKind: value ? hostKind(value.host, engine.value) : undefined,
    viaTunnel: viaTunnel.value,
    sslMode: value && !value.isFile ? value.sslMode : undefined,
    environment: value?.environment,
    timeoutSecs: info.value.timeoutSecs ?? timeoutSecs.value,
    // Redis 库名是数字编号，字面替换会误伤错误原文中的数字
    error: redactConnectionError(shownError.value, {
      host: value?.host,
      user: value?.user,
      database: isRedis.value ? undefined : value?.database,
      sshHost: value?.tunnelHost,
    }),
  }
  aiLoading.value = true
  aiText.value = ''
  try {
    const text = await agent.diagnoseConnection(
      JSON.stringify(payload),
      locale.value.startsWith('zh') ? 'Simplified Chinese' : 'English'
    )
    if (request === aiRequest) aiText.value = text.trim()
  } catch (error) {
    if (request === aiRequest)
      toast.error({
        title: t('AI 诊断失败'),
        description: agent.errorMessage(error),
      })
  } finally {
    if (request === aiRequest) aiLoading.value = false
  }
}

// ---------- 键盘 ----------
// 组件内按 Enter 触发连接；输入法组合中、焦点在按钮上（按钮会自己响应）或正在连接时忽略
function onEnter(event: KeyboardEvent): void {
  if (event.isComposing || connecting.value) return
  if ((event.target as HTMLElement).closest('button, a, textarea, pre')) return
  event.preventDefault()
  submit()
}

// 连接中按 Escape 取消
function onEscape(event: KeyboardEvent): void {
  if (!connecting.value || !cancellable) return
  event.preventDefault()
  cancel()
}

// ---------- 焦点与播报 ----------
/** 只播报一次的状态文本，由常驻的 polite 区域朗读 */
const announcement = computed(() => {
  if (connecting.value)
    return t('正在连接 {name}…', { name: displayName.value })
  if (phase.value === 'failed') return `${title.value} ${explain.value}`
  return cancelled.value ? t('已取消连接') : ''
})

// 失败或未连接时把焦点移到密码框或主按钮；只在焦点无主或本来就在组件内时移动，不抢其他区域
function focusPrimary(): void {
  if (!props.active || !root.value) return
  const current = document.activeElement
  const owned =
    !current ||
    current === document.body ||
    root.value.contains(current) ||
    hadFocus.value
  if (!owned) return
  const input = showPassword.value
    ? passwordWrap.value?.querySelector('input')
    : null
  const button = primaryButton.value?.$el as HTMLElement | undefined
  const element = input ?? button
  if (!element) {
    // 视图还在 Transition 中，等 after-enter 再聚焦
    pendingFocus = true
    return
  }
  pendingFocus = false
  element.focus({ preventScroll: true })
  input?.select()
}

// 给密码输入框补上校验状态；AppTextField 不透传 aria 属性，只能直接设置
function syncPasswordState(): void {
  const input = passwordWrap.value?.querySelector('input')
  if (!input) return
  if (passwordRejected.value) {
    input.setAttribute('aria-invalid', 'true')
    input.setAttribute('aria-describedby', hintId)
  } else {
    input.removeAttribute('aria-invalid')
    input.removeAttribute('aria-describedby')
  }
}

// 视图切换动画结束：补做被推迟的聚焦和密码框状态
function onAfterEnter(): void {
  syncPasswordState()
  if (pendingFocus) focusPrimary()
}

// 进入失败或未连接时移动焦点
watch(phase, value => {
  if (value === 'failed' || value === 'idle') void nextTick(focusPrimary)
})

// 密码框出现或校验结果变化时同步 aria 状态
watch([passwordRejected, showPassword], syncPasswordState, { flush: 'post' })

// 挂载时若已在连接中，开始计时
onMounted(() => {
  if (connecting.value) startTimer()
  syncPasswordState()
})
</script>

<template>
  <section
    ref="root"
    class="@container/conn relative flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-labelledby="phase === 'connecting' ? undefined : titleId"
    :aria-label="phase === 'connecting' ? displayName : undefined"
    :aria-busy="connecting"
    @keydown.enter="onEnter"
    @keydown.esc="onEscape"
    @focusin="hadFocus = true"
  >
    <!-- 唯一的播报区：状态变化只朗读一次，不用 alert 打断 -->
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcement }}
    </p>
    <div
      v-if="phase === 'retrying'"
      class="progress-indeterminate z-10"
      aria-hidden="true"
    />

    <Transition
      name="fade"
      mode="out-in"
      @after-enter="onAfterEnter"
    >
      <!-- 首次连接：骨架 + 底栏（路线与已等待时间） -->
      <div
        v-if="phase === 'connecting'"
        key="connecting"
        class="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <DatabaseConnectingSkeleton
          kind="database"
          aria-hidden="true"
        />
        <div
          class="border-line-soft bg-card/60 text-txt-3 flex shrink-0 items-center gap-2 border-t px-3 py-2 text-[11px]"
        >
          <AppIcon
            name="lucide:loader-circle"
            :size="13"
            class="text-violet shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">
            {{ t('正在连接 {name}…', { name: displayName }) }}
          </span>
          <span
            v-if="route.length"
            class="text-txt-4 flex min-w-0 items-center gap-1 font-mono @max-[420px]/conn:hidden"
          >
            <template
              v-for="(segment, index) in route"
              :key="index"
            >
              <AppIcon
                v-if="index"
                name="lucide:arrow-right"
                :size="10"
                class="shrink-0"
                aria-hidden="true"
              />
              <span
                class="truncate"
                :title="segment"
                >{{ segment }}</span
              >
            </template>
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-2">
            <span
              v-if="elapsedText"
              class="tabular-nums"
              :class="overdue && 'text-amber'"
            >
              {{ elapsedText }}
            </span>
            <AppButton
              v-if="cancellable"
              variant="ghost"
              size="sm"
              @click="cancel"
            >
              {{ t('取消') }}
            </AppButton>
          </span>
        </div>
      </div>

      <!-- 失败 / 未连接 / 重连：单列文档式内容，落在约 1/3 高度处 -->
      <div
        v-else
        key="state"
        class="scroll-thin flex min-h-0 flex-1 flex-col overflow-auto"
      >
        <div
          class="grow"
          aria-hidden="true"
        />
        <div
          class="panel-fade-in mx-auto w-full max-w-[440px] shrink-0 px-6 py-8 @max-[380px]/conn:px-4 @max-[380px]/conn:py-6"
        >
          <div :class="phase === 'retrying' && 'stale-dim'">
            <!-- 眉标：语义色只出现在这一行 -->
            <p
              class="flex items-center gap-1.5 text-[11px] font-medium"
              :class="
                failedView && !connecting ? 'text-danger' : 'text-txt-3'
              "
            >
              <AppIcon
                v-if="connecting"
                name="lucide:loader-circle"
                :size="14"
                class="motion-safe:animate-spin"
                aria-hidden="true"
              />
              <AppIcon
                v-else-if="failedView"
                :name="copy.icon"
                :size="14"
                aria-hidden="true"
              />
              <AppIcon
                v-else
                name="lucide:plug"
                :size="14"
                aria-hidden="true"
              />
              <span class="min-w-0 truncate">
                {{
                  connecting
                    ? failedView
                      ? t('正在重新连接…')
                      : t('正在连接…')
                    : failedView
                      ? t('{engine} 连接失败', { engine: engineLabel })
                      : engineLabel
                }}
              </span>
              <span
                v-if="attempt > 1"
                class="text-txt-4 ml-auto shrink-0 font-normal tabular-nums"
              >
                {{ t('第 {n} 次尝试', { n: attempt }) }}
              </span>
            </p>

            <!-- 标题块按分类重放入场动画 -->
            <div
              :key="failedView ? info.category : 'idle'"
              class="panel-fade-in"
            >
              <h2
                :id="titleId"
                class="text-txt mt-1.5 text-[15px] leading-snug font-semibold @max-[380px]/conn:text-[14px]"
              >
                {{ title }}
              </h2>
              <p
                :id="explainId"
                class="text-txt-2 mt-1 text-[12.5px] leading-relaxed"
              >
                {{ explain }}
              </p>
            </div>

            <!-- 连接目标信息条：可疑字段带下划线与 aria-describedby -->
            <div
              v-if="target && connection"
              class="border-line-soft bg-card/50 text-txt-2 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-2 font-mono text-[11px]"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <DatabaseConnectionIcon
                  :kind="database!.kind"
                  class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5"
                />
                <span
                  v-if="target.isFile"
                  class="min-w-0 truncate"
                  :title="target.host"
                  v-bind="mark('database', 'host')"
                  >{{ target.host }}</span
                >
                <span
                  v-else
                  class="min-w-0 wrap-anywhere"
                  ><template v-if="target.user"
                    ><span v-bind="mark('user')">{{ target.user }}</span
                    >@</template
                  ><span v-bind="mark('host')">{{ target.host }}</span>:<span
                    v-bind="mark('port')"
                    >{{ target.port }}</span
                  ><template v-if="target.database">
                    /
                    <span v-bind="mark('database')">{{
                      isRedis ? `db ${target.database}` : target.database
                    }}</span></template
                  ></span
                >
              </span>
              <span
                v-if="target.tunnelLabel"
                class="text-txt-3 flex min-w-0 items-center gap-1"
              >
                <AppIcon
                  name="lucide:waypoints"
                  :size="12"
                  class="shrink-0"
                  aria-hidden="true"
                />
                <span
                  class="truncate"
                  v-bind="mark('tunnel')"
                  >{{ target.tunnelLabel }}</span
                >
              </span>
              <span
                v-if="target.environment === 'production'"
                class="bg-danger/12 text-danger inline-flex items-center gap-1 rounded px-1.5 py-px font-sans text-[10px] leading-4"
              >
                <span
                  class="bg-danger size-1.5 rounded-full"
                  aria-hidden="true"
                />
                {{ t('生产环境') }}
              </span>
              <span
                v-else-if="target.environment === 'testing'"
                class="bg-amber/12 text-amber inline-flex items-center gap-1 rounded px-1.5 py-px font-sans text-[10px] leading-4"
              >
                <span
                  class="bg-amber size-1.5 rounded-full"
                  aria-hidden="true"
                />
                {{ t('测试环境') }}
              </span>
              <span
                v-if="target.readOnly"
                class="text-txt-3 inline-flex items-center gap-1 font-sans"
              >
                <AppIcon
                  name="lucide:lock"
                  :size="11"
                  aria-hidden="true"
                />
                {{ t('只读') }}
              </span>
              <span
                v-if="failedView && info.field === 'ssl' && !target.isFile"
                v-bind="mark('ssl')"
                >SSL {{ target.sslMode }}</span
              >
            </div>

            <!-- 排查建议 -->
            <template v-if="tips.length">
              <p class="text-txt-3 mt-5 text-[11px] font-medium">
                {{ t('可以尝试') }}
              </p>
              <ol class="mt-1.5 flex flex-col gap-1">
                <li
                  v-for="(tip, index) in tips"
                  :key="tip"
                  class="text-txt-2 flex gap-2.5 text-xs leading-relaxed"
                >
                  <span
                    class="text-txt-4 w-3 shrink-0 font-mono text-[11px] tabular-nums"
                    aria-hidden="true"
                    >{{ index + 1 }}</span
                  >
                  <span class="min-w-0">{{ tip }}</span>
                </li>
              </ol>
            </template>

            <!-- AI 诊断结果：不加卡片，只用左侧色条分组 -->
            <div aria-live="polite">
              <section
                v-if="aiLoading || aiText"
                class="border-violet/50 mt-5 border-l-2 pl-3"
                :aria-busy="aiLoading"
              >
                <p
                  class="text-txt-3 flex items-center gap-1.5 text-[11px] font-medium"
                >
                  <AppIcon
                    name="lucide:sparkles"
                    :size="12"
                    class="text-violet"
                    aria-hidden="true"
                  />
                  {{ t('AI 诊断') }}
                </p>
                <div
                  v-if="aiLoading"
                  class="mt-2 flex flex-col gap-1.5"
                  aria-hidden="true"
                >
                  <div class="skeleton h-2.5 w-full rounded-sm" />
                  <div class="skeleton h-2.5 w-5/6 rounded-sm" />
                  <div class="skeleton h-2.5 w-2/3 rounded-sm" />
                </div>
                <p
                  v-else
                  class="text-txt-2 mt-1.5 text-xs leading-relaxed whitespace-pre-wrap"
                >
                  {{ aiText }}
                </p>
              </section>
            </div>
          </div>

          <!-- 认证失败才出现；带密码重试仍失败时描边变红并给出文字提示 -->
          <div
            v-if="showPassword"
            ref="passwordWrap"
            class="mt-5"
            :class="passwordRejected && '[&_.field]:border-danger/60'"
          >
            <AppTextField
              v-model="password"
              type="password"
              :label="t('密码')"
              autocomplete="current-password"
              :placeholder="t('输入本次连接使用的密码')"
              :disabled="connecting"
            />
            <p
              v-if="passwordRejected"
              :id="hintId"
              class="text-danger mt-1.5 text-[11px]"
            >
              {{ t('密码未通过验证') }}
            </p>
          </div>

          <!-- 操作：主按钮用 aria-disabled，重连中焦点不会丢回 body -->
          <div
            class="mt-5 flex flex-wrap items-center gap-2 @max-[380px]/conn:flex-col @max-[380px]/conn:items-stretch"
          >
            <AppButton
              ref="primaryButton"
              variant="primary"
              class="min-h-8 aria-disabled:cursor-progress aria-disabled:opacity-60 @max-[380px]/conn:w-full"
              :aria-disabled="connecting || undefined"
              @click="submit"
            >
              <AppIcon
                v-if="connecting"
                name="lucide:loader-circle"
                :size="14"
                class="motion-safe:animate-spin"
                aria-hidden="true"
              />
              <AppIcon
                v-else-if="failedView"
                name="lucide:rotate-cw"
                :size="14"
                aria-hidden="true"
              />
              <AppIcon
                v-else
                name="lucide:plug"
                :size="14"
                aria-hidden="true"
              />
              {{
                connecting
                  ? t('正在连接…')
                  : failedView
                    ? t('重新连接')
                    : t('建立连接')
              }}
              <kbd
                v-if="!connecting"
                class="ml-1 rounded border border-white/25 px-1 font-mono text-[10px] leading-4 text-white/80 @max-[380px]/conn:hidden"
                aria-hidden="true"
                >↵</kbd
              >
            </AppButton>
            <AppButton
              v-if="connection"
              class="min-h-8 @max-[380px]/conn:w-full"
              @click="editConnection"
            >
              <AppIcon
                name="lucide:pencil"
                :size="13"
                aria-hidden="true"
              />
              {{ t('编辑连接') }}
            </AppButton>
            <AppButton
              v-if="canDiagnose"
              variant="ghost"
              class="min-h-8 aria-disabled:cursor-progress aria-disabled:opacity-60 @max-[380px]/conn:w-full"
              :title="t('发送错误信息与脱敏后的连接摘要（不含主机、用户名和密码）')"
              :aria-disabled="aiLoading || connecting || undefined"
              @click="diagnose"
            >
              <AppIcon
                v-if="aiLoading"
                name="lucide:loader-circle"
                :size="13"
                class="motion-safe:animate-spin"
                aria-hidden="true"
              />
              <AppIcon
                v-else
                name="lucide:sparkles"
                :size="13"
                class="text-violet"
                aria-hidden="true"
              />
              {{ t('AI 诊断') }}
            </AppButton>
            <span
              v-if="phase === 'retrying' && (elapsedText || cancellable)"
              class="text-txt-4 flex items-center gap-2 text-[11px] tabular-nums @max-[380px]/conn:justify-center"
            >
              <span
                v-if="elapsedText"
                :class="overdue && 'text-amber'"
                >{{ elapsedText }}</span
              >
              <AppButton
                v-if="cancellable"
                variant="ghost"
                size="sm"
                @click="cancel"
              >
                {{ t('取消') }}
              </AppButton>
            </span>
          </div>

          <!-- 原始错误：复制按钮独立于折叠开关，点复制不会触发展开 -->
          <div
            v-if="failedView"
            :class="phase === 'retrying' && 'stale-dim'"
          >
            <div class="border-line-soft mt-5 flex items-center gap-2 border-t pt-3">
              <button
                type="button"
                class="text-txt-3 hover:text-txt focus-visible:text-txt outline-accent flex h-7 items-center gap-1.5 rounded-sm text-[11px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                :aria-expanded="detailExpanded"
                :aria-controls="detailId"
                @click="toggleDetail"
              >
                <AppIcon
                  name="lucide:chevron-right"
                  :size="12"
                  class="transition-transform duration-150 motion-reduce:transition-none"
                  :class="detailExpanded && 'rotate-90'"
                  aria-hidden="true"
                />
                {{ t('原始错误') }}
              </button>
              <span
                v-if="info.code"
                class="bg-raised/60 text-txt-3 rounded px-1.5 font-mono text-[10px] leading-4"
                >{{ info.code }}</span
              >
              <IconButton
                class="ml-auto"
                icon="lucide:copy"
                :size="13"
                :title="t('复制错误信息')"
                @click="copyError"
              />
            </div>
            <div :id="detailId">
              <AppCollapse :open="detailExpanded">
                <pre
                  tabindex="0"
                  :aria-label="t('原始错误')"
                  class="scroll-thin border-line-soft bg-window/60 text-txt-2 focus-visible:outline-accent mt-2 max-h-48 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed wrap-anywhere whitespace-pre-wrap select-text focus-visible:outline-2 @max-[380px]/conn:max-h-40"
                  >{{ shownError }}</pre
                >
              </AppCollapse>
            </div>
          </div>
        </div>
        <div
          class="grow-[2]"
          aria-hidden="true"
        />
      </div>
    </Transition>
  </section>
</template>
