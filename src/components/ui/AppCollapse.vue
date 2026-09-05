<script setup lang="ts">
defineProps<{ open: boolean }>()
</script>

<template>
  <div
    class="app-collapse"
    :class="{ 'is-open': open }"
    :inert="!open"
    :aria-hidden="!open"
  >
    <div class="collapse-content"><slot /></div>
  </div>
</template>

<style scoped>
/* A grid track interpolates intrinsic height and also handles dynamic lists. */
.app-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--motion-panel),
    opacity 180ms ease;
}
.app-collapse.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.collapse-content {
  min-height: 0;
  overflow: hidden;
}
</style>
