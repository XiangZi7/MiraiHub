<script setup lang="ts">
import { computed } from 'vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { CONNECTION_TAG_COLORS } from '@/constants/connection'
import type { ConnectionTagColor } from '@/types/connection'

const tags = defineModel<string>({ required: true })
const color = defineModel<ConnectionTagColor>('color', { required: true })

const previewTags = computed(() => tags.value
  .split(/[,，]/)
  .map(tag => tag.trim())
  .filter(Boolean)
  .slice(0, 4))
</script>

<template>
  <div class="grid gap-2.5">
    <AppTextField
      v-model="tags"
      label="Tags"
      placeholder="e.g. Production, China"
    />

    <fieldset class="space-y-1.5">
      <legend class="block text-[11px] font-medium text-txt-2">
        Tag Color
      </legend>
      <div class="flex min-h-7 items-center gap-2" role="radiogroup" aria-label="标签颜色">
        <button
          v-for="option in CONNECTION_TAG_COLORS"
          :key="option.id"
          type="button"
          role="radio"
          :aria-checked="color === option.id"
          :aria-label="option.label"
          :title="option.label"
          :class="['tag-color-option', color === option.id && 'tag-color-option-active']"
          :style="{ '--tag-color': option.css }"
          @click="color = option.id"
        />

        <div v-if="previewTags.length" class="ml-1 flex min-w-0 items-center gap-1 overflow-hidden">
          <span
            v-for="tag in previewTags"
            :key="tag"
            class="tag-preview"
            :style="{ '--tag-color': CONNECTION_TAG_COLORS.find(option => option.id === color)?.css }"
          >
            {{ tag }}
          </span>
        </div>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.tag-color-option {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--tag-color);
  outline: none;
  transition: box-shadow 150ms ease, transform 150ms ease;
}

.tag-color-option:hover,
.tag-color-option:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--tag-color) 22%, transparent);
}

.tag-color-option-active {
  border-color: color-mix(in oklch, white 78%, var(--tag-color));
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--tag-color) 26%, transparent);
}

.tag-preview {
  max-width: 92px;
  overflow: hidden;
  border: 1px solid color-mix(in oklch, var(--tag-color) 40%, transparent);
  border-radius: 4px;
  background: color-mix(in oklch, var(--tag-color) 12%, transparent);
  padding: 1px 5px;
  color: var(--tag-color);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .tag-color-option {
    transition: none;
  }
}
</style>

