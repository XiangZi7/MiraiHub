<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import RemotePathInput from '@/components/workspace/RemotePathInput.vue'
import type { SshRemoteFile } from '@/types/ssh'
defineProps<{
  path: string
  entries: readonly SshRemoteFile[]
  connected: boolean
  loading: boolean
  local?: boolean
}>()
const filter = defineModel<string>('filter', { required: true })
const emit = defineEmits<{ navigate: [path: string] }>()
const { t } = useI18n()
</script>
<template>
  <div class="border-line-soft flex shrink-0 border-b px-2 py-1.5">
    <RemotePathInput
      :path="path"
      :entries="entries"
      :connected="connected"
      :loading="loading"
      :local="local"
      @navigate="emit('navigate', $event)"
    />
  </div>
  <div
    class="border-line-soft flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
  >
    <AppIcon
      name="lucide:search"
      :size="13"
      class="text-txt-3"
    />
    <input
      v-model="filter"
      :aria-label="t('筛选当前目录文件')"
      :placeholder="t('筛选当前目录文件…')"
      class="text-txt min-w-0 flex-1 bg-transparent text-xs outline-none"
      @keydown.esc.stop="filter = ''"
    />
    <IconButton
      v-if="filter"
      icon="lucide:x"
      :size="12"
      :title="t('清除文件筛选')"
      @click="filter = ''"
    />
  </div>
  <div
    class="remote-file-columns border-line-soft text-txt-3 grid shrink-0 grid-cols-[1fr_80px_130px] gap-3 border-b px-3 py-1.5 text-[11px] font-medium"
  >
    <span>{{ t('Name') }}</span
    ><span class="text-right">{{ t('Size') }}</span
    ><span class="remote-file-modified">{{ t('Modified') }}</span>
  </div>
</template>
