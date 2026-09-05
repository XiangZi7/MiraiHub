<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { IS_TAURI } from '@/utils/window'

const directions = [
  'North',
  'South',
  'East',
  'West',
  'NorthEast',
  'NorthWest',
  'SouthEast',
  'SouthWest',
] as const
function resize(
  event: PointerEvent,
  direction: (typeof directions)[number]
): void {
  if (event.button !== 0 || !IS_TAURI) return
  void getCurrentWindow()
    .startResizeDragging(direction)
    .catch(error => console.warn('调整窗口大小失败：', error))
}
</script>
<template>
  <template v-if="IS_TAURI">
    <div
      v-for="direction in directions"
      :key="direction"
      aria-hidden="true"
      class="window-resize-handle"
      :class="direction"
      @pointerdown.stop.prevent="resize($event, direction)"
    />
  </template>
</template>
<style scoped>
.window-resize-handle {
  position: absolute;
  z-index: 100;
  touch-action: none;
}
.North,
.South {
  left: 12px;
  right: 12px;
  height: 4px;
  cursor: ns-resize;
}
.North {
  top: 0;
}
.South {
  bottom: 0;
}
.East,
.West {
  top: 12px;
  bottom: 12px;
  width: 4px;
  cursor: ew-resize;
}
.East {
  right: 0;
}
.West {
  left: 0;
}
.NorthEast,
.NorthWest,
.SouthEast,
.SouthWest {
  width: 12px;
  height: 12px;
}
.NorthEast {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.NorthWest {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.SouthEast {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}
.SouthWest {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
.SouthEast::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  right: 3px;
  bottom: 3px;
  border-right: 1px solid var(--color-txt-3);
  border-bottom: 1px solid var(--color-txt-3);
}
</style>
