<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { maxPlanCost, type PlanNode } from '@/utils/explain-plan'

const { t } = useI18n()

const props = defineProps<{
  plan: PlanNode
  /** 递归时传入整棵树的最大代价，保持占比条同一刻度 */
  maxCost?: number
  depth?: number
}>()

const scale = computed(() => props.maxCost ?? maxPlanCost(props.plan))
const ratio = computed(() =>
  scale.value && props.plan.cost ? Math.max(4, (props.plan.cost / scale.value) * 100) : 0
)
</script>

<template>
  <div :class="depth ? 'border-line-soft ml-3 border-l pl-3' : ''">
    <div class="hover:bg-hover/60 group flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 transition-colors">
      <div class="flex min-w-0 items-center gap-2 text-[11.5px]">
        <AppIcon
          :name="plan.warning ? 'lucide:triangle-alert' : 'lucide:git-commit-horizontal'"
          :size="13"
          :class="plan.warning ? 'text-amber shrink-0' : 'text-txt-4 shrink-0'"
        />
        <span class="text-txt font-medium">{{ plan.label }}</span>
        <span
          v-if="plan.target"
          class="text-accent truncate font-mono"
          >{{ plan.target }}</span
        >
        <span class="flex-1" />
        <span
          v-if="plan.rows !== undefined"
          class="text-txt-3 shrink-0 font-mono text-[10.5px]"
          >{{ t('约 {count} 行', { count: plan.rows }) }}</span
        >
        <span
          v-if="plan.cost !== undefined"
          class="text-txt-3 w-20 shrink-0 text-right font-mono text-[10.5px]"
          >cost {{ plan.cost.toFixed(1) }}</span
        >
      </div>
      <div
        v-if="ratio"
        class="bg-line-soft h-1 overflow-hidden rounded-full"
      >
        <div
          :class="['h-full rounded-full transition-[width] duration-500', plan.warning ? 'bg-amber' : 'bg-accent']"
          :style="{ width: `${ratio}%` }"
        />
      </div>
      <p
        v-if="plan.detail"
        class="text-txt-4 truncate font-mono text-[10.5px]"
        :title="plan.detail"
      >
        {{ plan.detail }}
      </p>
    </div>
    <ExplainPlanView
      v-for="(child, index) in plan.children"
      :key="index"
      :plan="child"
      :max-cost="scale"
      :depth="(depth ?? 0) + 1"
    />
  </div>
</template>
