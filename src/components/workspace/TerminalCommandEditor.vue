<script setup lang="ts">
import { onMounted, reactive, toRefs, useTemplateRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { TerminalCommand } from '@/types/terminal-command'

const props = defineProps<{ command: TerminalCommand | null }>()
const emit = defineEmits<{
  save: [name: string, command: string]
  cancel: []
}>()
// 响应式状态
const state = reactive({
  // 指令在菜单中显示的名称
  name: props.command?.name ?? '',
  // 等待用户按回车执行的单行命令
  value: props.command?.command ?? '',
})
const { name, value } = toRefs(state)
const nameInput = useTemplateRef<HTMLInputElement>('nameInput')
onMounted(() => nameInput.value?.focus())
function save(): void {
  emit('save', state.name, state.value)
}
</script>

<template>
  <form
    class="grid gap-3 p-3"
    @submit.prevent="save"
  >
    <label class="grid gap-1.5 text-xs"
      >名称<input
        ref="nameInput"
        v-model="name"
        class="field"
        maxlength="80"
        required
        placeholder="例如：查看 Docker 容器"
    /></label>
    <label class="grid gap-1.5 text-xs"
      >命令（单行）<input
        v-model="value"
        class="field font-mono"
        maxlength="8192"
        required
        placeholder="docker ps"
        spellcheck="false"
        autocomplete="off"
    /></label>
    <div class="flex justify-end gap-2">
      <AppButton
        size="sm"
        @click="emit('cancel')"
        >取消</AppButton
      >
      <AppButton
        size="sm"
        type="submit"
        variant="primary"
        :disabled="!name.trim() || !value.trim()"
        >保存</AppButton
      >
    </div>
  </form>
</template>
