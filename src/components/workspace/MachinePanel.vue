<script setup lang="ts">
import { nextTick, toRef, useTemplateRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { MACHINE_VIEWS } from '@/constants/workspace'
import type { MachineViewId } from '@/types'
import type { SavedConnection } from '@/types/connection'
import { cn } from '@/utils/cn'
import FilesView from './FilesView.vue'
import ServerOverview from './ServerOverview.vue'

/**
 * 机器详情面板。
 * 概览与文件都是"当前这台机器"的视图，所以收在同一个面板里用分段切换，
 * 而不是各占一个侧栏菜单 —— 侧栏只负责选机器/选模块。
 */

const props = defineProps<{
  /** 当前标签对应的连接，无标签时为 undefined */
  connection?: SavedConnection
  /** 后端 SSH 会话 id，未连上时为空串 */
  sessionId: string
  /** 由主窗口统一管理的面板宽度 */
  width: number
}>()

// 当前视图由 MainWindow 持有：命令面板的 Open Files 需要越过本组件直接切到 Files
const view = defineModel<MachineViewId>('view', { required: true })

defineEmits<{
  action: [id: string]
  /** 请求收起面板 */
  close: []
}>()

// 转成 ref 传给子组件的 composable：它们 watch 会话 id 的变化来重新取数
const filesView = useTemplateRef<InstanceType<typeof FilesView>>('filesView')
async function upload(): Promise<void> {
  view.value = 'files'
  await nextTick()
  await filesView.value?.pickUploadFiles()
}
defineExpose({ upload })

const sessionId = toRef(props, 'sessionId')
</script>

<template>
  <section class="pane min-w-0 shrink-0" :style="{ width: `${props.width}px` }">
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

    <ServerOverview
      v-if="view === 'overview'"
      :connection="connection"
      :session-id="sessionId"
      @action="$emit('action', $event)"
    />
    <FilesView
      v-else
      ref="filesView"
      :session-id="sessionId"
      :connection-name="connection ? `${connection.name} (${connection.host})` : ''"
    />
  </section>
</template>
