<script setup lang="ts">
import type { ColumnTagStyle } from '@/types/database'

/**
 * 表格单元格里的标签。两种样式：
 * - badge：带底色的小徽章，适合“方法”“分类”这类枚举值；
 * - dot：彩色圆点 + 原文，适合“状态码”这类要保留数值的列。
 */
withDefaults(
  defineProps<{
    label: string
    /** CSS 颜色，通常是 var(--color-xxx)。 */
    color: string
    variant?: ColumnTagStyle
  }>(),
  { variant: 'badge' }
)
</script>

<template>
  <span
    :class="['database-cell-tag', `database-cell-tag-${variant}`]"
    :style="{ '--tag-color': color }"
    :title="label"
  >
    <span
      v-if="variant === 'dot'"
      class="database-cell-tag-dot"
      aria-hidden="true"
    />
    <span class="database-cell-tag-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.database-cell-tag {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  color: var(--color-txt-2);
  font-size: 10.5px;
  line-height: 1;
  vertical-align: middle;
}

.database-cell-tag-badge {
  height: 18px;
  border: 1px solid color-mix(in oklch, var(--tag-color) 28%, transparent);
  border-radius: 5px;
  background: color-mix(in oklch, var(--tag-color) 16%, transparent);
  padding: 0 7px;
  color: color-mix(in oklch, var(--tag-color) 72%, var(--color-txt));
  font-weight: 500;
}

.database-cell-tag-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--tag-color);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--tag-color) 18%, transparent);
}

.database-cell-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
