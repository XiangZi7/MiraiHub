<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import type { TabItem } from '@/components/ui/TabBar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import TabBar from '@/components/ui/TabBar.vue'
import { TERMINAL_LINES, TERM_TONE_CLASS } from '@/constants/terminal'

// 响应式状态
const state = reactive({
  // 终端标签页
  tabs: [
    { id: 't1', label: 'Terminal 1', dot: 'accent', closable: true },
  ] as TabItem[],
  // 当前激活的终端标签
  activeTab: 't1',
})

const { tabs, activeTab } = toRefs(state)

defineEmits<{
  /** 请求关闭终端面板 */
  close: []
}>()
</script>

<template>
  <section class="flex w-[42%] min-w-105 max-w-180 shrink-0 flex-col border-l border-line-soft bg-terminal">
    <!-- 标签栏 -->
    <div class="flex h-11 shrink-0 items-center gap-1 border-b border-line-soft pl-2.5 pr-2">
      <TabBar v-model:active="activeTab" :tabs="tabs" addable class="flex-1" />
      <div class="flex-1" />
      <IconButton icon="lucide:maximize-2" :size="14" title="最大化" />
      <IconButton icon="lucide:x" :size="15" title="关闭" @click="$emit('close')" />
    </div>

    <!-- 会话工具条 -->
    <div class="flex h-9 shrink-0 items-center gap-2.5 border-b border-line-soft px-3">
      <span class="flex items-center gap-1.5 text-[11px] text-accent">
        <StatusDot :size="6" />
        <span>Connected</span>
      </span>

      <span class="rounded border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-txt-2">
        SSH
      </span>

      <button type="button" class="flex items-center gap-1 text-[11px] text-txt-2 transition-colors hover:text-txt">
        <span>Production Server</span>
        <AppIcon name="lucide:chevron-down" :size="12" />
      </button>

      <div class="flex-1" />

      <IconButton icon="lucide:columns-2" :size="14" title="分屏" />
      <IconButton icon="lucide:search" :size="14" title="搜索" />
      <IconButton icon="lucide:clipboard" :size="14" title="复制" />
      <IconButton icon="lucide:trash-2" :size="14" title="清屏" />
      <IconButton icon="lucide:rotate-cw" :size="14" title="重连" />
      <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
    </div>

    <!-- 输出区 -->
    <div class="flex-1 overflow-y-auto p-4 font-mono text-[12.5px] leading-[1.75] scroll-thin">
      <p
        v-for="(line, index) in TERMINAL_LINES"
        :key="index"
        class="whitespace-pre text-term-fg"
      >
        <template v-if="line.length">
          <span
            v-for="(span, i) in line"
            :key="i"
            :class="span.tone ? TERM_TONE_CLASS[span.tone] : undefined"
          >{{ span.text }}</span>
        </template>
        <template v-else>&nbsp;</template>
        <!-- 光标跟在最后一行 -->
        <span
          v-if="index === TERMINAL_LINES.length - 1"
          class="ml-px inline-block h-[15px] w-[7px] translate-y-0.5 bg-term-fg"
        />
      </p>
    </div>
  </section>
</template>
