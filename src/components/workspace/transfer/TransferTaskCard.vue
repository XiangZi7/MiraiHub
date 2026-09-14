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

const ICONS: Array<[string, string[]]> = [
  [
    'lucide:file-archive',
    ['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'xz', 'bz2'],
  ],
  [
    'lucide:file-image',
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  ],
  ['lucide:file-video', ['mp4', 'mkv', 'mov', 'avi', 'webm']],
  ['lucide:file-audio', ['mp3', 'wav', 'flac', 'ogg', 'aac']],
  [
    'lucide:file-code',
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'vue',
      'rs',
      'py',
      'go',
      'java',
      'c',
      'cpp',
      'h',
      'sh',
      'sql',
      'html',
      'css',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
    ],
  ],
  ['lucide:file-spreadsheet', ['xls', 'xlsx', 'csv']],
  ['lucide:file-text', ['txt', 'md', 'log', 'pdf', 'doc', 'docx', 'conf']],
]

const progress = computed(() => {
  if (!props.task.totalBytes) return props.task.status === 'completed' ? 100 : 0
  return Math.min(
    100,
    Math.round((props.task.transferredBytes / props.task.totalBytes) * 100)
  )
})

const settled = computed(() =>
  ['completed', 'error', 'cancelled'].includes(props.task.status)
)

const displayPath = computed(() => {
  const path =
    props.task.direction === 'upload' ? props.task.target : props.task.source
  const normalized = path.replaceAll('\\', '/')
  const separator = normalized.lastIndexOf('/')
  if (separator === 0) return '/'
  return separator > 0 ? normalized.slice(0, separator) : normalized
})

const fileIcon = computed(() => {
  const extension = props.task.fileName.split('.').at(-1)?.toLowerCase() ?? ''
  return (
    ICONS.find(([, list]) => list.includes(extension))?.[0] ?? 'lucide:file'
  )
})

const progressTone = computed(() => {
  if (props.task.status === 'completed') return 'transfer-progress-complete'
  if (props.task.status === 'error' || props.task.status === 'cancelled')
    return 'transfer-progress-error'
  return 'transfer-progress-active'
})

const sizeLabel = computed(() => {
  const current = formatBytes(props.task.transferredBytes)
  if (props.task.totalBytes)
    return `${current} / ${formatBytes(props.task.totalBytes)}`
  return settled.value ? current : `${current} / --`
})

const statusIcon = computed(() => {
  switch (props.task.status) {
    case 'queued':
      return 'lucide:clock'
    case 'paused':
      return 'lucide:pause'
    case 'running':
      return props.task.direction === 'upload'
        ? 'lucide:arrow-up'
        : 'lucide:arrow-down'
    default:
      return ''
  }
})
</script>

<template>
  <article
    :class="['transfer-file', settled && 'transfer-file-settled']"
    :data-status="task.status"
  >
    <div
      class="transfer-file-icon"
      aria-hidden="true"
    >
      <AppIcon
        :name="fileIcon"
        :size="16"
      />
    </div>

    <div class="transfer-file-main">
      <div class="transfer-file-row">
        <p
          class="transfer-file-name"
          :title="task.fileName"
        >
          {{ task.fileName }}
        </p>
        <span class="transfer-file-meta">
          <AppIcon
            v-if="statusIcon"
            :name="statusIcon"
            :size="10"
          />
          {{ sizeLabel }}
        </span>
      </div>
      <p
        :class="['transfer-file-path', task.error && 'transfer-file-error']"
        :title="task.error || displayPath"
      >
        <AppIcon
          :name="task.error ? 'lucide:triangle-alert' : 'lucide:folder'"
          :size="10"
        />
        <span>{{ task.error || displayPath }}</span>
      </p>
      <div
        class="transfer-file-track"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          :class="['transfer-file-progress', progressTone]"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>

    <div class="transfer-file-actions">
      <button
        v-if="task.status === 'running'"
        type="button"
        class="transfer-action"
        title="暂停"
        aria-label="Pause transfer"
        @click="emit('pause', task.id)"
      >
        <AppIcon
          name="lucide:pause"
          :size="12"
        />
      </button>
      <button
        v-else-if="task.status === 'paused'"
        type="button"
        class="transfer-action"
        title="继续"
        aria-label="Resume transfer"
        @click="emit('resume', task.id)"
      >
        <AppIcon
          name="lucide:play"
          :size="12"
        />
      </button>
      <span
        v-else-if="task.status === 'completed'"
        class="transfer-result transfer-result-success"
        title="已完成"
      >
        <AppIcon
          name="lucide:circle-check"
          :size="14"
        />
      </span>
      <span
        v-else-if="task.status === 'error'"
        class="transfer-result transfer-result-error"
        title="失败"
      >
        <AppIcon
          name="lucide:circle-alert"
          :size="14"
        />
      </span>
      <span
        v-else-if="task.status === 'cancelled'"
        class="transfer-result transfer-result-cancelled"
        title="已取消"
      >
        <AppIcon
          name="lucide:circle-x"
          :size="14"
        />
      </span>

      <button
        v-if="!settled"
        type="button"
        class="transfer-action transfer-action-cancel"
        title="取消"
        aria-label="Cancel transfer"
        @click="emit('cancel', task.id)"
      >
        <AppIcon
          name="lucide:x"
          :size="13"
        />
      </button>
    </div>
  </article>
</template>

<style scoped>
.transfer-file {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  border-radius: 6px;
  padding: 6px 6px 6px 8px;
  transition: background-color 150ms ease;
}

.transfer-file:hover {
  background-color: color-mix(in oklch, var(--color-txt) 4%, transparent);
}

.transfer-file-settled {
  opacity: 0.82;
}

.transfer-file-icon {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-blue) 12%, transparent);
  color: var(--color-blue);
}

.transfer-file-settled .transfer-file-icon {
  background: color-mix(in oklch, var(--color-txt) 6%, transparent);
  color: var(--color-txt-3);
}

.transfer-file-main {
  min-width: 0;
}

.transfer-file-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.transfer-file-name,
.transfer-file-path > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-file-name {
  min-width: 0;
  flex: 1 1 auto;
  color: var(--color-txt);
  font-size: 10.5px;
  font-weight: 500;
  line-height: 14px;
}

.transfer-file-meta {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  color: var(--color-txt-3);
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  line-height: 14px;
}

.transfer-file-path {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--color-txt-3);
  font-size: 9px;
  line-height: 12px;
}

.transfer-file-error {
  color: var(--color-danger);
}

.transfer-file-track {
  height: 2px;
  overflow: hidden;
  margin-top: 4px;
  border-radius: 999px;
  background: var(--color-line-soft);
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
  background: var(--color-success);
}

.transfer-progress-error {
  background: var(--color-danger);
}

.transfer-file-actions {
  display: flex;
  min-width: 22px;
  align-items: center;
  justify-content: flex-end;
  gap: 1px;
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
  color: var(--color-txt-3);
  outline: none;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.transfer-action:hover,
.transfer-action:focus-visible {
  background: color-mix(in oklch, var(--color-txt) 7%, transparent);
  color: var(--color-txt);
}

.transfer-action-cancel:hover,
.transfer-action-cancel:focus-visible {
  background: color-mix(in oklch, var(--color-danger) 14%, transparent);
  color: var(--color-danger);
}

.transfer-result-success {
  color: var(--color-success);
}

.transfer-result-error {
  color: var(--color-danger);
}

.transfer-result-cancelled {
  color: var(--color-txt-3);
}

@media (prefers-reduced-motion: reduce) {
  .transfer-file,
  .transfer-file-progress,
  .transfer-action {
    transition: none;
  }
}
</style>
