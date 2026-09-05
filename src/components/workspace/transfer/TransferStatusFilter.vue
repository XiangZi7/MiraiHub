<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { cn } from '@/utils/cn'

export type TransferStatusFilter = 'all' | 'active' | 'completed' | 'failed'

defineProps<{
  modelValue: TransferStatusFilter
  counts: Record<TransferStatusFilter, number>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TransferStatusFilter]
}>()

const filters: Array<{
  id: TransferStatusFilter
  label: string
  icon: string
  tone: string
}> = [
  { id: 'all', label: '全部', icon: 'lucide:list', tone: 'text-txt-3' },
  {
    id: 'active',
    label: '进行中',
    icon: 'lucide:loader-circle',
    tone: 'text-blue',
  },
  {
    id: 'completed',
    label: '已完成',
    icon: 'lucide:circle-check',
    tone: 'text-success',
  },
  {
    id: 'failed',
    label: '错误',
    icon: 'lucide:circle-alert',
    tone: 'text-danger',
  },
]
</script>

<template>
  <nav
    class="transfer-filters"
    aria-label="传输状态筛选"
  >
    <button
      v-for="filter in filters"
      :key="filter.id"
      type="button"
      :class="
        cn(
          'transfer-filter',
          modelValue === filter.id && 'transfer-filter-active'
        )
      "
      :aria-pressed="modelValue === filter.id"
      @click="emit('update:modelValue', filter.id)"
    >
      <AppIcon
        :name="filter.icon"
        :size="11"
        :class="filter.tone"
      />
      <span>{{ filter.label }}</span>
      <span class="transfer-filter-count">{{ counts[filter.id] }}</span>
    </button>
  </nav>
</template>

<style scoped>
.transfer-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  border-bottom: 1px solid rgb(255 255 255 / 6%);
  background: rgb(8 12 16 / 42%);
  padding: 7px 9px;
}

.transfer-filter {
  display: flex;
  min-width: 0;
  height: 27px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--color-txt-3);
  font-size: 9px;
  outline: none;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease;
}

.transfer-filter:hover,
.transfer-filter:focus-visible {
  border-color: rgb(255 255 255 / 9%);
  background: rgb(255 255 255 / 5%);
  color: var(--color-txt);
}

.transfer-filter-active {
  border-color: color-mix(in oklch, var(--color-blue) 38%, transparent);
  background: color-mix(in oklch, var(--color-blue) 12%, transparent);
  color: var(--color-txt);
  box-shadow: inset 0 1px rgb(255 255 255 / 4%);
}

.transfer-filter-count {
  min-width: 14px;
  border-radius: 999px;
  background: rgb(255 255 255 / 6%);
  padding: 1px 3px;
  color: var(--color-txt-4);
  font-size: 8px;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-filter {
    transition: none;
  }
}
</style>
