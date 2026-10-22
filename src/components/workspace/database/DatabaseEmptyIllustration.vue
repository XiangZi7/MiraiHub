<script setup lang="ts">
import { useId } from 'vue'

// 分屏中会同时出现多个空状态，渐变标识必须保持实例独立。
const id = useId()
const bodyGradient = `${id}-database-body`
const cardGradient = `${id}-database-card`
</script>

<template>
  <svg
    class="database-empty-illustration pointer-events-none h-auto max-h-full w-80 max-w-full select-none"
    width="320"
    height="256"
    viewBox="0 0 320 256"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient
        :id="bodyGradient"
        x1="65"
        y1="96"
        x2="174"
        y2="180"
        gradientUnits="userSpaceOnUse"
      >
        <stop class="storage-light" />
        <stop
          offset="1"
          class="storage-shade"
        />
      </linearGradient>
      <linearGradient
        :id="cardGradient"
        x1="150"
        y1="113"
        x2="253"
        y2="193"
        gradientUnits="userSpaceOnUse"
      >
        <stop class="table-light" />
        <stop
          offset="1"
          class="table-shade"
        />
      </linearGradient>
    </defs>

    <!-- 留白中的细线只提示对象之间的联系，不与操作区域争夺注意力。 -->
    <ellipse
      class="ground"
      cx="161"
      cy="207"
      rx="103"
      ry="10"
    />
    <path
      class="connection"
      d="M177 73h31a16 16 0 0 1 16 16v13M52 152H40a10 10 0 0 0-10 10v13"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-dasharray="3 6"
    />
    <circle
      class="node"
      cx="224"
      cy="106"
      r="3"
    />
    <circle
      class="node"
      cx="30"
      cy="180"
      r="3"
    />

    <!-- 数据库：低对比度的立体层次，表面颜色随当前皮肤变化。 -->
    <path
      :fill="`url(#${bodyGradient})`"
      class="storage-outline"
      d="M65 84v79c0 11 24 20 54 20s54-9 54-20V84"
      stroke-width="1.5"
    />
    <path
      class="storage-divider"
      d="M65 110c0 11 24 20 54 20s54-9 54-20M65 136c0 11 24 20 54 20s54-9 54-20"
      stroke-width="1.5"
    />
    <ellipse
      class="storage-top"
      cx="119"
      cy="84"
      rx="54"
      ry="20"
      stroke-width="1.5"
    />
    <ellipse
      class="storage-inner"
      cx="119"
      cy="84"
      rx="34"
      ry="10"
      stroke-width="1"
    />
    <path
      class="status-marks"
      d="M79 111v3m0 23v3m0 23v3"
      stroke-width="3"
      stroke-linecap="round"
    />

    <!-- 表格：实色表面覆盖后方圆柱，避免透明叠色在浅色模式下发脏。 -->
    <g transform="rotate(-5 205 152)">
      <rect
        class="table-shadow"
        x="147"
        y="117"
        width="118"
        height="83"
        rx="12"
      />
      <rect
        class="table-outline"
        :fill="`url(#${cardGradient})`"
        x="143"
        y="110"
        width="118"
        height="83"
        rx="12"
        stroke-width="1.5"
      />
      <path
        class="table-heading"
        d="M155 110h94a12 12 0 0 1 12 12v13H143v-13a12 12 0 0 1 12-12Z"
      />
      <path
        class="table-grid"
        d="M143 135h118m-118 19h118m-118 19h118m-82-38v58m39-58v58"
        stroke-width="1"
      />
      <path
        class="table-heading-marks"
        d="M155 123h15m12 0h26m12 0h17"
        stroke-width="3"
        stroke-linecap="round"
      />
      <rect
        class="selected-cell"
        x="183"
        y="158"
        width="31"
        height="11"
        rx="3"
      />
    </g>
  </svg>
</template>

<style scoped>
.database-empty-illustration {
  --illustration-surface: color-mix(
    in oklch,
    var(--color-canvas),
    var(--color-txt) 6%
  );
  --illustration-line: color-mix(in oklch, var(--color-txt-3) 32%, transparent);
  --illustration-accent: var(--color-accent);
}
.storage-light {
  stop-color: color-mix(
    in oklch,
    var(--illustration-accent) 10%,
    var(--illustration-surface)
  );
}
.storage-shade,
.table-shade {
  stop-color: var(--illustration-surface);
}
.table-light {
  stop-color: color-mix(
    in oklch,
    var(--color-txt) 4%,
    var(--illustration-surface)
  );
}
.ground,
.table-shadow {
  fill: color-mix(in oklch, var(--color-txt-4) 7%, transparent);
}
.connection {
  stroke: var(--illustration-line);
}
.node,
.selected-cell {
  fill: color-mix(in oklch, var(--illustration-accent) 24%, transparent);
}
.storage-outline,
.table-outline {
  stroke: var(--illustration-line);
}
.storage-divider,
.table-grid {
  stroke: color-mix(in oklch, var(--color-txt-3) 20%, transparent);
}
.storage-top {
  fill: color-mix(
    in oklch,
    var(--illustration-accent) 13%,
    var(--illustration-surface)
  );
  stroke: color-mix(
    in oklch,
    var(--illustration-accent) 35%,
    var(--illustration-line)
  );
}
.storage-inner {
  stroke: color-mix(in oklch, var(--illustration-accent) 25%, transparent);
}
.status-marks,
.table-heading-marks {
  stroke: color-mix(in oklch, var(--illustration-accent) 52%, transparent);
}
.table-heading {
  fill: color-mix(in oklch, var(--illustration-accent) 10%, transparent);
}
</style>
