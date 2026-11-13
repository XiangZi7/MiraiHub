<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps<{
  kind: string
  directory?: string
  branch?: string
  gitError?: string
  position: string
  size: string
}>()
defineEmits<{ retryGit: [] }>()
</script>

<template>
  <div
    class="mirai-terminal-footer flex h-7 shrink-0 items-center gap-2 border-t px-3.5 font-mono text-[11px] leading-none"
  >
    <span class="shrink-0">{{ kind }}</span>
    <template v-if="directory"
      ><span aria-hidden="true">·</span
      ><span
        class="min-w-0 truncate"
        :title="directory"
        >{{ directory }}</span
      ></template
    >
    <template v-if="branch"
      ><span aria-hidden="true">·</span
      ><span class="mirai-terminal-branch max-w-28 truncate"
        >⎇ {{ branch }}</span
      ></template
    >
    <div class="flex-1" />
    <button
      v-if="gitError"
      type="button"
      class="text-txt-3 hover:text-accent max-w-40 cursor-pointer truncate"
      :title="`${gitError}\n${t('点击重试')}`"
      @click="$emit('retryGit')"
    >
      {{ t('Git 信息不可用') }}
    </button>
    <span
      class="mirai-terminal-position shrink-0"
      :aria-label="t('终端光标位置')"
      :title="size"
      >{{ position }}</span
    >
    <span class="mirai-terminal-encoding shrink-0">· UTF-8</span>
  </div>
</template>
