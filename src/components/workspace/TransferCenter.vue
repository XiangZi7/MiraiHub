<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useFileTransfers, type FileTransferTask } from '@/composables/useFileTransfers'
import { formatBytes } from '@/utils/format'

type TransferTab = 'active' | 'completed' | 'failed'

const {
  activeTasks,
  completedTasks,
  failedTasks,
  pause,
  resume,
  cancel,
  clearSettled,
} = useFileTransfers()

const open = shallowRef(false)
const activeTab = shallowRef<TransferTab>('active')
const root = useTemplateRef<HTMLElement>('root')

const tabs = computed(() => [
  { id: 'active' as const, label: '进行中', count: activeTasks.value.length },
  { id: 'completed' as const, label: '已完成', count: completedTasks.value.length },
  { id: 'failed' as const, label: '错误', count: failedTasks.value.length },
])

const visibleTasks = computed(() => {
  if (activeTab.value === 'completed')
    return completedTasks.value
  if (activeTab.value === 'failed')
    return failedTasks.value
  return activeTasks.value
})

const emptyLabel = computed(() => {
  if (activeTab.value === 'completed')
    return '还没有完成的传输'
  if (activeTab.value === 'failed')
    return '没有错误或已取消的任务'
  return '当前没有传输任务'
})

function progressOf(task: FileTransferTask): number {
  if (!task.totalBytes)
    return task.status === 'completed' ? 100 : 0
  return Math.min(100, Math.round(task.transferredBytes / task.totalBytes * 100))
}

function statusLabel(task: FileTransferTask): string {
  const labels: Record<FileTransferTask['status'], string> = {
    queued: '等待中',
    running: task.direction === 'upload' ? '正在上传' : '正在下载',
    paused: '已暂停',
    completed: '已完成',
    error: '失败',
    cancelled: '已取消',
  }
  return labels[task.status]
}

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (open.value && !root.value?.contains(event.target as Node))
    open.value = false
}, { capture: true })

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (open.value && event.key === 'Escape')
    open.value = false
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="icon-btn relative"
      title="传输中心"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <AppIcon name="lucide:download" :size="15" />
      <span v-if="activeTasks.length" class="transfer-badge">{{ Math.min(activeTasks.length, 9) }}</span>
    </button>

    <Transition name="transfer-center">
      <section v-if="open" class="transfer-center" role="dialog" aria-label="文件传输中心">
        <header class="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
          <div class="grid size-7 place-items-center rounded-lg bg-violet/12 text-violet">
            <AppIcon name="lucide:arrow-up-down" :size="15" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="text-xs font-semibold text-txt">文件传输</h2>
            <p class="text-[10px] text-txt-4">上传与下载任务</p>
          </div>
          <button
            v-if="completedTasks.length || failedTasks.length"
            type="button"
            class="text-[10px] text-txt-3 hover:text-txt"
            @click="clearSettled"
          >
            清除记录
          </button>
        </header>

        <div class="flex h-9 items-end gap-1 border-b border-line-soft px-2" role="tablist" aria-label="传输状态">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :class="['transfer-tab', activeTab === tab.id && 'transfer-tab-active']"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
            <span class="tab-count">{{ tab.count }}</span>
          </button>
        </div>

        <div class="max-h-90 min-h-32 overflow-y-auto p-1.5 scroll-thin">
          <article
            v-for="task in visibleTasks"
            :key="task.id"
            class="transfer-task"
          >
            <div :class="['transfer-direction', task.direction === 'upload' ? 'text-violet' : 'text-cyan']">
              <AppIcon :name="task.direction === 'upload' ? 'lucide:upload' : 'lucide:download'" :size="14" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="min-w-0 flex-1 truncate text-[11.5px] font-medium text-txt" :title="task.fileName">
                  {{ task.fileName }}
                </p>
                <span :class="['shrink-0 text-[9.5px]', task.status === 'error' ? 'text-danger' : 'text-txt-3']">
                  {{ statusLabel(task) }}
                </span>
              </div>
              <p class="mt-0.5 truncate text-[9.5px] text-txt-4" :title="`${task.source} → ${task.target}`">
                {{ task.connectionName || task.target }}
              </p>

              <div v-if="['queued', 'running', 'paused'].includes(task.status)" class="mt-2">
                <div class="h-1 overflow-hidden rounded-full bg-raised">
                  <div class="transfer-progress" :style="{ width: `${progressOf(task)}%` }" />
                </div>
                <div class="mt-1 flex items-center gap-2 text-[9px] text-txt-4">
                  <span>{{ formatBytes(task.transferredBytes) }} / {{ task.totalBytes ? formatBytes(task.totalBytes) : '计算中' }}</span>
                  <span class="flex-1" />
                  <span>{{ progressOf(task) }}%</span>
                </div>
              </div>

              <p v-if="task.error" class="mt-1 truncate text-[9.5px] text-danger" :title="task.error">
                {{ task.error }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-0.5">
              <IconButton
                v-if="task.status === 'running'"
                icon="lucide:pause"
                :size="12"
                title="暂停"
                @click="pause(task.id)"
              />
              <IconButton
                v-else-if="task.status === 'paused'"
                icon="lucide:play"
                :size="12"
                title="继续"
                @click="resume(task.id)"
              />
              <IconButton
                v-if="['queued', 'running', 'paused'].includes(task.status)"
                icon="lucide:x"
                :size="12"
                title="取消"
                @click="cancel(task.id)"
              />
            </div>
          </article>

          <div v-if="!visibleTasks.length" class="grid min-h-29 place-items-center text-center">
            <div>
              <AppIcon name="lucide:inbox" :size="22" class="mx-auto text-txt-4" />
              <p class="mt-2 text-[11px] text-txt-4">{{ emptyLabel }}</p>
            </div>
          </div>
        </div>
      </section>
    </Transition>
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
  background: var(--color-violet);
  padding: 0 3px;
  color: white;
  font-size: 8px;
  line-height: 1;
}

.transfer-center {
  position: absolute;
  z-index: 90;
  top: calc(100% + 8px);
  right: -8px;
  width: min(390px, calc(100vw - 24px));
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
  border-radius: 11px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(28px) saturate(170%);
}

.transfer-tab {
  display: flex;
  height: 31px;
  cursor: pointer;
  align-items: center;
  gap: 5px;
  border-bottom: 2px solid transparent;
  padding: 0 8px;
  color: var(--color-txt-3);
  font-size: 10.5px;
  outline: none;
}

.transfer-tab:hover,
.transfer-tab:focus-visible {
  color: var(--color-txt);
}

.transfer-tab-active {
  border-bottom-color: var(--color-violet);
  color: var(--color-txt);
}

.tab-count {
  min-width: 16px;
  border-radius: 999px;
  background: var(--color-raised);
  padding: 0 4px;
  color: var(--color-txt-3);
  font-size: 8.5px;
  line-height: 16px;
  text-align: center;
}

.transfer-task {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-radius: 7px;
  padding: 8px;
}

.transfer-task:hover {
  background: var(--color-hover);
}

.transfer-direction {
  display: grid;
  width: 27px;
  height: 27px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 7px;
  background: var(--color-raised);
}

.transfer-progress {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--color-indigo), var(--color-violet));
  transition: width 180ms ease;
}

.transfer-center-enter-active,
.transfer-center-leave-active {
  transition: opacity 130ms ease, transform 130ms ease;
  transform-origin: top right;
}

.transfer-center-enter-from,
.transfer-center-leave-to {
  transform: translateY(-5px) scale(0.985);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-progress,
  .transfer-center-enter-active,
  .transfer-center-leave-active {
    transition: none;
  }
}
</style>
