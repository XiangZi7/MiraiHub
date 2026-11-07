<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useSqlParamsPrompt } from '@/composables/useSqlParamsPrompt'
import type { RememberedSqlParam } from '@/utils/sql-params'
import { sqlParamLabel } from '@/utils/sql-params'

const { t } = useI18n()
const { request } = useSqlParamsPrompt()

const values = reactive<Record<string, RememberedSqlParam>>({})

watch(
  request,
  current => {
    for (const key of Object.keys(values)) delete values[key]
    if (!current) return
    for (const key of current.keys)
      values[key] = { ...(current.initial[key] ?? { value: '', isNull: false }) }
  },
  { immediate: true }
)

const preview = computed(() => {
  const sql = request.value?.sql ?? ''
  return sql.length > 600 ? `${sql.slice(0, 600)}…` : sql
})

function close(): void {
  request.value?.resolve(null)
}

function submit(): void {
  const current = request.value
  if (!current) return
  current.resolve(
    Object.fromEntries(current.keys.map(key => [key, { ...values[key]! }]))
  )
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="request"
      class="fixed inset-0 z-100"
    >
      <AppDialog
        :title="t('填写查询参数')"
        :description="t('值作为绑定参数传给数据库，不会拼接进 SQL。')"
        wide
        @close="close"
      >
        <form
          class="grid gap-3"
          @submit.prevent="submit"
        >
          <pre
            class="bg-terminal text-txt-3 scroll-thin max-h-28 overflow-auto rounded-md px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap"
            >{{ preview }}</pre
          >
          <div
            v-for="(key, index) in request.keys"
            :key="key"
            class="grid grid-cols-[minmax(90px,auto)_1fr_auto] items-center gap-2.5"
          >
            <label
              :for="`sql-param-${index}`"
              class="text-violet truncate font-mono text-[12px]"
              >{{ sqlParamLabel(key) }}</label
            >
            <AppInput
              :id="`sql-param-${index}`"
              v-model="values[key]!.value"
              monospace
              size="sm"
              :disabled="values[key]!.isNull"
              :placeholder="values[key]!.isNull ? 'NULL' : t('参数值')"
              :autofocus="index === 0"
              @keydown.enter.prevent="submit"
            />
            <AppCheckbox
              v-model="values[key]!.isNull"
              label="NULL"
            />
          </div>
          <p class="text-txt-4 text-[11px]">
            {{ t('上次填写的值会被记住。按 Enter 执行。') }}
          </p>
        </form>
        <template #footer>
          <div class="flex-1" />
          <AppButton @click="close">
            {{ t('取消') }}
          </AppButton>
          <AppButton
            variant="primary"
            @click="submit"
          >
            {{ t('执行') }}
          </AppButton>
        </template>
      </AppDialog>
    </div>
  </Teleport>
</template>
