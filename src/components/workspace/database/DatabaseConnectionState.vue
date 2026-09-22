<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import SessionErrorNotice from '@/components/ui/SessionErrorNotice.vue'
import type { SshSessionStatus } from '@/types/ssh'

const { t } = useI18n()

defineProps<{
  status: SshSessionStatus
  needsPassword: boolean
  error?: string
}>()

const emit = defineEmits<{
  connect: [password?: string]
  dismissError: []
}>()

const password = defineModel<string>('password', { required: true })
</script>

<template>
  <div class="grid min-h-0 flex-1 place-items-center p-6">
    <div class="flex w-full max-w-80 flex-col items-center gap-3 text-center">
      <div
        class="border-line bg-card text-txt-3 grid size-12 place-items-center rounded-xl border"
      >
        <AppIcon
          :name="
            status === 'connecting'
              ? 'lucide:loader-circle'
              : 'lucide:database-zap'
          "
          :size="22"
          :class="status === 'connecting' && 'animate-spin'"
        />
      </div>
      <SessionErrorNotice
        v-if="error"
        class="w-full text-left"
        :message="error"
        :title="t('数据库连接失败')"
        :retry-label="t('重新连接')"
        @retry="emit('connect', needsPassword ? password : undefined)"
        @dismiss="emit('dismissError')"
      />
      <p class="text-txt-2 text-sm">
        {{
          status === 'connecting' ? t('正在连接数据库…') : t('数据库连接未建立')
        }}
      </p>
      <AppTextField
        v-if="needsPassword"
        v-model="password"
        class="w-full text-left"
        :label="t('Password')"
        type="password"
        autocomplete="current-password"
        :placeholder="t('输入本次连接使用的密码')"
        @keyup.enter="emit('connect', password)"
      />
      <AppButton
        v-if="status !== 'connecting'"
        variant="primary"
        @click="emit('connect', needsPassword ? password : undefined)"
      >
        <AppIcon
          name="lucide:plug-zap"
          :size="13"
        />
        {{ t('重新连接') }}
      </AppButton>
    </div>
  </div>
</template>
