<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import * as connectionsStore from '@/api/connections'
import { errorMessage } from '@/api/ssh'
import { useConnections } from '@/composables/useConnections'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { LOCAL_SHELL_OPTIONS } from '@/constants/connection'
import type {
  ConnectionTagColor,
  LocalShellKind,
  NewConnection,
} from '@/types/connection'
import { isLocalConnection } from '@/types/connection'
import { IS_TAURI } from '@/utils/window'
import ConnectionTagEditor from './ConnectionTagEditor.vue'

const { settings } = useSettings()

const props = withDefaults(
  defineProps<{
    connectionId?: string
  }>(),
  { connectionId: '' }
)

const emit = defineEmits<{ close: [] }>()
const { create, update, tags: sharedTags } = useConnections()
const saving = shallowRef(false)
const loading = shallowRef(Boolean(props.connectionId))

const form = reactive({
  name: '',
  group: '',
  shell: settings.terminalShell as LocalShellKind,
  workingDirectory: '',
  tags: '',
  tagColor: 'violet' as ConnectionTagColor,
  description: '',
})

const shellOptions = LOCAL_SHELL_OPTIONS.map(option => ({
  value: option.value,
  label: option.label,
  description: option.description,
}))

const ready = computed(() => Boolean(form.name.trim()))

onMounted(async () => {
  if (!props.connectionId) return

  try {
    const connection = await connectionsStore.get(props.connectionId)
    if (!connection || !isLocalConnection(connection)) {
      toast.error('找不到要编辑的本地终端')
      return
    }
    Object.assign(form, {
      name: connection.name,
      group: connection.group,
      shell: connection.settings.shell,
      workingDirectory: connection.settings.workingDirectory,
      tags: connection.tags.join(', '),
      tagColor: connection.tagColor,
      description: connection.description,
    })
  } catch (error) {
    toast.error({ title: '读取本地终端失败', description: errorMessage(error) })
  } finally {
    loading.value = false
  }
})

async function browseDirectory(): Promise<void> {
  if (!IS_TAURI) return
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择本地终端工作目录',
  })
  if (typeof selected === 'string') form.workingDirectory = selected
}

function normalizedTags(): string[] {
  return [
    ...new Set(
      form.tags
        .split(/[,，]/)
        .map(tag => tag.trim())
        .filter(Boolean)
    ),
  ]
}

async function save(): Promise<void> {
  if (!ready.value || saving.value) {
    toast.warning('请填写终端名称')
    return
  }

  saving.value = true
  try {
    const input: NewConnection = {
      name: form.name.trim(),
      kind: 'local',
      host: 'localhost',
      port: 0,
      username: '',
      group: form.group.trim(),
      description: form.description.trim(),
      tags: normalizedTags(),
      tagColor: form.tagColor,
      settings: {
        shell: form.shell,
        workingDirectory: form.workingDirectory.trim(),
      },
    }

    if (props.connectionId) await update(props.connectionId, input)
    else await create(input)
    toast.success(props.connectionId ? '本地终端已更新' : '本地终端已保存')
    emit('close')
  } catch (error) {
    toast.error({ title: '保存本地终端失败', description: errorMessage(error) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form
    class="flex min-h-0 flex-1 flex-col"
    @submit.prevent="save"
  >
    <div class="local-heading">
      <div
        class="bg-violet/12 text-violet grid size-9 place-items-center rounded-lg"
      >
        <span class="text-base">›_</span>
      </div>
      <div>
        <h2 class="text-txt text-xs font-semibold">Local Terminal</h2>
        <p class="text-txt-4 mt-0.5 text-[10.5px]">
          在本机 PTY 中启动一个独立 Shell 会话
        </p>
      </div>
    </div>

    <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div class="grid gap-3.5">
        <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <AppTextField
            v-model="form.name"
            label="Name"
            placeholder="e.g. Development"
            required
            autofocus
          />
          <AppTextField
            v-model="form.group"
            label="Group"
            placeholder="e.g. Local"
          />
        </div>
        <AppSelect
          v-model="form.shell"
          label="Shell"
          :options="shellOptions"
        />
        <AppTextField
          v-model="form.workingDirectory"
          label="Working Directory"
          placeholder="留空使用当前用户目录"
          action-icon="lucide:folder-open"
          action-title="选择工作目录"
          @action="browseDirectory"
        />
        <ConnectionTagEditor
          v-model="form.tags"
          v-model:color="form.tagColor"
          :available-tags="sharedTags"
        />
        <div class="space-y-1.5">
          <label
            for="local-description"
            class="text-txt-2 block text-[11px] font-medium"
            >Description (Optional)</label
          >
          <textarea
            id="local-description"
            v-model="form.description"
            class="local-description"
            rows="3"
            placeholder="Add a description for this terminal…"
          />
        </div>
      </div>
    </div>

    <footer class="local-footer">
      <div class="flex-1" />
      <AppButton @click="emit('close')">Cancel</AppButton>
      <AppButton
        type="submit"
        variant="primary"
        :disabled="saving || loading"
      >
        {{ saving ? 'Saving…' : props.connectionId ? 'Update' : 'Save' }}
      </AppButton>
    </footer>
  </form>
</template>

<style scoped>
.local-heading {
  display: flex;
  height: 64px;
  flex-shrink: 0;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 20px;
}

.local-description {
  width: 100%;
  resize: none;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  padding: 8px 10px;
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
}

.local-description:focus {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.local-footer {
  display: flex;
  height: 58px;
  flex-shrink: 0;
  align-items: center;
  gap: 9px;
  border-top: 1px solid var(--color-line-soft);
  padding: 0 18px;
}
</style>
