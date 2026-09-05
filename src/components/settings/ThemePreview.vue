<script setup lang="ts">
import { computed } from 'vue'
import type { SkinSettings } from '@/utils/skin'
import { skinPreviewDocument } from '@/utils/skin-preview'

const props = defineProps<{ values: SkinSettings }>()
const document = computed(() => skinPreviewDocument(props.values))
</script>

<template>
  <div class="theme-preview">
    <iframe
      :srcdoc="document"
      title="主题效果预览"
      sandbox=""
      tabindex="-1"
    />
  </div>
</template>

<style scoped>
.theme-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1.85;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  box-shadow: 0 5px 20px color-mix(in srgb, var(--color-accent) 8%, transparent);
  background: var(--color-window);
}
iframe {
  width: 200%;
  height: 200%;
  border: 0;
  transform: scale(0.5);
  transform-origin: top left;
  pointer-events: none;
}
</style>
