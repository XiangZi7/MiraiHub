<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'

withDefaults(
  defineProps<{
    message: string
    title?: string
    retryLabel?: string
  }>(),
  { title: '', retryLabel: '' }
)

defineEmits<{
  retry: []
  dismiss: []
}>()

const { t } = useI18n()
</script>

<template>
  <!-- 与 ToastHost 同一套语义卡片。
       这套界面颜色用得省（工具栏、标签页全是中性灰，只有状态点带色），
       所以这里也只让图标带语义色：边框中性、辉光极淡、不铺底色。
       错误压在终端输出上方，越像一条状态提示越好，越像报错弹窗越糟。 -->
  <!-- 外层接收调用方的定位，内层 relative 只用来约束卡片辉光。 -->
  <div role="alert">
    <div
      class="border-line-strong bg-panel/95 glass relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 overflow-hidden rounded-[10px] border py-2.5 pr-2 pl-3 shadow-(--shadow-notice) [--tone:var(--color-danger)] motion-safe:animate-[session-error-reveal_200ms_cubic-bezier(0.2,0.8,0.2,1)]"
    >
      <span
        class="tone-glow"
        aria-hidden="true"
      />

      <AppIcon
        name="lucide:triangle-alert"
        :size="14"
        class="relative mt-px shrink-0 text-(--tone)"
        aria-hidden="true"
      />

      <div class="relative min-w-0">
        <p
          class="text-txt text-[11.5px] leading-[1.45] font-semibold wrap-anywhere"
        >
          {{ title || t('连接失败') }}
        </p>
        <p
          class="scroll-thin text-txt-3 max-h-20 overflow-y-auto text-[11px] leading-[1.5] wrap-anywhere whitespace-pre-wrap"
        >
          {{ message }}
        </p>
      </div>

      <!-- 操作贴着标题行，不另起一行：卡片越矮，越不像挡在终端前面的弹窗。
           重试和关闭都是中性色，跟工具栏按钮同一体系，hover 才亮起来。 -->
      <div class="relative -mt-0.5 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="text-txt-2 hover:bg-hover hover:text-txt focus-visible:bg-hover focus-visible:text-txt inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors duration-150 outline-none"
          @click="$emit('retry')"
        >
          <AppIcon
            name="lucide:rotate-cw"
            :size="11"
          />{{ retryLabel || t('重试') }}
        </button>
        <!-- 不像 Toast 那样 hover 才浮现：这条错误不会自动消失，关闭入口得一直看得见 -->
        <button
          type="button"
          class="text-txt-4 hover:bg-hover hover:text-txt focus-visible:bg-hover focus-visible:text-txt grid size-6 cursor-pointer place-items-center rounded-md transition-colors duration-150 outline-none"
          :aria-label="t('关闭提示')"
          :title="t('关闭')"
          @click="$emit('dismiss')"
        >
          <AppIcon
            name="lucide:x"
            :size="12"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes session-error-reveal {
  from {
    opacity: 0;
    transform: translateY(-5px) scale(0.98);
  }
}
</style>
