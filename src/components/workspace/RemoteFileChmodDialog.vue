<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, toRefs } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { toast } from '@/composables/useToast'
import type { SshRemoteFile } from '@/types/ssh'
import {
  formatOctalMode,
  parseOctalMode,
  parsePermissionString,
} from '@/utils/file-mode'

const { t } = useI18n()

const props = defineProps<{ file: SshRemoteFile; busy?: boolean }>()
const emit = defineEmits<{
  submit: [mode: number, recursive: boolean]
  close: []
}>()

const initialMode = parsePermissionString(props.file.permissions)

// 响应式状态
const state = reactive({
  // 当前权限位（含 setuid/setgid/sticky），复选框与八进制输入共同维护
  mode: initialMode,
  // 八进制输入框的文本，输入非法时保留原文直到修正
  octal: formatOctalMode(initialMode),
  // 是否把同一权限递归应用到目录内所有子项
  recursive: false,
})
const { octal, recursive } = toRefs(state)

const isDirectory = computed(() => props.file.kind === 'directory')
const octalValid = computed(() => parseOctalMode(state.octal) !== null)
const roles = computed(() => [
  { label: t('所有者'), shift: 6 },
  { label: t('用户组'), shift: 3 },
  { label: t('其他用户'), shift: 0 },
])
const actions = computed(() => [
  { label: t('读取 (r)'), bit: 4 },
  { label: t('写入 (w)'), bit: 2 },
  { label: t('执行 (x)'), bit: 1 },
])

// 判断某个角色的某一位是否已勾选
function hasBit(shift: number, bit: number): boolean {
  return (state.mode & (bit << shift)) !== 0
}

// 勾选或取消某一位，并同步八进制输入框
function toggleBit(shift: number, bit: number, checked: boolean): void {
  const mask = bit << shift
  state.mode = checked ? state.mode | mask : state.mode & ~mask
  state.octal = formatOctalMode(state.mode)
}

// 八进制输入合法时立即同步复选框
function updateOctal(value: string): void {
  state.octal = value
  const parsed = parseOctalMode(value)
  if (parsed !== null) state.mode = parsed
}

// 校验后提交权限值与递归选项
function submit(): void {
  const parsed = parseOctalMode(state.octal)
  if (parsed === null) {
    toast.warning(t('请输入 3 到 4 位八进制权限，例如 644 或 0755'))
    return
  }
  emit('submit', parsed, isDirectory.value && state.recursive)
}
</script>

<template>
  <AppDialog
    :title="t('修改权限')"
    :description="file.path"
    @close="emit('close')"
  >
    <form
      class="space-y-4"
      @submit.prevent="submit"
    >
      <table class="w-full text-xs">
        <thead>
          <tr class="text-txt-3">
            <th class="pb-2 text-left font-medium" />
            <th
              v-for="action in actions"
              :key="action.bit"
              class="pb-2 text-center font-medium"
            >
              {{ action.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="role in roles"
            :key="role.shift"
          >
            <th class="text-txt-2 py-1.5 text-left font-medium">
              {{ role.label }}
            </th>
            <td
              v-for="action in actions"
              :key="action.bit"
              class="py-1.5 text-center"
            >
              <AppCheckbox
                :model-value="hasBit(role.shift, action.bit)"
                :label="`${role.label} ${action.label}`"
                hide-label
                @update:model-value="toggleBit(role.shift, action.bit, $event)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <label class="block">
        <span class="text-txt-2 block text-[11px] font-medium">
          {{ t('八进制权限') }}
        </span>
        <AppInput
          :model-value="octal"
          class="mt-1.5"
          monospace
          maxlength="4"
          autocomplete="off"
          :aria-invalid="!octalValid"
          @update:model-value="updateOctal"
        />
      </label>

      <AppCheckbox
        v-if="isDirectory"
        v-model="recursive"
        :label="t('递归应用到子项')"
        :description="t('目录内所有文件和子目录都会设为相同权限，不跟随符号链接。')"
      />
    </form>

    <template #footer>
      <div class="flex-1" />
      <AppButton
        size="sm"
        @click="emit('close')"
      >
        {{ t('取消') }}
      </AppButton>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="busy || !octalValid"
        @click="submit"
      >
        {{ t('应用权限') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
