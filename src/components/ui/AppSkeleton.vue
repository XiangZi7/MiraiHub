<script setup lang="ts">
import { computed } from 'vue'

/**
 * 加载占位骨架。
 * - lines：若干行文本条，用于列表 / 对象树
 * - table：带表头的多列网格，用于数据表
 * - block：单个占位块，尺寸由调用方 class 决定
 */
const props = withDefaults(
  defineProps<{
    variant?: 'lines' | 'table' | 'block'
    rows?: number
    columns?: number
  }>(),
  { variant: 'lines', rows: 6, columns: 5 },
)

// 生成每行的宽度，制造参差感而不是一排整齐的长条
const lineWidths = computed(() =>
  Array.from({ length: props.rows }, (_, i) => 55 + ((i * 37) % 40)),
)
</script>

<template>
  <div
    class="pointer-events-none select-none"
    role="status"
    aria-busy="true"
  >
    <div
      v-if="variant === 'lines'"
      class="flex flex-col gap-2.5 p-3"
    >
      <div
        v-for="(width, i) in lineWidths"
        :key="i"
        class="skeleton h-3 rounded"
        :style="{ width: `${width}%` }"
      />
    </div>

    <div
      v-else-if="variant === 'table'"
      class="flex flex-col gap-2 p-3"
    >
      <div
        v-for="r in rows + 1"
        :key="r"
        class="grid gap-3"
        :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      >
        <div
          v-for="c in columns"
          :key="c"
          :class="['skeleton rounded', r === 1 ? 'h-4 opacity-80' : 'h-3']"
        />
      </div>
    </div>

    <div
      v-else
      class="skeleton size-full rounded-card"
    />
  </div>
</template>
