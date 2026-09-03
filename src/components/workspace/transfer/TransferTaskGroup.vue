<script setup lang="ts">
import { computed } from 'vue'
import type { FileTransferDirection, FileTransferTask } from '@/composables/useFileTransfers'
import TransferTaskCard from './TransferTaskCard.vue'

const props = defineProps<{
  direction: FileTransferDirection
  connectionName: string
  tasks: readonly FileTransferTask[]
}>()

const emit = defineEmits<{
  pause: [taskId: string]
  resume: [taskId: string]
  cancel: [taskId: string]
}>()

const completedCount = computed(() => props.tasks.filter(task => task.status === 'completed').length)
const progress = computed(() => {
  const total = props.tasks.reduce((sum, task) => sum + task.totalBytes, 0)
  if (!total)
    return props.tasks.length && completedCount.value === props.tasks.length ? 100 : 0
  const transferred = props.tasks.reduce((sum, task) => sum + Math.min(task.transferredBytes, task.totalBytes), 0)
  return Math.min(100, Math.round(transferred / total * 100))
})

const headingPrefix = computed(() => props.direction === 'upload' ? 'Uploading to' : 'Downloading from')
</script>

<template>
  <section class="transfer-group">
    <div class="transfer-group-heading">
      <h3 class="transfer-group-title">
        <span>{{ headingPrefix }}</span>
        {{ connectionName || 'Remote server' }}
      </h3>
      <div class="transfer-group-meta">
        <span>{{ completedCount }} of {{ tasks.length }} completed</span>
        <span>{{ progress }}%</span>
      </div>
    </div>

    <div class="transfer-group-files">
      <TransferTaskCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        @pause="emit('pause', $event)"
        @resume="emit('resume', $event)"
        @cancel="emit('cancel', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.transfer-group + .transfer-group {
  margin-top: 18px;
}

.transfer-group-heading {
  padding: 7px 8px 12px;
}

.transfer-group-title {
  overflow: hidden;
  color: #e9edef;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-group-title span {
  color: #9dc4ef;
}

.transfer-group-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  color: #a1a9b0;
  font-size: 9.5px;
  line-height: 16px;
}

.transfer-group-files {
  display: grid;
  gap: 5px;
}
</style>
