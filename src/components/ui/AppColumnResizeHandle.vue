<script setup lang="ts">
/**
 * 表头列宽拖拽手柄。绝对定位在 `<th>` 右边缘，父级 `<th>` 需要 `relative`。
 *
 * 事件不在这里声明，`@pointerdown` / `@dblclick` / `@keydown` 由调用方直接
 * 绑定到根元素，因此处理函数里的 `event.currentTarget` 就是手柄本身。
 */
defineProps<{ label: string }>()
</script>

<template>
  <span
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    class="column-resize-handle"
    @click.stop
  >
    <span aria-hidden="true" />
  </span>
</template>

<style scoped>
.column-resize-handle {
  position: absolute;
  inset-block: 0;
  right: -4px;
  z-index: 1;
  width: 9px;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}

.column-resize-handle span {
  position: absolute;
  inset-block: 2px;
  left: 50%;
  width: 2px;
  border-radius: 1px;
  background: transparent;
  transform: translateX(-50%);
  transition: background-color 120ms ease;
}

.column-resize-handle:hover span,
.column-resize-handle:focus-visible span {
  background: var(--color-violet);
}

@media (prefers-reduced-motion: reduce) {
  .column-resize-handle span {
    transition: none;
  }
}
</style>
