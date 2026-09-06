<script setup lang="ts">
import { useId } from 'vue'

const windowsBackdrop = navigator.userAgent.includes('Windows')
const filterId = `menu-backdrop-${useId()}`
</script>

<template>
  <div
    class="app-menu-surface"
    aria-hidden="true"
  >
    <svg
      class="app-menu-filter"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter
          :id="filterId"
          x="0"
          y="0"
          width="100%"
          height="100%"
          color-interpolation-filters="sRGB"
        >
          <feGaussianBlur
            stdDeviation="28"
            edgeMode="duplicate"
          />
          <feColorMatrix
            type="saturate"
            values="1.75"
          />
          <!-- 透明 WebView 的模糊结果仍带 alpha，会再次透出未模糊原文。
               只补齐采样层的 alpha，保留模糊后的背景颜色与前景文字。 -->
          <feComponentTransfer>
            <feFuncA
              type="discrete"
              tableValues="1 1"
            />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
    <div
      class="app-menu-backdrop"
      :class="windowsBackdrop && 'app-menu-backdrop-windows'"
      :style="{ '--menu-backdrop-filter': `url(#${filterId})` }"
    />
  </div>
</template>

<style scoped>
.app-menu-surface {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}
.app-menu-filter {
  position: absolute;
  width: 0;
  height: 0;
}
.app-menu-backdrop {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 32%),
    color-mix(in oklch, var(--color-panel) 94%, transparent);
  -webkit-backdrop-filter: blur(28px) saturate(175%);
  backdrop-filter: blur(28px) saturate(175%);
}

/* 仅 Windows 透明桌面窗口需要修正 alpha；浏览器保留标准的背景模糊。 */
html.is-tauri .app-menu-backdrop-windows {
  backdrop-filter: var(--menu-backdrop-filter);
}
</style>
