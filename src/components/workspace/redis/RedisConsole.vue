<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import type { RedisCommandResult } from '@/types/redis'
const props = defineProps<{
  busy: boolean
  result: RedisCommandResult | null
}>()
const command = defineModel<string>({ required: true })
const emit = defineEmits<{ execute: [] }>()
const { t } = useI18n()
const formatted = computed(() =>
  typeof props.result?.value === 'string'
    ? props.result.value
    : JSON.stringify(props.result?.value, null, 2)
)
</script>

<template>
  <section
    class="border-line bg-panel flex max-h-[45%] min-h-36 shrink-0 flex-col gap-2 border-t p-3"
    :aria-label="t('Redis 命令')"
  >
    <form
      class="flex items-end gap-2"
      @submit.prevent="emit('execute')"
    >
      <AppTextField
        v-model="command"
        :label="t('Redis 命令')"
        placeholder='SET "user:1" "hello" EX 3600'
        :disabled="busy"
        class="min-w-0 flex-1 font-mono"
      />
      <AppButton
        type="submit"
        variant="primary"
        :disabled="busy || !command.trim()"
        >{{ busy ? t('执行中…') : t('执行') }}</AppButton
      >
    </form>
    <p class="text-txt-3 text-[11px]">
      {{ t('每次执行一条命令，支持引号和转义；写入命令会立即生效') }}
    </p>
    <template v-if="result">
      <pre
        class="scroll-thin bg-card text-txt-2 min-h-8 overflow-auto rounded p-2 font-mono text-xs break-all whitespace-pre-wrap"
        >{{ formatted }}</pre>
      <span class="text-txt-3 text-[11px]"
        >{{ result.elapsedMs }} ms
        <span v-if="result.truncated"> · {{ t('结果已截断') }}</span></span
      >
    </template>
  </section>
</template>
