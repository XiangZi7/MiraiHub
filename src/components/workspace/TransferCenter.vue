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
import TransferPanelHeader, { type TransferPanelTab } from './transfer/TransferPanelHeader.vue'
import TransferTaskGroup from './transfer/TransferTaskGroup.vue'
import TransferStatusFilter, { type TransferStatusFilter as TransferFilter } from './transfer/TransferStatusFilter.vue'

interface TransferGroupView {
  key: string
  direction: FileTransferDirection
  connectionName: string
  tasks: FileTransferTask[]
}

const {
  tasks,
  activeTasks,
  pause,
  resume,
  cancel,
  pauseAll,
  resumeAll,
  clearSettled,
} = useFileTransfers()

const open = shallowRef(false)
const activeTab = shallowRef<TransferPanelTab>('transfers')
const statusFilter = shallowRef<TransferFilter>('all')
const triggerRoot = useTemplateRef<HTMLElement>('triggerRoot')
const panelRoot = useTemplateRef<HTMLElement>('panelRoot')
const now = useNow({ interval: 1000 })

const historyTasks = computed(() => tasks.filter(task => ['completed', 'error', 'cancelled'].includes(task.status)))
const tabTasks = computed(() => activeTab.value === 'history' ? historyTasks.value : [...tasks])
const statusCounts = computed<Record<TransferFilter, number>>(() => ({
  all: tabTasks.value.length,
  active: tabTasks.value.filter(task => ['queued', 'running', 'paused'].includes(task.status)).length,
  completed: tabTasks.value.filter(task => task.status === 'completed').length,
  failed: tabTasks.value.filter(task => task.status === 'error' || task.status === 'cancelled').length,
}))
const visibleTasks = computed(() => tabTasks.value.filter((task) => {
  if (statusFilter.value === 'active')
    return ['queued', 'running', 'paused'].includes(task.status)
  if (statusFilter.value === 'completed')
    return task.status === 'completed'
  if (statusFilter.value === 'failed')
    return task.status === 'error' || task.status === 'cancelled'
  return true
}))

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
  const current = [...tasks]
  const totalBytes = current.reduce((sum, task) => sum + task.totalBytes, 0)
  const transferredBytes = current.reduce((sum, task) => {
    if (!task.totalBytes)
      return sum + task.transferredBytes
    return sum + Math.min(task.transferredBytes, task.totalBytes)
  }, 0)
  const progress = totalBytes
    ? Math.min(100, Math.round(transferredBytes / totalBytes * 100))
    : current.length && current.every(task => task.status === 'completed') ? 100 : 0
  const startedAt = current.length ? Math.min(...current.map(task => task.createdAt)) : 0
  const elapsedSeconds = startedAt ? Math.max(1, (now.value.getTime() - startedAt) / 1000) : 0
  const rate = elapsedSeconds ? transferredBytes / elapsedSeconds : 0
  const remainingMs = rate > 0 && totalBytes > transferredBytes
    ? (totalBytes - transferredBytes) / rate * 1000
    : 0

  return { totalBytes, transferredBytes, progress, rate, remainingMs }
})

const canPause = computed(() => activeTasks.value.some(task => task.status === 'running'))
const canResume = computed(() => !canPause.value && activeTasks.value.some(task => task.status === 'paused'))

const statusLabel = computed(() => {
  const active = activeTasks.value
  if (!active.length)
    return tasks.length ? 'Complete' : 'Idle'
  if (!active.some(task => task.status === 'running'))
    return 'Paused'
  const directions = new Set(active.map(task => task.direction))
  if (directions.size > 1)
    return 'Transferring'
  return directions.has('upload') ? 'Uploading' : 'Downloading'
})

const footerSummary = computed(() => {
  const direction = new Set(tasks.map(task => task.direction))
  const prefix = direction.size === 1 && direction.has('upload')
    ? 'Upload'
    : direction.size === 1 && direction.has('download') ? 'Download' : 'Transfer'
  const total = aggregate.value.totalBytes ? formatBytes(aggregate.value.totalBytes) : 'Calculating'
  const rate = aggregate.value.rate ? formatRate(aggregate.value.rate) : '--'
  const remaining = aggregate.value.remainingMs ? ` • ${formatDuration(aggregate.value.remainingMs)} remaining` : ''
  return `${prefix}: ${formatBytes(aggregate.value.transferredBytes)} / ${total} • ${rate}${remaining}`
})

const emptyLabel = computed(() => {
  if (statusFilter.value === 'active')
    return '当前没有进行中的传输'
  if (statusFilter.value === 'completed')
    return '还没有已完成的传输'
  if (statusFilter.value === 'failed')
    return '当前没有错误或已取消的传输'
  return activeTab.value === 'history' ? '还没有传输历史' : '还没有文件传输'
})

watch(activeTab, () => {
  statusFilter.value = 'all'
})

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  const target = event.target as Node
  if (!open.value || triggerRoot.value?.contains(target) || panelRoot.value?.contains(target))
    return
  open.value = false
}, { capture: true })

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (open.value && event.key === 'Escape')
    open.value = false
})
</script>

<template>
  <div ref="triggerRoot" class="relative">
    <button
      type="button"
      class="icon-btn relative"
      title="File Transfer"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <AppIcon name="lucide:download" :size="15" />
      <span v-if="activeTasks.length" class="transfer-badge">{{ Math.min(activeTasks.length, 9) }}</span>
    </button>

    <Teleport to="body">
      <Transition name="transfer-center">
        <section
          v-if="open"
          ref="panelRoot"
          class="transfer-center"
          role="dialog"
          aria-label="File Transfer"
        >
          <TransferPanelHeader
            :tab="activeTab"
            :status-label="statusLabel"
            :progress="aggregate.progress"
            @close="open = false"
            @change-tab="activeTab = $event"
          />

          <TransferStatusFilter v-model="statusFilter" :counts="statusCounts" />

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

            <div v-if="!groups.length" class="transfer-empty">
              <AppIcon name="lucide:folder-clock" :size="25" />
              <p>{{ emptyLabel }}</p>
            </div>
          </div>

          <TransferPanelFooter
            :summary="footerSummary"
            :history="activeTab === 'history'"
            :can-pause="canPause"
            :can-resume="canResume"
            @pause-all="pauseAll"
            @resume-all="resumeAll"
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
  background: #4798ff;
  padding: 0 3px;
  color: #fff;
  font-size: 8px;
  line-height: 1;
}

.transfer-center {
  position: fixed;
  z-index: 110;
  top: 42px;
  right: 8px;
  display: flex;
  width: min(315px, calc(100vw - 16px));
  height: min(598px, calc(100vh - 50px));
  overflow: hidden;
  flex-direction: column;
  border: 1px solid rgb(255 255 255 / 11%);
  border-radius: 12px;
  background:
    linear-gradient(150deg, rgb(255 255 255 / 7%), transparent 38%),
    radial-gradient(circle at 18% 0%, rgb(60 138 190 / 16%), transparent 40%),
    rgb(10 14 19 / 80%);
  box-shadow: 0 24px 70px rgb(0 0 0 / 54%), inset 0 1px rgb(255 255 255 / 5%);
  backdrop-filter: blur(34px) saturate(165%);
  -webkit-backdrop-filter: blur(34px) saturate(165%);
}

.transfer-content {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 9px 10px 14px;
}

.transfer-empty {
  display: grid;
  min-height: 250px;
  place-items: center;
  align-content: center;
  gap: 9px;
  color: #58636c;
  font-size: 10.5px;
  text-align: center;
}

.transfer-center-enter-active,
.transfer-center-leave-active {
  transition: opacity 130ms ease, transform 130ms ease;
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
