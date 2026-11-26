<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { CONNECTION_TAG_COLORS } from '@/constants/connection'
import type { ConnectionTagColor } from '@/types/connection'

const { t } = useI18n()
const color = defineModel<ConnectionTagColor>({ required: true })
</script>

<template>
  <!-- 连接标识颜色：共享标签编辑器与 Docker 配置使用同一组色标。 -->
  <fieldset class="space-y-1.5">
    <legend class="text-txt-2 block text-[11px] font-medium">
      {{ t('Tag Color') }}
    </legend>
    <div
      class="flex min-h-7 items-center gap-2"
      role="radiogroup"
      :aria-label="t('标签颜色')"
    >
      <button
        v-for="option in CONNECTION_TAG_COLORS"
        :key="option.id"
        type="button"
        role="radio"
        :aria-checked="color === option.id"
        :aria-label="t(option.label)"
        :title="t(option.label)"
        :class="[
          'tag-color-option',
          color === option.id && 'tag-color-option-active',
        ]"
        :style="{ '--tag-color': option.css }"
        @click="color = option.id"
      />
    </div>
  </fieldset>
</template>

<style scoped>
.tag-color-option {
  position: relative;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  outline: none;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}

.tag-color-option::before {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--tag-color);
  content: '';
}

.tag-color-option:hover,
.tag-color-option:focus-visible {
  background: var(--color-hover);
}

.tag-color-option-active {
  border-color: color-mix(
    in oklch,
    var(--tag-color) 30%,
    var(--color-line-strong)
  );
  background: color-mix(in oklch, var(--tag-color) 8%, var(--color-raised));
}

.tag-color-option-active::before {
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--tag-color) 13%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .tag-color-option {
    transition: none;
  }
}
</style>
