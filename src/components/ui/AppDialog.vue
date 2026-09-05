<script setup lang="ts">
import { useId } from 'vue'
import { useEventListener } from '@vueuse/core'
import IconButton from './IconButton.vue'

/**
 * 窗口内浮层对话框。
 *
 * 不用原生 <dialog>：它的 ::backdrop 不吃 backdrop-filter 的层叠上下文，
 * 而这个应用的浮层要透出下面的玻璃质感。
 */

defineProps<{
  title: string
  /** 标题下的说明文字 */
  description?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const titleId = useId()

// Esc 关闭。挂在 window 而不是浮层元素上：焦点可能在任何一个输入框里
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
})
</script>

<template>
  <!-- 点遮罩关闭，但只认落在遮罩自身上的点击：
       从对话框内部拖选文字到外面松手不该关掉它 -->
  <div
    class="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
    @click.self="emit('close')"
  >
    <section
      class="glass pane shadow-pop max-h-full w-full max-w-100"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <header
        class="border-line-soft flex shrink-0 items-start gap-2 border-b px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <h2
            :id="titleId"
            class="text-txt text-[13px] font-medium"
          >
            {{ title }}
          </h2>
          <p
            v-if="description"
            class="text-txt-3 mt-1 text-[11px]"
          >
            {{ description }}
          </p>
        </div>
        <IconButton
          icon="lucide:x"
          :size="15"
          title="关闭"
          @click="emit('close')"
        />
      </header>

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        <slot />
      </div>

      <footer
        v-if="$slots.footer"
        class="border-line-soft flex shrink-0 items-center gap-2 border-t px-4 py-3"
      >
        <slot name="footer" />
      </footer>
    </section>
  </div>
</template>
