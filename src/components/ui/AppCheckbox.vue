<script setup lang="ts">
import { useId } from 'vue'
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    label: string
    description?: string
    disabled?: boolean
    /** 仅显示复选框本体，文字仍作为屏幕阅读器标签。 */
    hideLabel?: boolean
  }>(),
  {
    description: '',
    disabled: false,
    hideLabel: false,
  }
)

const model = defineModel<boolean>({ required: true })
const inputId = useId()
const descriptionId = useId()
</script>

<template>
  <label
    :for="inputId"
    :class="[
      'app-checkbox relative inline-flex cursor-pointer items-start gap-2',
      disabled && 'pointer-events-none opacity-45',
    ]"
  >
    <!-- 原生输入框覆盖可见标签，避免聚焦时按隐藏坐标滚动外层面板。 -->
    <input
      :id="inputId"
      v-model="model"
      type="checkbox"
      :disabled="disabled"
      :aria-describedby="description ? descriptionId : undefined"
      class="app-checkbox-input absolute inset-0 m-0 size-full cursor-[inherit] opacity-0"
    />
    <span
      :class="[
        'app-checkbox-box mt-px inline-flex size-4 shrink-0 items-center justify-center',
        model && 'app-checkbox-box-checked',
      ]"
      aria-hidden="true"
    >
      <AppIcon
        v-if="model"
        name="lucide:check"
        :size="12"
      />
    </span>
    <span :class="hideLabel ? 'sr-only' : 'min-w-0'">
      <span class="text-txt-2 block text-[11px] leading-4 whitespace-nowrap">{{
        label
      }}</span>
      <span
        v-if="description"
        :id="descriptionId"
        class="text-txt-3 mt-0.5 block text-[10px] leading-4"
      >
        {{ description }}
      </span>
    </span>
  </label>
</template>

<style scoped>
.app-checkbox-box {
  border: 1px solid var(--color-line-strong);
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  color: white;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease;
}

.app-checkbox:hover .app-checkbox-box {
  border-color: color-mix(
    in oklch,
    var(--color-violet) 48%,
    var(--color-line-strong)
  );
}

.app-checkbox-box-checked {
  border-color: color-mix(in oklch, var(--color-violet) 68%, white 8%);
  background: var(--color-violet);
}

.app-checkbox-input:focus-visible + .app-checkbox-box {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--color-violet) 12%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .app-checkbox-box {
    transition: none;
  }
}
</style>
