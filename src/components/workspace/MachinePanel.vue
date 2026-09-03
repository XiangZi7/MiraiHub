<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { MACHINE_VIEWS } from '@/constants/workspace'
import { cn } from '@/utils/cn'
import FilesView from './FilesView.vue'
import ServerOverview from './ServerOverview.vue'

/**
 * 机器详情面板。
 * 概览与文件都是"当前这台机器"的视图，所以收在同一个面板里用分段切换，
 * 而不是各占一个侧栏菜单 —— 侧栏只负责选机器/选模块。
 */

// 响应式状态
const state = reactive({
  // 当前视图 id，取值见 MACHINE_VIEWS
  view: 'overview',
})

const { view } = toRefs(state)

defineEmits<{
  /** 请求收起面板 */
  close: []
}>()
</script>

<template>
  <section class="pane w-[42%] min-w-96 max-w-155 shrink-0">
    <!-- 视图切换 -->
    <header class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft px-2">
      <button
        v-for="item in MACHINE_VIEWS"
        :key="item.id"
        type="button"
        :class="cn('seg', view === item.id && 'seg-active')"
        @click="view = item.id"
      >
        <AppIcon :name="item.icon" :size="13" />
        <span>{{ item.label }}</span>
      </button>

      <div class="flex-1" />

      <IconButton
        icon="lucide:panel-right-close"
        :size="14"
        title="收起机器面板"
        @click="$emit('close')"
      />
    </header>

    <ServerOverview v-if="view === 'overview'" />
    <FilesView v-else />
  </section>
</template>
