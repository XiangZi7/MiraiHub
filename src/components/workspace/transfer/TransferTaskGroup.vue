<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, useId } from 'vue'
import AppCollapse from '@/components/ui/AppCollapse.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type {
  FileTransferDirection,
  FileTransferTask,
} from '@/composables/useFileTransfers'
import TransferTaskCard from './TransferTaskCard.vue'

const { t } = useI18n()
const panelId = useId()

const props = defineProps<{
  direction: FileTransferDirection
  connectionName: string
  expanded: boolean
  tasks: readonly FileTransferTask[]
}>()

const emit = defineEmits<{
  toggle: []
  pause: [taskId: string]
  resume: [taskId: string]
  cancel: [taskId: string]
}>()

const completedCount = computed(
  () => props.tasks.filter(task => task.status === 'completed').length
)

const directionInfo = computed(
  () =>
    ({
      upload: { icon: 'lucide:cloud-upload', label: t('上传到') },
      download: { icon: 'lucide:cloud-download', label: t('下载自') },
      'remote-copy': {
        icon: 'lucide:arrow-right-left',
        label: t('files.copyAcrossSsh'),
      },
    })[props.direction]
)
</script>

<template>
  <section class="transfer-group">
    <h3>
      <button
        type="button"
        class="transfer-group-heading"
        :aria-expanded="expanded"
        :aria-controls="panelId"
        @click="emit('toggle')"
      >
        <AppIcon
          name="lucide:chevron-right"
          :size="12"
          class="transfer-group-chevron"
        />
        <AppIcon
          :name="directionInfo.icon"
          :size="12"
          class="transfer-group-icon"
        />
        <span class="transfer-group-title">
          <span>{{ directionInfo.label }}</span>
          {{ connectionName || t('Remote server') }}
        </span>
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
      </button>
    </h3>

    <AppCollapse
      :id="panelId"
      :open="expanded"
    >
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
    </AppCollapse>
  </section>
</template>

<style scoped>
.transfer-group + .transfer-group {
  margin-top: 12px;
}

.transfer-group-heading {
  display: flex;
  width: 100%;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  border-radius: 5px;
  text-align: left;
  cursor: pointer;
}

.transfer-group-heading:hover {
  background: var(--color-hover);
}

.transfer-group-heading:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.transfer-group-chevron {
  flex: none;
  color: var(--color-txt-3);
  transition: transform var(--motion-panel);
}

.transfer-group-heading[aria-expanded='true'] .transfer-group-chevron {
  transform: rotate(90deg);
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
