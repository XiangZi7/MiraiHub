<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useSettings } from '@/composables/useSettings'
import { formatShortcut } from '@/utils/shortcut'
import { openSettingsWindow } from '@/utils/window'

const { settings } = useSettings()
const open = shallowRef(false)
function openSettings(): void {
  open.value = false
  openSettingsWindow()
}
const shortcuts = computed(() => [
  ['命令面板', formatShortcut(settings.shortcutPalette)],
  ['新建本地终端', formatShortcut(settings.shortcutTerminal)],
  ['搜索入口', formatShortcut(settings.shortcutSearch)],
  ['远端文件', formatShortcut(settings.shortcutFiles)],
  ['终端内容搜索', 'Ctrl+F'],
  ['执行 SQL', 'Ctrl+Enter'],
  ['全屏 / 退出', 'F11 / Esc'],
])
</script>
<template>
  <IconButton
    icon="lucide:life-buoy"
    title="帮助与快捷键"
    @click="open = true"
  />
  <Teleport to="body">
    <AppDialog
      v-if="open"
      title="帮助与快捷键"
      @close="open = false"
    >
      <p class="text-txt-3 mb-3 text-xs leading-relaxed">
        点击左侧连接打开会话。SSH
        工作区右侧可切换系统概览和文件；文件支持双击打开、右键操作及拖入上传。
      </p>
      <dl class="divide-line-soft divide-y">
        <div
          v-for="[label, keys] in shortcuts"
          :key="label"
          class="flex justify-between gap-4 py-2 text-xs"
        >
          <dt class="text-txt-2">{{ label }}</dt>
          <dd class="text-txt-3 font-mono">{{ keys }}</dd>
        </div>
      </dl>
      <p class="text-txt-3 mt-3 text-[11px] leading-relaxed">
        设置 → 外观可调整全局字体与界面大小；设置 →
        终端可单独调整终端字号。全局快捷键可在设置中自定义。
      </p>
      <template #footer
        ><AppButton
          size="sm"
          @click="openSettings"
          >打开设置</AppButton
        ></template
      >
    </AppDialog>
  </Teleport>
</template>
