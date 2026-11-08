<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEventListener, useIntervalFn, useStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, reactive, watch } from 'vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import * as database from '@/api/database'
import { toast } from '@/composables/useToast'
import type { KillMode, ServerSession } from '@/types/database-ops'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  close: []
  /** 把会话的 SQL 放进新查询标签 */
  openSql: [sql: string]
}>()

const INTERVALS = [2, 5, 10, 30] as const

// 自动刷新开关、间隔与“隐藏空闲”跨次打开保留
const prefs = useStorage('miraihub:db-session-monitor', {
  auto: true,
  interval: 5,
  hideIdle: false,
})

const state = reactive({
  loading: true,
  refreshing: false,
  error: '',
  notice: '',
  sessions: [] as ServerSession[],
  keyword: '',
  selectedId: null as number | null,
  flashId: null as number | null,
  updatedAt: 0,
  confirm: null as { target: ServerSession; mode: KillMode } | null,
  killing: false,
})

const intervalOptions = computed(() =>
  INTERVALS.map(value => ({
    value: String(value),
    label: t('{seconds} 秒', { seconds: value }),
  }))
)

const intervalModel = computed({
  get: () => String(prefs.value.interval),
  set: value => {
    prefs.value.interval = Number(value) || 5
  },
})

/** 判断会话是否处于空闲（MySQL Sleep / PostgreSQL idle） */
function isIdle(item: ServerSession): boolean {
  return (
    item.command.toLowerCase() === 'sleep' ||
    item.state.toLowerCase() === 'idle'
  )
}

// 阻塞者 id → 被它阻塞的会话 id 列表
const blockingMap = computed(() => {
  const map = new Map<number, number[]>()
  for (const item of state.sessions)
    for (const blocker of item.blockedBy)
      map.set(blocker, [...(map.get(blocker) ?? []), item.id])
  return map
})

const blockedCount = computed(
  () => state.sessions.filter(item => item.blockedBy.length).length
)

const filtered = computed(() => {
  const keyword = state.keyword.trim().toLowerCase()
  return state.sessions.filter(item => {
    // 参与阻塞链的会话即使空闲也保留，否则看不到持锁的源头
    const involved = item.blockedBy.length || blockingMap.value.has(item.id)
    if (prefs.value.hideIdle && isIdle(item) && !involved) return false
    if (!keyword) return true
    return [
      String(item.id),
      item.user,
      item.host,
      item.database,
      item.command,
      item.state,
      item.application,
      item.query,
    ].some(value => value.toLowerCase().includes(keyword))
  })
})

const selected = computed(
  () => state.sessions.find(item => item.id === state.selectedId) ?? null
)

/** 拉取会话快照；首次加载显示骨架，后续刷新保留旧数据 */
async function refresh(manual = false): Promise<void> {
  if (state.refreshing) return
  state.refreshing = true
  try {
    const snapshot = await database.listServerSessions(props.sessionId)
    state.sessions = snapshot.sessions
    state.notice = snapshot.notice ?? ''
    state.error = ''
    state.updatedAt = Date.now()
  } catch (error) {
    state.error = database.errorMessage(error)
    if (manual)
      toast.error({ title: t('读取会话失败'), description: state.error })
  } finally {
    state.loading = false
    state.refreshing = false
  }
}

const timer = useIntervalFn(
  () => void refresh(),
  computed(() => prefs.value.interval * 1000),
  { immediate: false }
)

// 自动刷新开关变化时启停定时器
watch(
  () => prefs.value.auto,
  auto => (auto ? timer.resume() : timer.pause()),
  { immediate: true }
)

onMounted(() => void refresh(true))

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  // 确认框打开时由它自己处理 Esc
  if (event.key === 'Escape' && !state.confirm) emit('close')
})

/** 毫秒时长格式化为紧凑文本 */
function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} m ${seconds % 60} s`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} m`
}

/** 活跃会话按耗时着色：超过 10 秒提示、超过 60 秒警告 */
function durationTone(item: ServerSession): string {
  if (isIdle(item) || !item.durationMs) return 'text-txt-3'
  if (item.durationMs >= 60_000) return 'text-danger'
  if (item.durationMs >= 10_000) return 'text-amber'
  return 'text-txt-2'
}

/** 行底色：被阻塞为红、阻塞别人为琥珀、选中为高亮 */
function rowClass(item: ServerSession): string {
  return cn(
    'border-line-soft cursor-pointer border-b transition-colors duration-100 motion-reduce:transition-none',
    item.blockedBy.length
      ? 'bg-danger/8 hover:bg-danger/12'
      : blockingMap.value.has(item.id)
        ? 'bg-amber/10 hover:bg-amber/15'
        : 'hover:bg-hover',
    state.selectedId === item.id && 'bg-raised',
    isIdle(item) && !blockingMap.value.has(item.id) && 'text-txt-4',
    state.flashId === item.id && 'motion-safe:grid-commit-flash'
  )
}

/** 沿阻塞链跳到目标会话：选中、滚动到可见并闪烁一次 */
async function focusSession(id: number): Promise<void> {
  if (!filtered.value.some(item => item.id === id)) {
    state.keyword = ''
    prefs.value.hideIdle = false
  }
  state.selectedId = id
  state.flashId = null
  await nextTick()
  state.flashId = id
  document
    .querySelector(`[data-session-row="${id}"]`)
    ?.scrollIntoView({ block: 'nearest' })
  window.setTimeout(() => {
    if (state.flashId === id) state.flashId = null
  }, 800)
}

/** 打开终止确认框 */
function askKill(target: ServerSession, mode: KillMode): void {
  state.confirm = { target, mode }
}

/** 执行取消语句或断开连接，完成后立即刷新 */
async function confirmKill(): Promise<void> {
  const current = state.confirm
  if (!current || state.killing) return
  state.killing = true
  try {
    const done = await database.killServerSession(
      props.sessionId,
      current.target.id,
      current.mode
    )
    if (done)
      toast.success(
        current.mode === 'query'
          ? t('已取消会话 {id} 的当前语句', { id: current.target.id })
          : t('已终止会话 {id}', { id: current.target.id })
      )
    else
      toast.warning({
        title: t('操作未生效'),
        description: t('会话可能已结束，或没有权限终止它'),
      })
    state.confirm = null
    await refresh()
  } catch (error) {
    toast.error({
      title: t('终止会话失败'),
      description: database.errorMessage(error),
    })
  } finally {
    state.killing = false
  }
}

const confirmTitle = computed(() =>
  state.confirm?.mode === 'query' ? t('取消当前语句？') : t('终止会话？')
)

const confirmDescription = computed(() => {
  const target = state.confirm?.target
  if (!target) return ''
  const who = `#${target.id} ${target.user}@${target.host}`
  return state.confirm?.mode === 'query'
    ? t('将中断会话 {who} 正在执行的语句，连接本身保留。', { who })
    : t('将断开会话 {who}，其未提交的事务会被回滚。', { who })
})

/** 复制选中会话的完整 SQL */
async function copySql(sql: string): Promise<void> {
  try {
    await copyText(sql)
    toast.success(t('已复制'))
  } catch (error) {
    toast.error({ title: t('复制失败'), description: String(error) })
  }
}
</script>

<template>
  <Transition
    name="fade"
    appear
  >
    <div class="bg-window glass absolute inset-0 z-50 flex flex-col">
      <header
        class="border-line-soft flex h-10 shrink-0 items-center gap-2 border-b px-3"
      >
        <AppIcon
          name="lucide:activity"
          :size="15"
          class="text-accent"
        />
        <span class="text-txt text-[12.5px] font-medium">{{
          t('会话监控')
        }}</span>
        <span class="text-txt-4 truncate font-mono text-[11px]">{{
          connectionName
        }}</span>
        <span class="text-txt-4 text-[11px]">{{
          t('{count} 个会话', { count: state.sessions.length })
        }}</span>
        <button
          v-if="blockedCount"
          type="button"
          class="bg-danger/12 text-danger hover:bg-danger/18 flex h-5 items-center gap-1 rounded px-1.5 text-[10.5px] transition-colors duration-100 motion-reduce:transition-none"
          :title="t('定位第一个被阻塞的会话')"
          @click="
            focusSession(state.sessions.find(item => item.blockedBy.length)!.id)
          "
        >
          <AppIcon
            name="lucide:lock"
            :size="11"
          />
          {{ t('{count} 个被阻塞', { count: blockedCount }) }}
        </button>
        <span class="flex-1" />
        <div class="w-52">
          <SearchField
            v-model="state.keyword"
            :placeholder="t('搜索用户、主机、SQL…')"
          />
        </div>
        <AppSwitch
          v-model="prefs.hideIdle"
          :label="t('隐藏空闲')"
        />
        <AppSwitch
          v-model="prefs.auto"
          :label="t('自动刷新')"
        />
        <div class="w-20">
          <AppSelect
            v-model="intervalModel"
            :label="t('刷新间隔')"
            :options="intervalOptions"
            :disabled="!prefs.auto"
            compact
            hide-label
          />
        </div>
        <IconButton
          icon="lucide:refresh-cw"
          :size="14"
          :title="t('刷新')"
          :disabled="state.refreshing"
          :class="state.refreshing && 'motion-safe:[&_svg]:animate-spin'"
          @click="refresh(true)"
        />
        <IconButton
          icon="lucide:x"
          :size="15"
          :title="t('关闭')"
          @click="emit('close')"
        />
      </header>

      <div
        v-if="state.notice || state.error"
        :class="
          cn(
            'flex shrink-0 items-start gap-2 border-b px-3 py-2 text-[11.5px]',
            state.error
              ? 'border-danger/25 bg-danger/8 text-danger'
              : 'border-amber/25 bg-amber/8 text-amber'
          )
        "
      >
        <AppIcon
          :name="state.error ? 'lucide:circle-x' : 'lucide:shield-alert'"
          :size="13"
          class="mt-px shrink-0"
        />
        <span class="min-w-0 flex-1 leading-4">{{
          state.error || state.notice
        }}</span>
      </div>

      <div
        v-if="state.loading"
        class="p-4"
      >
        <AppSkeleton :rows="8" />
      </div>

      <AppEmptyState
        v-else-if="!filtered.length"
        icon="lucide:activity"
        :title="state.sessions.length ? t('没有匹配的会话') : t('没有会话')"
        :description="
          state.sessions.length
            ? t('换个关键词，或关闭“隐藏空闲”')
            : t('当前账号可见的会话为空')
        "
      />

      <div
        v-else
        class="scroll-thin min-h-0 flex-1 overflow-auto"
      >
        <table class="w-full min-w-[960px] border-collapse text-[11.5px]">
          <thead
            class="bg-pane text-txt-4 sticky top-0 z-10 text-left text-[10.5px] font-medium"
          >
            <tr class="border-line-soft border-b">
              <th class="w-20 px-3 py-1.5 font-medium">ID</th>
              <th class="w-28 px-2 py-1.5 font-medium">{{ t('用户') }}</th>
              <th class="w-36 px-2 py-1.5 font-medium">{{ t('主机') }}</th>
              <th class="w-28 px-2 py-1.5 font-medium">{{ t('数据库') }}</th>
              <th class="w-24 px-2 py-1.5 font-medium">{{ t('命令') }}</th>
              <th class="w-40 px-2 py-1.5 font-medium">{{ t('状态') }}</th>
              <th class="w-20 px-2 py-1.5 text-right font-medium">
                {{ t('时长') }}
              </th>
              <th class="px-2 py-1.5 font-medium">SQL</th>
              <th class="w-16 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filtered"
              :key="item.id"
              :data-session-row="item.id"
              :class="rowClass(item)"
              @click="state.selectedId = item.id"
            >
              <td class="px-3 py-1.5 font-mono">
                <span class="flex items-center gap-1">
                  <AppIcon
                    v-if="item.blockedBy.length"
                    name="lucide:lock"
                    :size="11"
                    class="text-danger shrink-0"
                  />
                  <AppIcon
                    v-else-if="blockingMap.has(item.id)"
                    name="lucide:key-round"
                    :size="11"
                    class="text-amber shrink-0"
                  />
                  {{ item.id }}
                  <span
                    v-if="item.isSelf"
                    class="bg-accent/12 text-accent rounded px-1 font-sans text-[9.5px]"
                    >{{ t('本连接') }}</span
                  >
                </span>
              </td>
              <td class="max-w-28 truncate px-2 py-1.5">{{ item.user }}</td>
              <td
                class="max-w-36 truncate px-2 py-1.5 font-mono"
                :title="item.host"
              >
                {{ item.host }}
              </td>
              <td class="max-w-28 truncate px-2 py-1.5">
                {{ item.database || '—' }}
              </td>
              <td class="max-w-24 truncate px-2 py-1.5">{{ item.command }}</td>
              <td class="px-2 py-1.5">
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                  <span
                    class="max-w-36 truncate"
                    :title="item.state"
                    >{{ item.state || '—' }}</span
                  >
                  <button
                    v-for="blocker in item.blockedBy"
                    :key="blocker"
                    type="button"
                    class="bg-danger/14 text-danger hover:bg-danger/22 rounded px-1 text-[10px] transition-colors duration-100 motion-reduce:transition-none"
                    :title="t('跳到阻塞源')"
                    @click.stop="focusSession(blocker)"
                  >
                    {{ t('被 #{id} 阻塞', { id: blocker }) }}
                  </button>
                  <span
                    v-if="blockingMap.has(item.id)"
                    class="bg-amber/15 text-amber rounded px-1 text-[10px]"
                    >{{
                      t('阻塞 {count} 个', {
                        count: blockingMap.get(item.id)!.length,
                      })
                    }}</span
                  >
                </div>
              </td>
              <td
                :class="
                  cn(
                    'px-2 py-1.5 text-right font-mono tabular-nums',
                    durationTone(item)
                  )
                "
              >
                {{ formatDuration(item.durationMs) }}
              </td>
              <td
                class="text-txt-2 max-w-0 truncate px-2 py-1.5 font-mono"
                :title="item.query"
              >
                {{ item.query || '—' }}
              </td>
              <td class="px-2 py-1">
                <div class="flex items-center justify-end gap-0.5">
                  <IconButton
                    icon="lucide:circle-stop"
                    :size="13"
                    :title="
                      item.isSelf ? t('不能终止本连接') : t('取消当前语句')
                    "
                    :disabled="item.isSelf || !item.query"
                    @click.stop="askKill(item, 'query')"
                  />
                  <IconButton
                    icon="lucide:unplug"
                    :size="13"
                    class="hover:text-danger"
                    :title="item.isSelf ? t('不能终止本连接') : t('终止会话')"
                    :disabled="item.isSelf"
                    @click.stop="askKill(item, 'connection')"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 选中会话的详情：完整 SQL 与等待信息 -->
      <Transition name="slide-up">
        <section
          v-if="selected"
          class="border-line-soft bg-pane flex max-h-[40%] shrink-0 flex-col border-t"
        >
          <header class="flex h-8 shrink-0 items-center gap-2 px-3">
            <span class="text-txt text-[11.5px] font-medium">
              #{{ selected.id }} · {{ selected.user }}@{{ selected.host }}
            </span>
            <span
              v-if="selected.application"
              class="text-txt-4 truncate text-[11px]"
              >{{ selected.application }}</span
            >
            <span
              v-if="selected.waitEvent"
              class="text-amber truncate text-[11px]"
              >{{ t('等待：{event}', { event: selected.waitEvent }) }}</span
            >
            <span
              v-if="selected.transactionMs"
              class="text-txt-3 text-[11px]"
              >{{
                t('事务已持续 {duration}', {
                  duration: formatDuration(selected.transactionMs),
                })
              }}</span
            >
            <span class="flex-1" />
            <IconButton
              icon="lucide:copy"
              :size="13"
              :title="t('复制 SQL')"
              :disabled="!selected.query"
              @click="copySql(selected.query)"
            />
            <IconButton
              icon="lucide:square-terminal"
              :size="13"
              :title="t('在新查询中打开')"
              :disabled="!selected.query"
              @click="emit('openSql', selected.query)"
            />
            <IconButton
              icon="lucide:x"
              :size="13"
              :title="t('关闭详情')"
              @click="state.selectedId = null"
            />
          </header>
          <pre
            class="scroll-thin text-txt-2 min-h-12 overflow-auto px-3 pb-3 font-mono text-[11.5px] leading-5 break-all whitespace-pre-wrap"
            >{{ selected.query || t('（空闲，无正在执行的语句）') }}</pre
          >
        </section>
      </Transition>

      <footer
        class="border-line-soft text-txt-4 flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[10.5px]"
      >
        <span class="flex items-center gap-1">
          <span class="bg-danger/40 size-2 rounded-sm" />{{ t('被阻塞') }}
        </span>
        <span class="flex items-center gap-1">
          <span class="bg-amber/50 size-2 rounded-sm" />{{ t('阻塞源') }}
        </span>
        <span class="flex-1" />
        <span v-if="state.updatedAt">{{
          t('更新于 {time}', {
            time: new Date(state.updatedAt).toLocaleTimeString(),
          })
        }}</span>
      </footer>

      <AppConfirmDialog
        :open="!!state.confirm"
        :title="confirmTitle"
        :description="confirmDescription"
        :confirm-label="
          state.confirm?.mode === 'query' ? t('取消语句') : t('终止会话')
        "
        danger
        @close="state.confirm = null"
        @confirm="confirmKill"
      >
        <pre
          v-if="state.confirm?.target.query"
          class="bg-raised text-txt-3 scroll-thin mt-2 max-h-24 overflow-auto rounded px-2 py-1.5 font-mono text-[10.5px] break-all whitespace-pre-wrap"
          >{{ state.confirm.target.query }}</pre
        >
      </AppConfirmDialog>
    </div>
  </Transition>
</template>
