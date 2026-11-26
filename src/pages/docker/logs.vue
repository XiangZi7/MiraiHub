<script setup lang="ts">
import { computed, onScopeDispose, reactive, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { containerLogs, streamContainerLogs } from '@/api/docker'
import { errorMessage } from '@/api/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import IconButton from '@/components/ui/IconButton.vue'
import DocumentWindowFrame from '@/components/ui/DocumentWindowFrame.vue'
import { translateNativeMessage } from '@/i18n/native'
import { useConnectionsStore } from '@/stores/connections'
import LogFilters from '@/pages/docker/components/log-filters.vue'
import { useContainerLogOutput } from '@/pages/docker/use-container-log-output'
import { isDockerConnection } from '@/types/connection'
import type { DockerLogFilter } from '@/types/docker'
import { dockerTargetFingerprint } from '@/utils/docker-target'
import { closeWindow, IS_TAURI } from '@/utils/window'

const props = defineProps<{
  connectionId: string
  containerId: string
  containerName?: string
}>()
const { t } = useI18n()
const connections = useConnectionsStore()
const profile = computed(() => {
  const saved = connections.find(props.connectionId)
  return saved && isDockerConnection(saved) ? saved : undefined
})
const target = computed(() =>
  profile.value
    ? dockerTargetFingerprint(profile.value, id => connections.find(id))
    : ''
)
const validIds = computed(
  () => Boolean(props.connectionId) && /^[a-f0-9]{64}$/i.test(props.containerId)
)
const name = computed(
  () => props.containerName || props.containerId.slice(0, 12)
)
const title = computed(() =>
  name.value ? t('容器“{name}”的日志', { name: name.value }) : t('容器日志')
)
const output = useContainerLogOutput()
const { content, truncated } = output
const filterBarId = useId()
const filters = reactive<DockerLogFilter>({ include: '', exclude: '' })
const hasRange = computed(
  () => filters.since !== undefined || filters.until !== undefined
)
const filtered = computed(() =>
  Boolean(filters.include || filters.exclude || hasRange.value)
)
const state = reactive({
  // 连接被编辑或删除后，当前窗口保持锁定以免误读不同主机的日志。
  changed: false,
  loading: false,
  error: '',
  filterOpen: false,
  mode: 'snapshot' as 'snapshot' | 'live' | 'paused' | 'ended',
})
const meta = computed(() =>
  [
    profile.value?.name,
    validIds.value ? props.containerId.slice(0, 12) : '',
    state.mode === 'snapshot' && !hasRange.value
      ? t('最近 200 行')
      : state.mode === 'ended'
        ? t('日志流已结束')
        : '',
    truncated.value ? t('较早输出已省略') : '',
  ]
    .filter(Boolean)
    .join(' · ')
)
let openedTarget = ''
let generation = 0
let stream: ReturnType<typeof streamContainerLogs> | undefined
let stopping = Promise.resolve()
let retryLive = false

/** 立即忽略旧快照和流片段，并在原生流回收后再允许同一窗口开启下一次订阅。 */
function cancelRead(): void {
  ++generation
  state.loading = false
  if (!stream) return
  const current = generation
  stopping = stream.stop().catch(error => {
    if (current === generation)
      state.error = translateNativeMessage(errorMessage(error))
  })
  stream = undefined
}

/** 配置变化时锁定窗口并清除旧内容。 */
function targetChanged(): void {
  cancelRead()
  output.clear()
  Object.assign(state, { changed: true, error: '', mode: 'paused' })
}
watch(target, current => {
  if (openedTarget && current !== openedTarget) targetChanged()
})

/** 无时段时读取最近 200 行；时段历史和实时输出均分块传输，并可中途取消。 */
async function read(live: boolean): Promise<void> {
  if (state.changed || !validIds.value) return
  cancelRead()
  output.flush()
  const current = generation
  retryLive = live
  state.mode = live ? 'live' : 'snapshot'
  state.loading = true
  state.error = ''
  try {
    await stopping
    if (current !== generation) return
    await connections.refresh()
    if (current !== generation) return
    if (openedTarget && openedTarget !== target.value) {
      targetChanged()
      return
    }
    const selected = profile.value
    if (!selected) throw new Error(t('找不到此日志窗口使用的 Docker 连接'))
    openedTarget = target.value
    if (!live && !hasRange.value) {
      const text = await containerLogs(
        selected.settings,
        props.containerId,
        selected.id
      )
      if (current === generation && openedTarget === target.value)
        output.write(text, true)
      return
    }
    let received = false
    stream = streamContainerLogs(
      selected.settings,
      props.containerId,
      selected.id,
      text => {
        if (!text || current !== generation || openedTarget !== target.value)
          return
        output.write(text, !received)
        received = true
      },
      { follow: live, since: filters.since, until: filters.until }
    )
    state.loading = !live
    await stream.done
    if (current !== generation) return
    if (!received) output.write('', true)
    state.mode = live ? 'ended' : 'snapshot'
  } catch (error) {
    if (current !== generation) return
    state.error = translateNativeMessage(errorMessage(error))
    if (live) state.mode = 'paused'
  } finally {
    if (current === generation) {
      output.flush()
      stream = undefined
      state.loading = false
    }
  }
}

/** 本地重筛缓存；涉及时间段时重新扫描引擎历史，收起筛选栏也保留生效条件。 */
function applyFilters(next: DockerLogFilter): void {
  const rangeChanged =
    next.since !== filters.since || next.until !== filters.until
  const wordsChanged =
    next.include !== filters.include || next.exclude !== filters.exclude
  if (!rangeChanged && !wordsChanged) return
  const live = state.mode === 'live'
  Object.assign(filters, next)
  if (rangeChanged || hasRange.value) {
    output.clear()
    output.setFilter(next.include, next.exclude)
    void read(live)
  } else {
    output.setFilter(next.include, next.exclude)
  }
}

/** 关闭实时读取时停在已收到的最后一行，再次打开时建立一条新的流。 */
function setLive(enabled: boolean): void {
  if (enabled) {
    void read(true)
    return
  }
  cancelRead()
  output.flush()
  state.mode = 'paused'
  state.error = ''
}

/** 参数变化时重新绑定窗口；关闭或卸载时释放流和延迟绘制回调。 */
watch(
  () => [props.connectionId, props.containerId],
  () => {
    cancelRead()
    openedTarget = ''
    output.clear()
    state.changed = false
    state.error = ''
    state.mode = 'snapshot'
    void read(false)
  },
  { immediate: true }
)
onScopeDispose(() => {
  cancelRead()
  output.clear()
})

/** 关闭当前日志子窗口。 */
function close(): void {
  cancelRead()
  if (IS_TAURI) closeWindow()
  else window.close()
}

useEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (state.filterOpen) state.filterOpen = false
  else close()
})
</script>

<template>
  <DocumentWindowFrame
    :title="title"
    :meta="meta"
    :close-action="close"
  >
    <template #actions>
      <!-- 日志筛选入口：已生效的筛选在收起工具栏后仍有提示。 -->
      <IconButton
        :icon="filtered ? 'lucide:list-filter-plus' : 'lucide:list-filter'"
        :title="filtered ? t('筛选日志（已启用）') : t('筛选日志')"
        :aria-expanded="state.filterOpen"
        :aria-controls="state.filterOpen ? filterBarId : undefined"
        class="focus-visible:ring-violet focus-visible:ring-2 focus-visible:outline-none"
        :class="
          (state.filterOpen || filtered) &&
          'bg-violet/12 text-violet hover:bg-violet/20 hover:text-violet'
        "
        :disabled="state.changed || !validIds"
        @click="state.filterOpen = !state.filterOpen"
      />
      <!-- 实时开关从当前容器接收新增输出；关闭后保留已读日志。 -->
      <AppSwitch
        :label="t('实时日志')"
        :model-value="state.mode === 'live'"
        :disabled="state.changed || !validIds"
        @update:model-value="setLive"
      />
      <!-- 刷新：仅重新读取当前容器，不请求容器列表。 -->
      <IconButton
        icon="lucide:refresh-cw"
        :title="t('刷新日志')"
        :size="14"
        :class="state.loading && '[&_svg]:motion-safe:animate-spin'"
        :disabled="state.loading || state.changed || !validIds"
        @click="read(state.mode === 'live')"
      />
    </template>
    <section
      class="bg-terminal flex min-h-0 flex-1 flex-col"
      :aria-busy="state.loading"
    >
      <p
        v-if="!validIds || state.changed"
        class="text-txt-2 m-auto px-5 text-center text-xs"
        role="alert"
      >
        {{
          !validIds
            ? t('日志窗口缺少有效的连接或容器 ID')
            : t(
                'Docker 连接已更改或删除，请关闭此窗口后从容器列表重新打开日志。'
              )
        }}
      </p>
      <template v-else>
        <!-- 当前容器的筛选栏在日期和关键词一起提交后更新结果。 -->
        <LogFilters
          v-if="state.filterOpen"
          :id="filterBarId"
          :filters="filters"
          @apply="applyFilters"
        />
        <div
          v-if="state.error"
          class="border-danger/25 bg-danger/8 text-txt-2 flex shrink-0 items-center gap-3 border-b px-3 py-2 text-xs"
          role="alert"
        >
          <span class="min-w-0 flex-1 break-words">{{ state.error }}</span>
          <!-- 重试：连接与容器保持原样。 -->
          <AppButton
            size="sm"
            :disabled="state.loading"
            @click="read(retryLive)"
            >{{ t('重试') }}</AppButton
          >
        </div>
        <pre
          v-if="content"
          ref="logViewport"
          @scroll.passive="output.onScroll"
          tabindex="0"
          class="text-txt scroll-thin min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap select-text"
          >{{ content }}</pre>
        <div
          v-else-if="state.loading"
          role="status"
          class="text-txt-3 m-auto flex items-center gap-2 text-xs"
        >
          <!-- 首次读取：在输出区域展示等待状态。 -->
          <AppIcon
            name="lucide:loader-circle"
            :size="14"
            class="motion-safe:animate-spin"
          />{{ t('正在加载…') }}
        </div>
        <p
          v-else-if="!state.error"
          class="text-txt-3 m-auto text-xs"
        >
          {{
            filtered
              ? t('没有符合筛选条件的日志')
              : state.mode === 'live'
                ? t('等待容器日志…')
                : t('该容器暂无日志')
          }}
        </p>
      </template>
    </section>
  </DocumentWindowFrame>
</template>
