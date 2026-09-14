<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { cn } from '@/utils/cn'

const { t } = useI18n()

export type TransferStatusFilter = 'all' | 'active' | 'completed' | 'failed'

defineProps<{
  modelValue: TransferStatusFilter
  counts: Record<TransferStatusFilter, number>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TransferStatusFilter]
}>()

const filters = computed<
  Array<{
    id: TransferStatusFilter
    label: string
    icon: string
    tone: string
  }>
>(() => [
  { id: 'all', label: t('全部'), icon: 'lucide:layers', tone: 'text-txt-3' },
  {
    id: 'active',
    label: t('进行中'),
    icon: 'lucide:loader-circle',
    tone: 'text-blue',
  },
  {
    id: 'completed',
    label: t('已完成'),
    icon: 'lucide:circle-check',
    tone: 'text-success',
  },
  {
    id: 'failed',
    label: t('失败'),
    icon: 'lucide:circle-alert',
    tone: 'text-danger',
  },
])
</script>

<template>
  <nav
    class="transfer-filters"
    :aria-label="t('传输状态筛选')"
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
      <span
        v-if="counts[filter.id]"
        class="transfer-filter-count"
        >{{ counts[filter.id] }}</span
      >
    </button>
  </nav>
</template>

<style scoped>
.transfer-filters {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 6px 10px;
}

.transfer-filter {
  display: flex;
  height: 24px;
  cursor: pointer;
  align-items: center;
  gap: 4px;
  border-radius: 5px;
  padding: 0 8px;
  color: var(--color-txt-3);
  font-size: 9.5px;
  outline: none;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.transfer-filter:hover,
.transfer-filter:focus-visible {
  background: color-mix(in oklch, var(--color-txt) 5%, transparent);
  color: var(--color-txt);
}

.transfer-filter-active {
  background: color-mix(in oklch, var(--color-blue) 12%, transparent);
  color: var(--color-txt);
}

.transfer-filter-count {
  min-width: 14px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-txt) 7%, transparent);
  padding: 1px 4px;
  color: var(--color-txt-3);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-filter {
    transition: none;
  }
}
</style>
