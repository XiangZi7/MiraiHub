<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { onMounted, reactive, toRefs, useTemplateRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { TerminalCommand } from '@/types/terminal-command'

const { t } = useI18n()

const props = defineProps<{ command: TerminalCommand | null }>()
const emit = defineEmits<{
  save: [
    name: string,
    command: string,
    metadata: Pick<TerminalCommand, 'folder' | 'tags' | 'description'>,
  ]
  cancel: []
}>()
// 响应式状态
const state = reactive({
  // 指令在菜单中显示的名称
  name: props.command?.name ?? '',
  // 等待用户按回车执行的单行命令
  value: props.command?.command ?? '',
  // 用于分类检索的片段元数据
  folder: props.command?.folder ?? '',
  tags: props.command?.tags?.join(', ') ?? '',
  description: props.command?.description ?? '',
})
const { name, value, folder, tags, description } = toRefs(state)
const nameInput = useTemplateRef<HTMLInputElement>('nameInput')
onMounted(() => nameInput.value?.focus())
/** 连同片段分类一起保存，变量使用双花括号占位。 */
function save(): void {
  emit('save', state.name, state.value, {
    folder: state.folder.trim(),
    tags: state.tags
      .split(/[,，]/u)
      .map(tag => tag.trim())
      .filter(Boolean),
    description: state.description.trim(),
  })
}
</script>

<template>
  <form
    class="grid gap-3 p-3"
    @submit.prevent="save"
  >
    <label class="grid gap-1.5 text-xs">
      {{ t('名称') }}
      <input
        ref="nameInput"
        v-model="name"
        class="field"
        maxlength="80"
        required
        :placeholder="t('例如：查看 Docker 容器')"
    /></label>
    <label class="grid gap-1.5 text-xs">
      {{ t('命令（单行）') }}
      <input
        v-model="value"
        class="field font-mono"
        maxlength="8192"
        required
        placeholder="docker ps"
        spellcheck="false"
        autocomplete="off"
    /></label>
    <p class="text-txt-3 text-xs">{{ t('使用双花括号填写变量') }}</p>
    <label class="grid gap-1.5 text-xs"
      >{{ t('分组')
      }}<input
        v-model="folder"
        class="field"
        maxlength="80"
    /></label>
    <label class="grid gap-1.5 text-xs"
      >{{ t('标签（逗号分隔）')
      }}<input
        v-model="tags"
        class="field"
        maxlength="500"
    /></label>
    <label class="grid gap-1.5 text-xs"
      >{{ t('说明')
      }}<input
        v-model="description"
        class="field"
        maxlength="500"
    /></label>
    <div class="flex justify-end gap-2">
      <AppButton
        size="sm"
        @click="emit('cancel')"
      >
        {{ t('取消') }}
      </AppButton>
      <AppButton
        size="sm"
        type="submit"
        variant="primary"
        :disabled="!name.trim() || !value.trim()"
      >
        {{ t('保存') }}
      </AppButton>
    </div>
  </form>
</template>
