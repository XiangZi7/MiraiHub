<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, shallowRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { toast } from '@/composables/useToast'
import { useSqlSnippets } from '@/composables/useSqlSnippets'
import type { DatabaseKind } from '@/types/database'
import {
  snippetsFor,
  validateSnippet,
  type SqlSnippet,
} from '@/utils/sql-snippets'

const { t } = useI18n()

const props = defineProps<{
  databaseKind: DatabaseKind
  disabled?: boolean
}>()

const emit = defineEmits<{
  close: []
  insert: [snippet: SqlSnippet]
}>()

const { customSnippets, saveSnippet, removeSnippet } = useSqlSnippets()
const search = shallowRef('')
// 正在编辑时显示表单；id 为空表示新建。
const editing = shallowRef(false)
const form = reactive({
  id: '',
  prefix: '',
  label: '',
  body: '',
  kinds: undefined as DatabaseKind[] | undefined,
})

const snippets = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return snippetsFor(props.databaseKind, customSnippets.value).filter(
    item =>
      !keyword ||
      item.prefix.toLowerCase().includes(keyword) ||
      displayLabel(item).toLowerCase().includes(keyword) ||
      item.body.toLowerCase().includes(keyword)
  )
})

/** 内置片段的说明走 i18n，用户片段原样显示。 */
function displayLabel(snippet: SqlSnippet): string {
  return snippet.builtin ? t(snippet.label) : snippet.label
}

/** 打开编辑表单：传自定义片段时修改它，传内置片段时复制成新的自定义片段，不传则新建空白。 */
function openForm(snippet?: SqlSnippet): void {
  form.id = snippet && !snippet.builtin ? snippet.id : ''
  form.prefix = snippet?.prefix ?? ''
  form.label = snippet ? displayLabel(snippet) : ''
  form.body = snippet?.body ?? ''
  form.kinds = snippet?.kinds
  editing.value = true
}

/** 校验并保存表单，非法内容只提示不关闭表单。 */
function submit(): void {
  const prefix = form.prefix.trim()
  const error = validateSnippet({ prefix, body: form.body })
  if (error) {
    toast.warning(t(error))
    return
  }
  saveSnippet({
    id: form.id || crypto.randomUUID(),
    prefix,
    label: form.label.trim() || prefix,
    body: form.body,
    kinds: form.kinds,
  })
  editing.value = false
  toast.success(t('片段已保存'))
}

/** 删除一条自定义片段。 */
function remove(snippet: SqlSnippet): void {
  removeSnippet(snippet.id)
  toast.success(t('片段已删除'))
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-100">
      <AppDialog
        :title="
          editing ? (form.id ? t('编辑片段') : t('新建片段')) : t('SQL 片段')
        "
        :description="
          t(
            '输入触发词后从补全列表选择，Tab 在占位间跳转。自定义片段保存在本机。'
          )
        "
        wide
        @close="emit('close')"
      >
        <form
          v-if="editing"
          class="grid gap-3"
          @submit.prevent="submit"
        >
          <div class="grid grid-cols-[160px_1fr] gap-2.5">
            <label class="text-txt-3 grid gap-1 text-[11px]">
              {{ t('触发词') }}
              <AppInput
                v-model="form.prefix"
                monospace
                size="sm"
                autofocus
              />
            </label>
            <label class="text-txt-3 grid gap-1 text-[11px]">
              {{ t('片段说明') }}
              <AppInput
                v-model="form.label"
                size="sm"
              />
            </label>
          </div>
          <label class="text-txt-3 grid gap-1 text-[11px]">
            {{ t('片段内容') }}
            <textarea
              v-model="form.body"
              class="border-line-strong bg-terminal text-txt scroll-thin h-44 resize-none rounded-md border px-2.5 py-2 font-mono text-[12px] outline-none"
              spellcheck="false"
            />
          </label>
          <p class="text-txt-4 text-[11px]">
            {{
              t('sql.snippetPlaceholderHelp', {
                full: '$' + '{1:' + t('默认值') + '}',
                mirror: '$1',
                end: '$0',
                literal: '\\$',
              })
            }}
          </p>
        </form>
        <div
          v-else
          class="grid gap-2"
        >
          <AppInput
            v-model="search"
            size="sm"
            :placeholder="t('搜索片段')"
          />
          <div class="scroll-thin grid max-h-80 gap-0.5 overflow-y-auto">
            <div
              v-for="snippet in snippets"
              :key="snippet.id"
              class="hover:bg-hover flex h-8 shrink-0 items-center gap-2 rounded px-2 motion-safe:transition-colors"
            >
              <AppIcon
                name="lucide:square-code"
                :size="12"
                class="text-amber shrink-0"
              />
              <span
                class="text-txt w-20 shrink-0 truncate font-mono text-[12px]"
                >{{ snippet.prefix }}</span
              >
              <span class="text-txt-3 min-w-0 flex-1 truncate text-[12px]">{{
                displayLabel(snippet)
              }}</span>
              <span
                v-if="snippet.builtin"
                class="text-txt-4 shrink-0 text-[10px]"
                >{{ t('内置') }}</span
              >
              <IconButton
                icon="lucide:corner-down-left"
                :title="t('插入片段')"
                :disabled="disabled"
                @click="emit('insert', snippet)"
              />
              <IconButton
                :icon="snippet.builtin ? 'lucide:copy-plus' : 'lucide:pencil'"
                :title="snippet.builtin ? t('复制为自定义') : t('编辑片段')"
                @click="openForm(snippet)"
              />
              <IconButton
                v-if="!snippet.builtin"
                icon="lucide:trash-2"
                :title="t('删除片段')"
                @click="remove(snippet)"
              />
            </div>
            <p
              v-if="!snippets.length"
              class="text-txt-4 py-6 text-center text-[12px]"
            >
              {{ t('暂无片段') }}
            </p>
          </div>
        </div>
        <template #footer>
          <div class="flex-1" />
          <template v-if="editing">
            <AppButton @click="editing = false">
              {{ t('取消') }}
            </AppButton>
            <AppButton
              variant="primary"
              @click="submit"
            >
              {{ t('保存') }}
            </AppButton>
          </template>
          <template v-else>
            <AppButton @click="emit('close')">
              {{ t('关闭') }}
            </AppButton>
            <AppButton
              variant="primary"
              @click="openForm()"
            >
              {{ t('新建片段') }}
            </AppButton>
          </template>
        </template>
      </AppDialog>
    </div>
  </Teleport>
</template>
