<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type {
  FileTransferDirection,
  FileTransferTask,
} from '@/composables/useFileTransfers'
import TransferTaskCard from './TransferTaskCard.vue'

const { t } = useI18n()

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

const completedCount = computed(
  () => props.tasks.filter(task => task.status === 'completed').length
)

const directionIcon = computed(() =>
  props.direction === 'upload' ? 'lucide:cloud-upload' : 'lucide:cloud-download'
)
const directionLabel = computed(() =>
  props.direction === 'upload' ? t('上传到') : t('下载自')
)
</script>

<template>
  <section class="transfer-group">
    <div class="transfer-group-heading">
      <AppIcon
        :name="directionIcon"
        :size="12"
        class="transfer-group-icon"
      />
      <h3 class="transfer-group-title">
        <span>{{ directionLabel }}</span>
        {{ connectionName || t('Remote server') }}
      </h3>
      <span
        class="transfer-group-meta"
        :title="t('已完成 / 总数')"
      >
        <AppIcon
          name="lucide:list-checks"
          :size="10"
        />
        {{ completedCount }}/{{ tasks.length }}
      </span>
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
  margin-top: 12px;
}

.transfer-group-heading {
  display: flex;
  height: 24px;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
}

.transfer-group-icon {
  flex: 0 0 auto;
  color: var(--color-blue);
}

.transfer-group-title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--color-txt);
  font-size: 10.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-group-title span {
  margin-right: 3px;
  color: var(--color-txt-3);
  font-weight: 400;
}

.transfer-group-meta {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  color: var(--color-txt-3);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.transfer-group-files {
  display: grid;
  gap: 4px;
}
</style>
