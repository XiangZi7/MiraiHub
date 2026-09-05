<script setup lang="ts">
import { skinRuntime } from '@/utils/skin-runtime'
</script>

<template>
  <Transition name="skin-background">
    <div
      v-if="skinRuntime.background"
      :key="skinRuntime.background"
      class="skin-wallpaper"
      aria-hidden="true"
      :style="{
        backgroundImage: `url(${JSON.stringify(skinRuntime.background)})`,
        opacity: skinRuntime.opacity,
        filter: `blur(${skinRuntime.blur}px)`,
        backgroundSize: skinRuntime.fit,
        backgroundPosition: skinRuntime.position,
        inset: skinRuntime.blur ? `-${skinRuntime.blur * 2}px` : '0',
      }"
    />
  </Transition>
</template>

<style scoped>
.skin-wallpaper {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  transition:
    opacity 360ms ease,
    filter 200ms ease;
}
.skin-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--skin-wallpaper-wash, #10101766);
}
.skin-background-enter-active,
.skin-background-leave-active {
  transition: opacity 360ms ease;
}
.skin-background-enter-from,
.skin-background-leave-to {
  opacity: 0 !important;
}
</style>
