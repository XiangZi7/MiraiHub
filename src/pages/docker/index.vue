<script setup lang="ts">
import { computed, onScopeDispose, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { containerAction, listContainers } from '@/api/docker'
import { errorMessage } from '@/api/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ContainerStatusChip from '@/pages/docker/components/container-status-chip.vue'
import { toast } from '@/composables/useToast'
import { useConnectionsStore } from '@/stores/connections'
import { endpointOf, isDockerConnection } from '@/types/connection'
import type { DockerContainer, DockerContainerAction } from '@/types/docker'
import { dockerTargetFingerprint } from '@/utils/docker-target'
import {
  openConnectionWindow,
  openDockerDetailsWindow,
  openDockerLogsWindow,
} from '@/utils/window'

const actions = [
  {
    id: 'start',
    icon: 'lucide:play',
    label: '启动容器',
    title: '启动容器“{name}”',
    success: '已启动容器“{name}”',
  },
  {
    id: 'stop',
    icon: 'lucide:square',
    label: '停止',
    title: '停止容器“{name}”',
    success: '已停止容器“{name}”',
  },
  {
    id: 'restart',
    icon: 'lucide:rotate-cw',
    label: '重启',
    title: '重启容器“{name}”',
    success: '已重启容器“{name}”',
  },
] as const

const { t, locale } = useI18n()
// 固定操作区后，再按剩余空间分配数据列。分组和平铺沿用同一组列宽存储键。
const dataColumns = [
  { name: 'name', label: '名称', minRem: 5.5, grouped: 0.21, flat: 0.25 },
  { name: 'composeService', label: '服务', minRem: 4, grouped: 0.15, flat: 0 },
  { name: 'image', label: '镜像', minRem: 5.5, grouped: 0.21, flat: 0.25 },
  { name: 'status', label: '状态', minRem: 5, grouped: 0.19, flat: 0.22 },
  { name: 'ports', label: '端口', minRem: 5.5, grouped: 0.24, flat: 0.28 },
] as const
type ColumnName = (typeof dataColumns)[number]['name'] | 'actions'
const route = useRoute()
const router = useRouter()
const connections = useConnectionsStore()
const profiles = computed(() => connections.items.filter(isDockerConnection))
const profileOptions = computed(() =>
  profiles.value.map(profile => ({
    value: profile.id,
    label: profile.name,
    description: endpointOf(profile),
  }))
)
const profile = computed(() =>
  route.name === 'docker'
    ? profiles.value.find(item => item.id === route.params.connectionId)
    : undefined
)
// 同一配置可在独立窗口中编辑。目标改变后，上一端点返回的容器不能继续操作。
const scope = computed(() =>
  profile.value
    ? dockerTargetFingerprint(profile.value, id => connections.find(id))
    : ''
)

// 响应式状态
const state = reactive({
  // 所选 Docker 连接返回的容器，手动刷新时保留现有行。
  containers: [] as DockerContainer[],
  // 当前连接的列表读取状态。
  loading: false,
  // 区分读取错误和已成功读取的空列表。
  failed: false,
  // 包含 Compose 项目的端点默认按项目展开，可随时切回平铺。
  groupProjects: true,
  // 只显示不健康、重启中、已退出或失效的容器。
  issuesOnly: false,
  // 折叠状态仅属于当前端点；空字符串代表独立容器组。
  collapsedProjects: new Set<string>(),
  // 首次打开按引擎返回的顺序展示，点击表头后按所选列排序。
  sortBy: undefined as Exclude<ColumnName, 'actions'> | undefined,
  descending: false,
  // 按连接与容器加锁，切换连接再返回也能避免重复提交。
  pending: new Map<string, DockerContainerAction>(),
})
const {
  containers,
  loading,
  failed,
  sortBy,
  descending,
  groupProjects,
  issuesOnly,
  collapsedProjects,
} = toRefs(state)
const collator = computed(
  () => new Intl.Collator(locale.value, { numeric: true, sensitivity: 'base' })
)
const hasProjects = computed(() =>
  state.containers.some(container => container.composeProject)
)
const grouped = computed(() => state.groupProjects && hasProjects.value)
const columns = computed(() => [
  ...dataColumns
    .filter(column => grouped.value || column.name !== 'composeService')
    .map(column => ({
      name: column.name,
      label: t(column.label),
      width: `max(${column.minRem}rem, calc((100cqw - var(--docker-actions-width) - 2px) * ${grouped.value ? column.grouped : column.flat}))`,
    })),
  {
    name: 'actions' as const,
    label: t('操作'),
    width: 'var(--docker-actions-width)',
    sortable: false,
  },
])

/** Docker 的清单在 Status 末尾返回括号形式的健康结果，不健康和退出均应可筛选。 */
function needsAttention(container: DockerContainer): boolean {
  return (
    ['exited', 'dead', 'restarting'].includes(container.state) ||
    /\(unhealthy\)/i.test(container.status)
  )
}

const rows = computed(() => {
  const containers = state.issuesOnly
    ? state.containers.filter(needsAttention)
    : state.containers
  const items = containers.map(container => ({
    container,
    activeAction: state.pending.get(`${profile.value?.id}/${container.id}`),
  }))
  const key = state.sortBy
  if (!key || (key === 'composeService' && !grouped.value)) return items
  const value = (row: DockerContainer) =>
    key === 'status' ? row.status || row.state : (row[key] ?? '')
  return items.sort(
    (a, b) =>
      (state.descending ? -1 : 1) *
      collator.value.compare(value(a.container), value(b.container))
  )
})

/** 用官方项目标签划分行组；分组顺序独立于表头排序，独立容器总在项目之后。 */
const groups = computed(() => {
  if (!grouped.value) return [{ project: '', rows: rows.value }]
  const byProject = new Map<string, typeof rows.value>()
  for (const row of rows.value) {
    const project = row.container.composeProject ?? ''
    const members = byProject.get(project)
    if (members) members.push(row)
    else byProject.set(project, [row])
  }
  return Array.from(byProject, ([project, rows]) => ({ project, rows })).sort(
    (a, b) => {
      if (!a.project) return 1
      if (!b.project) return -1
      return collator.value.compare(a.project, b.project)
    }
  )
})

/** 只改变所选项目的可见性，保留容器操作与引擎返回的行。 */
function toggleProject(project: string): void {
  if (state.collapsedProjects.has(project))
    state.collapsedProjects.delete(project)
  else state.collapsedProjects.add(project)
}

/** 首次点击列名以升序排列，再次点击同列反向。 */
function sortContainers(name: ColumnName): void {
  if (name === 'actions') return
  state.descending = state.sortBy === name && !state.descending
  state.sortBy = name
}
let listRequest = 0
let disposed = false

/** 通过路由同步当前连接、侧栏选中项与前进后退记录。 */
function selectProfile(id: string): void {
  void router.push({ name: 'docker', params: { connectionId: id } })
}

/** 读取当前列表，忽略切换连接或后续刷新前已经发出的旧请求。 */
async function refresh(): Promise<void> {
  const current = ++listRequest
  const selected = profile.value
  const target = scope.value
  state.loading = Boolean(selected)
  state.failed = false
  if (!selected) return
  try {
    const rows = await listContainers(selected.settings)
    if (current !== listRequest || scope.value !== target) return
    state.containers = rows
  } catch (error) {
    if (current !== listRequest || scope.value !== target) return
    state.failed = true
    toast.error({
      title: t('无法读取 Docker 容器'),
      description: errorMessage(error),
    })
  } finally {
    if (current === listRequest) state.loading = false
  }
}

/** 已停止的容器可启动，仍有进程的容器可停止，两类容器均支持重启。 */
function supportsAction(
  container: DockerContainer,
  action: DockerContainerAction
): boolean {
  const stopped = container.state === 'created' || container.state === 'exited'
  const running = ['running', 'paused', 'restarting'].includes(container.state)
  if (action === 'start') return stopped
  if (action === 'stop') return running
  return running || stopped
}

/** 容器操作始终使用点击时的连接与容器 ID，结束后从引擎重新读取实际状态。 */
async function runAction(
  container: DockerContainer,
  action: (typeof actions)[number]
): Promise<void> {
  const selected = profile.value
  if (
    !selected ||
    state.loading ||
    state.failed ||
    !supportsAction(container, action.id)
  )
    return
  const key = `${selected.id}/${container.id}`
  if (state.pending.has(key)) return
  const target = scope.value
  state.pending.set(key, action.id)
  try {
    await containerAction(selected.settings, container.id, action.id)
    if (!disposed && target === scope.value)
      toast.success(t(action.success, { name: container.name }))
  } catch (error) {
    if (!disposed && target === scope.value)
      toast.error({
        title: t('容器“{name}”操作失败', { name: container.name }),
        description: errorMessage(error),
      })
  } finally {
    if (!disposed && target === scope.value) await refresh()
    state.pending.delete(key)
  }
}

/** 在现有原生窗口框架中打开对应容器的日志或详情，列表保持当前位置。 */
async function openContainer(
  container: DockerContainer,
  view: 'logs' | 'details'
): Promise<void> {
  const selected = profile.value
  if (!selected) return
  try {
    const openWindow =
      view === 'logs' ? openDockerLogsWindow : openDockerDetailsWindow
    await openWindow(selected.id, container.id, container.name)
  } catch (error) {
    toast.error({
      title:
        view === 'logs' ? t('无法打开容器日志窗口') : t('无法打开容器详情窗口'),
      description: errorMessage(error),
    })
  }
}

watch(
  scope,
  () => {
    state.containers = []
    state.collapsedProjects.clear()
    void refresh()
  },
  { immediate: true }
)
onScopeDispose(() => {
  disposed = true
  listRequest++
})
</script>

<template>
  <main class="flex min-h-0 min-w-0 flex-1 p-2">
    <section
      class="pane @container min-w-0 flex-1"
      :aria-label="t('Docker 容器')"
    >
      <!-- 容器工具栏显示当前连接，连接选择器与左侧列表保持同步。 -->
      <header
        class="border-line-soft flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2"
      >
        <!-- 工作区图标与标题。 -->
        <div class="mr-auto flex shrink-0 items-center gap-2">
          <span
            class="bg-accent/10 text-accent grid size-7 place-items-center rounded-md"
          >
            <AppIcon
              name="lucide:container"
              :size="15"
            />
          </span>
          <h2 class="text-txt text-[13px] font-semibold">
            {{ t('Docker 容器') }}
          </h2>
          <span
            v-if="containers.length"
            class="bg-hover text-txt-2 rounded-full px-2 text-[11px] leading-5 tabular-nums"
          >
            {{
              issuesOnly
                ? rows.length + ' / ' + containers.length
                : containers.length
            }}
          </span>
        </div>
        <!-- 项目分组与状态筛选均作用于当前列表，切换时不重新请求引擎。 -->
        <div
          v-if="profile"
          role="group"
          :aria-label="t('容器视图')"
          class="bg-panel border-line-soft flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
        >
          <AppButton
            v-if="hasProjects"
            variant="ghost"
            size="sm"
            class="aria-pressed:bg-accent/15 aria-pressed:text-accent shrink-0 gap-1.5 focus-visible:z-10"
            :title="t('按 Compose 项目分组')"
            :aria-label="t('按 Compose 项目分组')"
            :aria-pressed="groupProjects"
            @click="groupProjects = !groupProjects"
          >
            <AppIcon
              name="lucide:layers"
              :size="14"
            />
            <span class="hidden @2xl:inline">{{
              t('按 Compose 项目分组')
            }}</span>
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            class="aria-pressed:bg-accent/15 aria-pressed:text-accent shrink-0 gap-1.5 focus-visible:z-10"
            :title="t('仅看异常或已退出')"
            :aria-label="t('仅看异常或已退出')"
            :aria-pressed="issuesOnly"
            @click="issuesOnly = !issuesOnly"
          >
            <AppIcon
              name="lucide:list-filter"
              :size="14"
            />
            <span class="hidden @2xl:inline">{{ t('仅看异常或已退出') }}</span>
          </AppButton>
        </div>
        <!-- 连接选择器只展示独立保存的 Docker 配置。 -->
        <AppSelect
          v-if="profileOptions.length"
          :model-value="profile?.id ?? ''"
          :options="profileOptions"
          :label="t('Docker 连接')"
          :placeholder="t('选择 Docker 连接')"
          icon="lucide:container"
          compact
          hide-label
          class="w-48 max-w-1/2"
          @update:model-value="selectProfile"
        />
        <!-- 刷新按钮重新读取当前引擎的容器列表。 -->
        <IconButton
          icon="lucide:refresh-cw"
          :title="t('刷新')"
          :disabled="!profile || loading"
          :class="loading && '[&_svg]:motion-safe:animate-spin'"
          @click="refresh"
        />
      </header>
      <!-- 内容区就地展示加载、错误、空状态和可逐行操作的容器列表。 -->
      <div
        class="scroll-thin flex min-h-0 flex-1 flex-col overflow-auto"
        :aria-busy="loading"
      >
        <div
          v-if="loading && !containers.length"
          role="status"
          class="text-txt-3 m-auto flex items-center gap-2 text-xs"
        >
          <!-- 正在从引擎读取首批容器。 -->
          <AppIcon
            name="lucide:loader-circle"
            class="motion-safe:animate-spin"
          />
          {{ t('正在加载…') }}
        </div>
        <!-- 提示选择已有 Docker 配置，或在首次使用时新建。 -->
        <AppEmptyState
          v-else-if="!profile"
          icon="lucide:container"
          class="m-auto"
          :title="
            profileOptions.length
              ? t('选择 Docker 连接以查看容器')
              : t('还没有已保存的 Docker 连接')
          "
        >
          <!-- 新建按钮打开 Docker 专用配置窗口。 -->
          <AppButton
            v-if="!profileOptions.length"
            size="sm"
            @click="openConnectionWindow('docker')"
            >{{ t('新建 Docker 连接') }}</AppButton
          >
        </AppEmptyState>
        <!-- 连接可重试，具体错误由公共通知展示。 -->
        <AppEmptyState
          v-else-if="failed"
          icon="lucide:circle-alert"
          :title="t('无法读取 Docker 容器')"
          class="m-auto"
        >
          <!-- 重试按钮沿用当前配置。 -->
          <AppButton
            size="sm"
            @click="refresh"
            >{{ t('重试') }}</AppButton
          >
        </AppEmptyState>
        <!-- 显示已经连接但尚未创建容器的状态。 -->
        <AppEmptyState
          v-else-if="!containers.length"
          icon="lucide:container"
          :title="t('此主机上没有 Docker 容器')"
          class="m-auto"
        />
        <!-- 当前端点有容器但全部通过健康筛选时，提供快捷的复位操作。 -->
        <AppEmptyState
          v-else-if="!rows.length"
          icon="lucide:list-filter"
          :title="t('没有异常或已退出的容器')"
          class="m-auto"
        >
          <AppButton
            size="sm"
            @click="issuesOnly = false"
            >{{ t('显示全部容器') }}</AppButton
          >
        </AppEmptyState>
        <!-- 沿用数据库表格的统一列宽、排序及表头，一个项目对应一个可独立折叠的行组。 -->
        <AppDataTable
          v-else
          :columns="columns"
          width-scope="docker:containers"
          :sort-by="sortBy"
          :descending="descending"
          class="docker-container-list [--docker-actions-width:9rem] @3xl:[--docker-actions-width:20.5rem]"
          @sort="sortContainers"
        >
          <template #body>
            <tbody
              v-for="group in groups"
              :key="group.project"
            >
              <tr
                v-if="grouped"
                class="bg-panel border-line-soft border-b"
              >
                <th
                  :colspan="columns.length"
                  scope="rowgroup"
                  class="text-txt-2 text-left font-medium"
                >
                  <!-- 展开按钮同时标注项目名称和当前筛选结果数，支持键盘切换。 -->
                  <AppButton
                    variant="bare"
                    class="hover:bg-hover focus-visible:outline-accent flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:-outline-offset-2"
                    :aria-expanded="!collapsedProjects.has(group.project)"
                    @click="toggleProject(group.project)"
                  >
                    <AppIcon
                      :name="
                        collapsedProjects.has(group.project)
                          ? 'lucide:chevron-right'
                          : 'lucide:chevron-down'
                      "
                      :size="12"
                    />
                    <AppIcon
                      :name="
                        group.project ? 'lucide:layers' : 'lucide:container'
                      "
                      :size="14"
                    />
                    <span class="truncate">{{
                      group.project || t('独立容器')
                    }}</span>
                    <span
                      class="bg-card text-txt-2 border-line-soft rounded-full border px-1.5 text-[10px] leading-4 tabular-nums"
                      >{{ group.rows.length }}</span
                    >
                  </AppButton>
                </th>
              </tr>
              <template
                v-if="!grouped || !collapsedProjects.has(group.project)"
              >
                <tr
                  v-for="{ container, activeAction } in group.rows"
                  :key="container.id"
                  class="border-line-soft even:bg-panel/40 hover:bg-hover/60 focus-within:bg-hover/60 border-b"
                  @dblclick="openContainer(container, 'details')"
                >
                  <th
                    scope="row"
                    class="text-txt border-line-soft border-r px-3 py-2 text-left font-mono font-medium wrap-anywhere"
                  >
                    {{ container.name }}
                  </th>
                  <td
                    v-if="grouped"
                    class="border-line-soft border-r px-3 py-2 font-mono wrap-anywhere"
                  >
                    {{
                      (container.composeProject && container.composeService) ||
                      '—'
                    }}
                  </td>
                  <td
                    class="border-line-soft border-r px-3 py-2 font-mono wrap-anywhere"
                  >
                    {{ container.image }}
                  </td>
                  <td class="border-line-soft border-r px-3 py-2 wrap-anywhere">
                    <ContainerStatusChip
                      :state="container.state"
                      :label="container.status || container.state"
                    />
                  </td>
                  <td
                    class="border-line-soft border-r px-3 py-2 font-mono wrap-anywhere"
                  >
                    {{ container.ports || '—' }}
                  </td>
                  <td
                    class="px-1 py-1"
                    @dblclick.stop
                  >
                    <!-- 行内操作组根据容器状态启用按钮，执行中的容器独立显示进度。 -->
                    <div
                      class="@container/row-actions flex flex-wrap items-center gap-0.5"
                    >
                      <AppButton
                        v-for="action in actions"
                        :key="action.id"
                        variant="ghost"
                          class="h-7 min-w-6 shrink-0 gap-1 px-1 py-1 text-[11px] whitespace-nowrap"
                        :class="
                          action.id === 'stop' &&
                          'enabled:hover:text-danger enabled:hover:bg-danger/10'
                        "
                        :disabled="
                          loading ||
                          Boolean(activeAction) ||
                          !supportsAction(container, action.id)
                        "
                        :title="t(action.title, { name: container.name })"
                        :aria-label="t(action.title, { name: container.name })"
                        @click="runAction(container, action)"
                      >
                        <!-- 状态图标标识启停、重启以及等待引擎结果。 -->
                        <AppIcon
                          :name="
                            activeAction === action.id
                              ? 'lucide:loader-circle'
                              : action.icon
                          "
                          :size="13"
                          :class="
                            activeAction === action.id &&
                            'motion-safe:animate-spin'
                          "
                        />
                        <span class="hidden @[19rem]/row-actions:inline">{{
                          t(action.label)
                        }}</span>
                      </AppButton>
                      <!-- 详情入口与双击容器行一致，窄窗口保留可访问的图标按钮。 -->
                      <AppButton
                        variant="ghost"
                          class="h-7 min-w-6 shrink-0 gap-1 px-1 py-1 text-[11px] whitespace-nowrap"
                        :title="
                          t('查看容器“{name}”的详情', { name: container.name })
                        "
                        :aria-label="
                          t('查看容器“{name}”的详情', { name: container.name })
                        "
                        @click="openContainer(container, 'details')"
                      >
                        <AppIcon
                          name="lucide:info"
                          :size="13"
                        />
                        <span class="hidden @[19rem]/row-actions:inline">{{
                          t('详情')
                        }}</span>
                      </AppButton>
                      <!-- 日志按钮打开独立窗口，可与容器列表同时查看。 -->
                      <AppButton
                        variant="ghost"
                          class="h-7 min-w-6 shrink-0 gap-1 px-1 py-1 text-[11px] whitespace-nowrap"
                        :title="
                          t('查看容器“{name}”的日志', { name: container.name })
                        "
                        :aria-label="
                          t('查看容器“{name}”的日志', { name: container.name })
                        "
                        @click="openContainer(container, 'logs')"
                      >
                        <!-- 容器日志入口图标。 -->
                        <AppIcon
                          name="lucide:scroll-text"
                          :size="13"
                        />
                        <span class="hidden @[19rem]/row-actions:inline">{{
                          t('日志')
                        }}</span>
                      </AppButton>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </template>
        </AppDataTable>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* 末列拖动柄仍保留完整命中宽度；抵住右边界时不撑开列表滚动区。 */
.docker-container-list :deep(thead th:last-child .column-resize-handle) {
  right: 0;
}
</style>
