<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useNotifications } from '@/composables/useToast'
import { formatDateTime } from '@/utils/time'
const { notifications, unreadCount, markAllRead, clearNotifications } =
  useNotifications()
const open = shallowRef(false)
const tones = { success: '成功', error: '错误', warning: '提醒', info: '消息' }
watch([open, unreadCount], ([visible]) => {
  if (visible) markAllRead()
})
</script>
<template>
  <div class="relative">
    <IconButton
      icon="lucide:bell"
      :title="`通知${unreadCount ? ` (${unreadCount} 条未读)` : ''}`"
      @click="open = !open"
    />
    <span
      v-if="unreadCount"
      class="pointer-events-none absolute right-0 top-0 size-1.5 rounded-full bg-violet"
    />
  </div>
  <Teleport to="body">
    <AppDialog
      v-if="open"
      title="通知中心"
      description="保留本次运行中此窗口的最近 100 条通知"
      @close="open = false"
    >
      <p
        v-if="!notifications.length"
        class="py-8 text-center text-xs text-txt-3"
      >
        暂无通知
      </p>
      <ol v-else class="space-y-3">
        <li
          v-for="item in notifications"
          :key="item.id"
          class="rounded-lg border border-line bg-card p-3"
        >
          <div
            class="mb-1 flex items-center justify-between gap-2 text-[10px] text-txt-4"
          >
            <span :class="item.tone === 'error' && 'text-danger'">{{
              tones[item.tone]
            }}</span>
            <time>{{ formatDateTime(item.createdAt) }}</time>
          </div>
          <p class="break-words text-xs text-txt">{{ item.title }}</p>
          <p
            v-if="item.description"
            class="mt-1 whitespace-pre-wrap break-words text-[11px] text-txt-3"
          >
            {{ item.description }}
          </p>
        </li>
      </ol>
      <template #footer>
        <button
          class="text-xs text-txt-3 disabled:opacity-40"
          :disabled="!notifications.length"
          @click="clearNotifications"
        >
          清空通知
        </button>
      </template>
    </AppDialog>
  </Teleport>
</template>
