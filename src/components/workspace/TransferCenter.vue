<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener, useNow } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  useFileTransfers,
  type FileTransferDirection,
  type FileTransferTask,
} from '@/composables/useFileTransfers'
import { formatBytes, formatRate } from '@/utils/format'
import { formatDuration } from '@/utils/time'
import TransferPanelFooter from './transfer/TransferPanelFooter.vue'
import TransferPanelHeader from './transfer/TransferPanelHeader.vue'
import TransferTaskGroup from './transfer/TransferTaskGroup.vue'
import TransferStatusFilter, {
  type TransferStatusFilter as TransferFilter,
} from './transfer/TransferStatusFilter.vue'

interface TransferGroupView {
  key: string
  direction: FileTransferDirection
  connectionName: string
  tasks: FileTransferTask[]
}

const ACTIVE_STATUSES = ['queued', 'running', 'paused']

const {
  tasks,
  activeTasks,
  unreadCount,
  hasUnreadError,
  markAllSeen,
  pause,
  resume,
  cancel,
  pauseAll,
  resumeAll,
  cancelAll,
  clearSettled,
} = useFileTransfers()

const open = shallowRef(false)
const statusFilter = shallowRef<TransferFilter>('all')
const triggerRoot = useTemplateRef<HTMLElement>('triggerRoot')
const panelRoot = useTemplateRef<HTMLElement>('panelRoot')
const now = useNow({ interval: 1000 })

const isActive = (task: FileTransferTask) =>
  ACTIVE_STATUSES.includes(task.status)
const isFailed = (task: FileTransferTask) =>
  task.status === 'error' || task.status === 'cancelled'

const statusCounts = computed<Record<TransferFilter, number>>(() => ({
  all: tasks.length,
  active: tasks.filter(isActive).length,
  completed: tasks.filter(task => task.status === 'completed').length,
  failed: tasks.filter(isFailed).length,
}))
const visibleTasks = computed(() =>
  tasks.filter(task => {
    if (statusFilter.value === 'active') return isActive(task)
    if (statusFilter.value === 'completed') return task.status === 'completed'
    if (statusFilter.value === 'failed') return isFailed(task)
    return true
  })
)

const groups = computed<TransferGroupView[]>(() => {
  const byConnection = new Map<string, TransferGroupView>()

  for (const task of visibleTasks.value) {
    const connectionName = task.connectionName || 'Remote server'
    const key = `${task.direction}:${connectionName}`
    const existing = byConnection.get(key)
    if (existing) {
      existing.tasks.push(task)
      continue
    }
    byConnection.set(key, {
      key,
      direction: task.direction,
      connectionName,
      tasks: [task],
    })
  }

  return [...byConnection.values()]
})

const aggregate = computed(() => {
  const current = activeTasks.value.length ? [...activeTasks.value] : [...tasks]
  const totalBytes = current.reduce((sum, task) => sum + task.totalBytes, 0)
  const transferredBytes = current.reduce((sum, task) => {
    if (!task.totalBytes) return sum + task.transferredBytes
    return sum + Math.min(task.transferredBytes, task.totalBytes)
  }, 0)
  const progress = totalBytes
    ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
    : current.length && current.every(task => task.status === 'completed')
      ? 100
      : 0
  const startedAt = current.length
    ? Math.min(...current.map(task => task.createdAt))
    : 0
  const elapsedSeconds = startedAt
    ? Math.max(1, (now.value.getTime() - startedAt) / 1000)
    : 0
  const rate = elapsedSeconds ? transferredBytes / elapsedSeconds : 0
  const remainingMs =
    rate > 0 && totalBytes > transferredBytes
      ? ((totalBytes - transferredBytes) / rate) * 1000
      : 0

  return { totalBytes, transferredBytes, progress, rate, remainingMs }
})

const canPause = computed(() =>
  activeTasks.value.some(task => task.status === 'running')
)
const canResume = computed(
  () =>
    !canPause.value && activeTasks.value.some(task => task.status === 'paused')
)
const canCancel = computed(() => activeTasks.value.length > 0)
const canClear = computed(() => tasks.some(task => !isActive(task)))

const status = computed<{ label: string; icon: string; busy: boolean }>(() => {
  const active = activeTasks.value
  if (!active.length) {
    if (tasks.some(task => task.status === 'error'))
      return { label: 'Failed', icon: 'lucide:circle-alert', busy: false }
    if (tasks.some(task => task.status === 'cancelled'))
      return { label: 'Cancelled', icon: 'lucide:circle-x', busy: false }
    return tasks.length
      ? { label: 'Complete', icon: 'lucide:circle-check', busy: false }
      : { label: 'Idle', icon: 'lucide:moon', busy: false }
  }
  if (!active.some(task => task.status === 'running'))
    return active.some(task => task.status === 'queued')
      ? { label: 'Queued', icon: 'lucide:clock', busy: false }
      : { label: 'Paused', icon: 'lucide:pause', busy: false }
  const directions = new Set(active.map(task => task.direction))
  if (directions.size > 1)
    return { label: 'Transferring', icon: 'lucide:loader-circle', busy: true }
  return directions.has('upload')
    ? { label: 'Uploading', icon: 'lucide:loader-circle', busy: true }
    : { label: 'Downloading', icon: 'lucide:loader-circle', busy: true }
})

const footerSummary = computed(() => {
  const total = aggregate.value.totalBytes
    ? formatBytes(aggregate.value.totalBytes)
    : activeTasks.value.length
      ? '--'
      : formatBytes(0)
  const rate = aggregate.value.rate ? formatRate(aggregate.value.rate) : '--'
  const remaining = aggregate.value.remainingMs
    ? ` · 剩余 ${formatDuration(aggregate.value.remainingMs)}`
    : ''
  return `${formatBytes(aggregate.value.transferredBytes)} / ${total} · ${rate}${remaining}`
})

const emptyLabel = computed(() => {
  if (statusFilter.value === 'active') return '当前没有进行中的传输'
  if (statusFilter.value === 'completed') return '还没有已完成的传输'
  if (statusFilter.value === 'failed') return '当前没有错误或已取消的传输'
  return '还没有文件传输'
})

watch([open, unreadCount], ([visible]) => {
  if (visible) markAllSeen()
})

useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    const target = event.target as Node
    if (
      !open.value ||
      triggerRoot.value?.contains(target) ||
      panelRoot.value?.contains(target)
    )
      return
    open.value = false
  },
  { capture: true }
)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (open.value && event.key === 'Escape') open.value = false
})
</script>

<template>
  <div
    ref="triggerRoot"
    class="relative"
  >
    <button
      type="button"
      class="icon-btn relative"
      :title="
        hasUnreadError
          ? '文件传输：有失败的任务'
          : unreadCount
            ? '文件传输：有新的传输结果'
            : '文件传输'
      "
      aria-label="文件传输"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <AppIcon
        name="lucide:download"
        :size="15"
      />
      <span
        v-if="activeTasks.length"
        :class="['transfer-badge', hasUnreadError && 'transfer-badge-error']"
        >{{ Math.min(activeTasks.length, 9) }}</span
      >
      <span
        v-else-if="unreadCount"
        :class="['transfer-unread', hasUnreadError && 'transfer-badge-error']"
        aria-hidden="true"
      />
    </button>

    <Teleport to="body">
      <Transition name="transfer-center">
        <section
          v-if="open"
          ref="panelRoot"
          class="overlay-surface transfer-center"
          role="dialog"
          aria-label="File Transfer"
        >
          <TransferPanelHeader
            :status-label="status.label"
            :status-icon="status.icon"
            :busy="status.busy"
            :progress="aggregate.progress"
            @close="open = false"
          />

          <TransferStatusFilter
            v-model="statusFilter"
            :counts="statusCounts"
          />

          <div class="transfer-content scroll-thin">
            <TransferTaskGroup
              v-for="group in groups"
              :key="group.key"
              :direction="group.direction"
              :connection-name="group.connectionName"
              :tasks="group.tasks"
              @pause="pause"
              @resume="resume"
              @cancel="cancel"
            />

            <div
              v-if="!groups.length"
              class="transfer-empty"
            >
              <AppIcon
                name="lucide:folder-clock"
                :size="24"
              />
              <p>{{ emptyLabel }}</p>
            </div>
          </div>

          <TransferPanelFooter
            :summary="footerSummary"
            :can-pause="canPause"
            :can-resume="canResume"
            :can-cancel="canCancel"
            :can-clear="canClear"
            @pause-all="pauseAll"
            @resume-all="resumeAll"
            @cancel-all="cancelAll"
            @clear-history="clearSettled"
          />
        </section>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.transfer-badge {
  position: absolute;
  top: -2px;
  right: -3px;
  display: grid;
  min-width: 14px;
  height: 14px;
  place-items: center;
  border: 1px solid var(--color-panel);
  border-radius: 999px;
  background: var(--color-blue);
  padding: 0 3px;
  color: #fff;
  font-size: 8px;
  line-height: 1;
}

.transfer-unread {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
}

.transfer-badge-error {
  background: var(--color-danger);
}

.transfer-center {
  position: fixed;
  z-index: 110;
  top: 42px;
  right: 8px;
  display: flex;
  width: min(420px, calc(100vw - 16px));
  height: min(560px, calc(100vh - 50px));
  overflow: hidden;
  flex-direction: column;
}

.transfer-content {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px 6px 10px;
}

.transfer-empty {
  display: grid;
  min-height: 240px;
  height: 100%;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--color-txt-3);
  font-size: 10.5px;
  text-align: center;
}

.transfer-center-enter-active,
.transfer-center-leave-active {
  transition:
    opacity 130ms ease,
    transform 130ms ease;
  transform-origin: top right;
}

.transfer-center-enter-from,
.transfer-center-leave-to {
  transform: translateY(-4px) scale(0.988);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-center-enter-active,
  .transfer-center-leave-active {
    transition: none;
  }
}
</style>
