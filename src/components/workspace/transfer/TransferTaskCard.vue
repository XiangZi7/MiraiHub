<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { FileTransferTask } from '@/composables/useFileTransfers'
import { formatBytes } from '@/utils/format'

const props = defineProps<{
  task: Readonly<FileTransferTask>
}>()

const emit = defineEmits<{
  pause: [taskId: string]
  resume: [taskId: string]
  cancel: [taskId: string]
}>()

const progress = computed(() => {
  if (!props.task.totalBytes)
    return props.task.status === 'completed' ? 100 : 0
  return Math.min(100, Math.round(props.task.transferredBytes / props.task.totalBytes * 100))
})

const displayPath = computed(() => {
  const path = props.task.direction === 'upload' ? props.task.target : props.task.source
  const normalized = path.replaceAll('\\', '/')
  const separator = normalized.lastIndexOf('/')
  if (separator === 0)
    return '/'
  return separator > 0 ? normalized.slice(0, separator) : normalized
})

const fileIcon = computed(() => {
  const extension = props.task.fileName.split('.').at(-1)?.toLowerCase()
  return extension && ['zip', 'tar', 'gz', '7z', 'rar'].includes(extension)
    ? 'lucide:file-archive'
    : 'lucide:file-text'
})

const progressTone = computed(() => {
  if (props.task.status === 'completed')
    return 'transfer-progress-complete'
  if (props.task.status === 'error' || props.task.status === 'cancelled')
    return 'transfer-progress-error'
  return 'transfer-progress-active'
})

const sizeLabel = computed(() => {
  const current = formatBytes(props.task.transferredBytes)
  return props.task.totalBytes ? `${current} / ${formatBytes(props.task.totalBytes)}` : `${current} / Calculating`
})
</script>

<template>
  <article class="transfer-file">
    <div class="transfer-file-icon" aria-hidden="true">
      <AppIcon :name="fileIcon" :size="17" />
    </div>

    <div class="transfer-file-main">
      <p class="transfer-file-name" :title="task.fileName">{{ task.fileName }}</p>
      <p
        :class="['transfer-file-path', task.error && 'transfer-file-error']"
        :title="task.error || displayPath"
      >
        {{ task.error || displayPath }}
      </p>
      <div class="transfer-file-meta">
        <span>{{ sizeLabel }}</span>
        <span>{{ progress }}%</span>
      </div>
      <div class="transfer-file-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
        <div :class="['transfer-file-progress', progressTone]" :style="{ width: `${progress}%` }" />
      </div>
    </div>

    <div class="transfer-file-actions">
      <button
        v-if="task.status === 'running'"
        type="button"
        class="transfer-action"
        title="Pause"
        aria-label="Pause transfer"
        @click="emit('pause', task.id)"
      >
        <AppIcon name="lucide:pause" :size="13" />
      </button>
      <button
        v-else-if="task.status === 'paused'"
        type="button"
        class="transfer-action"
        title="Resume"
        aria-label="Resume transfer"
        @click="emit('resume', task.id)"
      >
        <AppIcon name="lucide:play" :size="13" />
      </button>
      <span v-else-if="task.status === 'completed'" class="transfer-result transfer-result-success" title="Completed">
        <AppIcon name="lucide:circle-check" :size="14" />
      </span>
      <span v-else-if="task.status === 'error'" class="transfer-result transfer-result-error" title="Failed">
        <AppIcon name="lucide:circle-alert" :size="14" />
      </span>
      <span v-else-if="task.status === 'cancelled'" class="transfer-result transfer-result-cancelled" title="Cancelled">
        <AppIcon name="lucide:circle-x" :size="14" />
      </span>

      <button
        v-if="['queued', 'running', 'paused'].includes(task.status)"
        type="button"
        class="transfer-action transfer-action-cancel"
        title="Cancel"
        aria-label="Cancel transfer"
        @click="emit('cancel', task.id)"
      >
        <AppIcon name="lucide:x" :size="14" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.transfer-file {
  position: relative;
  display: grid;
  min-height: 64px;
  grid-template-columns: 31px minmax(0, 1fr) auto;
  column-gap: 9px;
  border: 1px solid rgb(255 255 255 / 1.8%);
  border-radius: 7px;
  background: linear-gradient(105deg, rgb(255 255 255 / 3.2%), rgb(255 255 255 / 1.2%));
  box-shadow: 0 3px 12px rgb(0 0 0 / 12%);
  padding: 8px 9px 7px 14px;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.transfer-file:hover {
  border-color: rgb(255 255 255 / 6%);
  background-color: rgb(255 255 255 / 2%);
}

.transfer-file-icon {
  display: grid;
  width: 22px;
  height: 27px;
  margin-top: 8px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 38%);
  border-radius: 3px;
  background: linear-gradient(145deg, #eef2f4, #c9cfd3);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 35%);
  color: #86919a;
}

.transfer-file-main {
  min-width: 0;
}

.transfer-file-name,
.transfer-file-path,
.transfer-file-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-file-name {
  color: #eef1f3;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 14px;
}

.transfer-file-path {
  color: #68727b;
  font-size: 9px;
  line-height: 12px;
}

.transfer-file-meta {
  display: flex;
  justify-content: space-between;
  color: #828c95;
  font-size: 8.5px;
  line-height: 12px;
}

.transfer-file-track {
  height: 3px;
  overflow: hidden;
  margin-top: 1px;
  border-radius: 999px;
  background: #181d21;
}

.transfer-file-progress {
  height: 100%;
  border-radius: inherit;
  transition: width 180ms ease;
}

.transfer-progress-active {
  background: linear-gradient(90deg, #3985ff, #4f9dff);
}

.transfer-progress-complete {
  background: linear-gradient(90deg, #18c77a, #36dc91);
}

.transfer-progress-error {
  background: #e15b64;
}

.transfer-file-error {
  color: #e66c75;
}

.transfer-file-actions {
  display: flex;
  min-width: 39px;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding-top: 21px;
}

.transfer-action,
.transfer-result {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 4px;
}

.transfer-action {
  cursor: pointer;
  color: #9aa4ac;
  outline: none;
  transition: color 150ms ease, background-color 150ms ease;
}

.transfer-action:hover,
.transfer-action:focus-visible {
  background: rgb(255 255 255 / 6%);
  color: #eef2f4;
}

.transfer-action-cancel {
  color: #84ded2;
}

.transfer-result-success {
  color: #29d083;
}

.transfer-result-error {
  color: #e15b64;
}

.transfer-result-cancelled {
  color: #77828b;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-file,
  .transfer-file-progress,
  .transfer-action {
    transition: none;
  }
}
</style>
