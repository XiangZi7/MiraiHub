<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{ kind?: 'database' | 'redis'; label?: string }>(),
  {
    kind: 'database',
  }
)

const label = computed(
  () =>
    props.label ??
    (props.kind === 'redis' ? t('正在连接 Redis…') : t('正在连接数据库…'))
)

/**
 * 每行首列的宽度。写成固定序列而不是随机值 ——
 * 骨架每次重渲染都得长得一样，否则连接期间会自己抖动。
 */
const ROW_WIDTHS = [
  'w-40',
  'w-28',
  'w-44',
  'w-32',
  'w-36',
  'w-24',
  'w-40',
  'w-30',
]
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    role="status"
    aria-busy="true"
    :aria-label="label"
  >
    <!-- 往下渐隐，让骨架看起来是淡出而不是被硬生生截断 -->
    <div
      class="scroll-none min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
      aria-hidden="true"
    >
      <!-- 表头与连上后的对象表格同内边距，切换时不会跳一下 -->
      <div class="border-line-soft flex items-center gap-3 border-b px-3 py-2">
        <div class="bg-raised/60 h-2.5 w-2/5 animate-pulse rounded-sm" />
        <div class="bg-raised/60 h-2.5 w-20 animate-pulse rounded-sm" />
        <div class="bg-raised/60 h-2.5 w-14 animate-pulse rounded-sm" />
      </div>
      <div
        v-for="(width, index) in ROW_WIDTHS"
        :key="width"
        class="border-line-soft/60 flex items-center gap-3 border-b px-3 py-2.5"
        :style="{ animationDelay: `${index * 90}ms` }"
      >
        <div class="w-2/5">
          <div
            :class="['bg-raised/45 h-2.5 animate-pulse rounded-sm', width]"
            :style="{ animationDelay: `${index * 90}ms` }"
          />
        </div>
        <div
          class="bg-raised/30 h-2.5 w-16 animate-pulse rounded-sm"
          :style="{ animationDelay: `${index * 90 + 45}ms` }"
        />
        <div
          class="bg-raised/30 h-2.5 w-10 animate-pulse rounded-sm"
          :style="{ animationDelay: `${index * 90 + 90}ms` }"
        />
      </div>
    </div>

    <!-- 底部细状态条：等待信息留在视线边缘，不挡住正在成形的界面 -->
    <div
      v-if="kind === 'redis'"
      class="border-line-soft bg-card/60 text-txt-3 flex shrink-0 items-center gap-2 border-t px-3 py-2 text-[11px]"
    >
      <AppIcon
        name="lucide:loader-circle"
        :size="13"
        class="text-violet animate-spin"
      />
      {{ label }}
    </div>
  </section>
</template>
