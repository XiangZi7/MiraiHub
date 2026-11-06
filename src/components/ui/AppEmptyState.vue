<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/** 列表 / 视图无数据时的统一占位：图标 + 标题 + 描述 + 可选操作。 */
withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    compact?: boolean
  }>(),
  { icon: 'lucide:inbox' },
)
</script>

<template>
  <Transition
    name="fade-scale"
    appear
  >
    <div
      :class="[
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 p-4' : 'gap-2.5 p-8',
      ]"
    >
      <div
        :class="[
          'bg-card border-line-soft text-txt-3 flex items-center justify-center rounded-full border shadow-card',
          compact ? 'size-9' : 'size-12',
        ]"
      >
        <AppIcon
          :name="icon"
          :size="compact ? 16 : 22"
        />
      </div>
      <p class="text-txt-2 text-[12.5px] font-medium">
        {{ title }}
      </p>
      <p
        v-if="description"
        class="text-txt-4 max-w-72 text-[11px]"
      >
        {{ description }}
      </p>
      <div
        v-if="$slots.default"
        class="mt-1 flex items-center gap-2"
      >
        <slot />
      </div>
    </div>
  </Transition>
</template>
