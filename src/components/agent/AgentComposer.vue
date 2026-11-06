<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  AgentApprovalMode,
  AgentDraftAttachment,
  AgentUsage,
} from '@/types/agent'
import {
  AGENT_FILE_ACCEPT,
  AGENT_MAX_PROMPT_BYTES,
  agentImageUrl,
  bytesToSize,
  clipboardImages,
} from '@/utils/agent-attachments'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AgentProfileSelect from '@/components/agent/AgentProfileSelect.vue'
import AgentPermissionSelect from '@/components/agent/AgentPermissionSelect.vue'
import AgentContextPreview from '@/components/agent/AgentContextPreview.vue'
import AgentUsageStats from '@/components/agent/AgentUsageStats.vue'
import { useAgentErrorToasts } from '@/composables/useAgentErrorToasts'
import { useAgentDictation } from '@/composables/useAgentDictation'

import AgentPromptsDialog from '@/components/agent/agent-prompts-dialog.vue'
import { listAgentPrompts, type AgentPrompt } from '@/api/agent-prompts'
import { toast } from '@/composables/useToast'

const props = withDefaults(
  defineProps<{
    usage?: AgentUsage
    disabled: boolean
    /** 审批方式独立于发送状态，运行中或等待审批时仍可调整。 */
    permissionDisabled?: boolean
    busy: boolean
    guidance?: { id: string; text: string }[]
    canSend: boolean
    awaitingApproval: boolean
    isDatabase: boolean
    isRedis?: boolean
    attachments: AgentDraftAttachment[]
    reading: boolean
    readingProgress?: string
    attachmentError: string
    activeId: string
    profileOptions: { value: string; label: string; disabled?: boolean }[]
    profileDisabled: boolean
    profileError: string
  }>(),
  { permissionDisabled: undefined }
)
const prompt = defineModel<string>({ required: true })
const approvalMode = defineModel<AgentApprovalMode>('approvalMode', {
  required: true,
})
const emit = defineEmits<{
  submit: []
  stop: []
  selectProfile: [id: string]
  attach: [files: File[]]
  removeAttachment: [id: string]
  cancelReading: []
  editGuidance: [id: string]
  removeGuidance: [id: string]
}>()
const { t } = useI18n()
const dictation = useAgentDictation(
  prompt,
  computed(
    () =>
      props.disabled || props.busy || props.awaitingApproval || props.reading
  )
)
const { listening, speechError, supported: speechSupported } = dictation
useAgentErrorToasts(
  () => props.attachmentError,
  () => props.profileError,
  speechError
)
// 响应式状态
const state = reactive({
  // 已保存的提示词模板
  prompts: [] as AgentPrompt[],
  // 当前键盘选中的斜杠菜单项
  promptIndex: 0,
  // 模板管理弹窗
  managingPrompts: false,
  // Escape 关闭当前菜单，直到再次修改输入
  promptsDismissed: false,
})
const { managingPrompts, promptIndex } = toRefs(state)
const promptOptions = computed(() =>
  !state.promptsDismissed &&
  prompt.value.startsWith('/') &&
  !/\s/u.test(prompt.value)
    ? state.prompts.filter(item =>
        item.name.toLowerCase().startsWith(prompt.value.toLowerCase())
      )
    : []
)
/** 重新读取本地模板，跨窗口改动在下一次打开菜单时生效。 */
function refreshPrompts(): void {
  try {
    state.prompts = listAgentPrompts()
  } catch (error) {
    toast.error(String(error))
  }
}
/** 用模板回填草稿，只填写内容，不触发自动发送。 */
function choosePrompt(item: AgentPrompt): void {
  prompt.value = item.content
  void nextTick(() => textarea.value?.focus())
}
onMounted(refreshPrompts)
watch(prompt, value => {
  state.promptsDismissed = false
  state.promptIndex = 0
  if (value === '/') refreshPrompts()
})
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
defineExpose({ focus: () => textarea.value?.focus() })
const placeholder = computed(() =>
  props.awaitingApproval
    ? t('请先审批或拒绝上方操作…')
    : props.busy
      ? t('agent.guidancePlaceholder')
      : props.isRedis
        ? t('询问 Redis 键、TTL，或描述要执行的命令…')
        : props.isDatabase
          ? t('询问数据库，或描述要完成的操作…')
          : t('agent.promptPlaceholder')
)
// 优先处理斜杠菜单键盘选择，再以 Enter 提交正文；Shift+Enter 和输入法保留原行为。
function keydown(event: KeyboardEvent): void {
  if (!event.isComposing && promptOptions.value.length) {
    if (event.key === 'Escape') {
      event.preventDefault()
      state.promptsDismissed = true
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      state.promptIndex =
        (state.promptIndex +
          (event.key === 'ArrowDown' ? 1 : -1) +
          promptOptions.value.length) %
        promptOptions.value.length
      return
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault()
      choosePrompt(promptOptions.value[state.promptIndex]!)
      return
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    event.stopPropagation()
    if (props.canSend) emit('submit')
  }
}
// 只在普通消息模式读取所选附件，引导消息保持文字输入。
function selectFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  if (!props.disabled && !props.busy)
    emit('attach', Array.from(input.files ?? []))
  input.value = ''
}
// 粘贴图片时走已有附件流程，运行中的文字引导不接收图片附件。
function paste(event: ClipboardEvent): void {
  const files = clipboardImages(event.clipboardData)
  if (!files.length) return
  if (!event.clipboardData?.getData('text/plain')) event.preventDefault()
  if (!props.disabled && !props.reading && !props.busy) emit('attach', files)
}
// 将拖入文件交给附件读取流程，模型运行时保留当前引导输入。
function drop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length && !props.disabled && !props.reading && !props.busy)
    emit('attach', files)
}
watch(
  prompt,
  async () => {
    await nextTick()
    if (!textarea.value) return
    textarea.value.style.height = 'auto'
    textarea.value.style.height = `${Math.min(160, textarea.value.scrollHeight)}px`
  },
  { immediate: true }
)
</script>

<template>
  <footer
    data-agent-composer
    class="min-w-0 shrink-0 px-3 pt-2 pb-2"
  >
    <div
      v-if="promptOptions.length && !disabled && !busy"
      class="border-line bg-panel mb-2 grid gap-1 rounded-lg border p-1"
      role="listbox"
      :aria-label="t('斜杠命令')"
    >
      <button
        v-for="(item, index) in promptOptions"
        :key="item.id"
        type="button"
        role="option"
        :aria-selected="index === promptIndex"
        :class="index === promptIndex && 'bg-hover'"
        class="text-txt-2 flex gap-2 rounded px-2 py-1.5 text-left text-xs"
        @click="choosePrompt(item)"
      >
        <span class="text-accent shrink-0">{{ item.name }}</span
        ><span class="truncate">{{ item.content }}</span>
      </button>
      <button
        type="button"
        class="text-txt-3 p-2 text-left text-xs"
        @click="managingPrompts = true"
      >
        {{ t('管理提示词模板') }}
      </button>
    </div>
    <Teleport
      v-if="managingPrompts"
      to="body"
      ><AgentPromptsDialog
        @close="managingPrompts = false"
        @saved="refreshPrompts"
    /></Teleport>
    <ul
      v-if="guidance?.length"
      class="border-line bg-card mb-1.5 max-h-32 overflow-auto rounded-xl border px-2 py-1"
      :aria-label="t('agent.queuedGuidance')"
    >
      <li
        v-for="message in guidance"
        :key="message.id"
        class="text-txt-2 flex min-w-0 items-center gap-2 py-1 text-xs"
      >
        <AppIcon
          name="lucide:message-circle-more"
          :size="13"
          class="shrink-0"
        />
        <span
          class="min-w-0 flex-1 truncate"
          :title="message.text"
          >{{ message.text }}</span
        >
        <IconButton
          icon="lucide:pencil"
          :size="13"
          :title="t('agent.editGuidance')"
          @click="emit('editGuidance', message.id)"
        />
        <IconButton
          icon="lucide:trash-2"
          :size="13"
          :title="t('agent.removeGuidance')"
          @click="emit('removeGuidance', message.id)"
        />
      </li>
    </ul>
    <form
      class="border-accent/35 focus-within:border-accent/65 bg-input min-w-0 rounded-2xl border px-3 py-2.5"
      @submit.prevent="canSend && emit('submit')"
      @dragover.prevent
      @drop.prevent="drop"
    >
      <div
        v-if="attachments.length"
        class="scroll-thin flex max-h-[150px] min-w-0 flex-wrap gap-1.5 overflow-y-auto pb-[7px]"
        :aria-label="t('待发送附件')"
      >
        <div
          v-for="file in attachments"
          :key="file.id"
          class="max-w-full min-w-0"
          :class="
            file.source === 'context'
              ? 'block w-full border-0 bg-transparent p-0'
              : 'border-line-soft bg-card text-txt-2 flex items-center gap-[7px] rounded-[9px] border px-[7px] py-1.5'
          "
        >
          <AgentContextPreview
            v-if="file.source === 'context'"
            :attachment="file"
            :disabled="disabled"
            @remove="emit('removeAttachment', file.id)"
          />
          <template v-else>
            <img
              v-if="file.mimeType"
              :src="agentImageUrl(file)"
              :alt="file.name"
              class="size-12 shrink-0 rounded-md bg-(--color-input) object-contain"
            />
            <AppIcon
              v-else
              name="lucide:file-text"
              :size="17"
              class="shrink-0"
            />
            <div class="grid min-w-0 gap-0.5">
              <span
                class="max-w-[180px] truncate text-[11px]"
                :title="file.name"
                >{{ file.name }}</span
              >
              <span class="text-txt-4 text-[10px]"
                >{{ bytesToSize(file.size)
                }}<template v-if="file.attachmentId">
                  · {{ t('按需读取') }}</template
                ></span
              >
            </div>
            <IconButton
              icon="lucide:x"
              :size="12"
              :title="t('移除附件')"
              :aria-label="`${t('移除附件')} ${file.name}`"
              :disabled="disabled"
              @click="emit('removeAttachment', file.id)"
            />
          </template>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        class="hidden"
        multiple
        :accept="AGENT_FILE_ACCEPT"
        :disabled="disabled || reading || busy"
        tabindex="-1"
        aria-hidden="true"
        @change="selectFiles"
      />
      <textarea
        class="text-txt placeholder:text-txt-3 block max-h-40 min-h-[42px] w-full min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[12px] leading-[1.7] outline-none"
        ref="textarea"
        v-model="prompt"
        :placeholder="listening ? t('agent.listening') : placeholder"
        rows="2"
        :maxlength="AGENT_MAX_PROMPT_BYTES"
        :aria-label="t('发送给 AI 的消息')"
        :disabled="disabled"
        @keydown="keydown"
        @paste="paste"
      />
      <div class="flex min-w-0 items-center gap-1.5 pt-1.5">
        <IconButton
          :icon="reading ? 'lucide:loader-circle' : 'lucide:plus'"
          :size="18"
          :title="
            t(
              '最多 16 个附件，合计 1 GB；图片最多 4 张、每张 5 MB；Office 文件最多 128 MiB。支持 Ctrl+V 粘贴图片'
            )
          "
          :aria-label="t('上传文件')"
          :disabled="disabled || reading || busy"
          class="text-txt-3 size-7 shrink-0 rounded-full p-0"
          @click="fileInput?.click()"
        />
        <AgentPermissionSelect
          v-model="approvalMode"
          class="max-w-28 shrink-0"
          :disabled="permissionDisabled ?? disabled"
        />
        <button
          type="button"
          class="bg-txt/5 text-txt-3 hidden h-[25px] shrink-0 cursor-default items-center gap-[7px] rounded-full border-0 px-3 text-[10.5px] @min-[37.5rem]/agent:flex"
          :title="t('agent.defaultReasoningDescription')"
          :aria-label="t('agent.defaultReasoningDescription')"
          disabled
        >
          <AppIcon
            name="lucide:cloud-upload"
            :size="13"
          />
          <span class="hidden @min-[37.5rem]/agent:inline">{{
            t('agent.defaultReasoning')
          }}</span>
          <AppIcon
            name="lucide:chevron-down"
            :size="12"
            class="hidden @min-[37.5rem]/agent:block"
          />
        </button>

        <div
          class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5"
        >
          <AgentProfileSelect
            class="min-w-0 flex-1 @min-[37.5rem]/agent:max-w-48"
            :active-id="activeId"
            :options="profileOptions"
            :disabled="profileDisabled || busy || awaitingApproval"
            @select="emit('selectProfile', $event)"
          />
          <button
            type="button"
            class="focus-visible:outline-accent grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border bg-transparent not-disabled:hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-3 disabled:cursor-default disabled:opacity-40"
            :class="
              listening
                ? 'border-danger text-danger'
                : 'border-txt-3 text-txt-2'
            "
            :aria-label="
              listening ? t('agent.stopDictation') : t('agent.startDictation')
            "
            :aria-pressed="listening"
            :title="
              !speechSupported
                ? t('agent.dictationUnsupported')
                : listening
                  ? t('agent.stopDictation')
                  : t('agent.startDictation')
            "
            :disabled="
              !speechSupported ||
              disabled ||
              busy ||
              awaitingApproval ||
              reading
            "
            @click="dictation.toggle"
          >
            <AppIcon
              name="lucide:mic"
              :size="15"
            />
          </button>
          <button
            v-if="busy || awaitingApproval"
            type="button"
            class="focus-visible:outline-accent border-danger/60 bg-danger/10 text-danger ring-danger/10 grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border ring-3 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-3"
            :title="t('停止后续操作')"
            :aria-label="t('停止后续操作')"
            @click="emit('stop')"
          >
            <AppIcon
              name="lucide:square"
              :size="11"
            />
          </button>
          <button
            v-if="!awaitingApproval"
            type="submit"
            class="border-accent/30 bg-accent focus-visible:outline-accent grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border text-white not-disabled:hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-3 disabled:cursor-default disabled:opacity-40"
            :aria-label="busy ? t('agent.sendGuidance') : t('发送消息')"
            :title="
              busy
                ? t('agent.guidanceHint')
                : t('发送 (Enter)，换行 (Shift+Enter)')
            "
            :disabled="!canSend"
          >
            <AppIcon
              :name="busy ? 'lucide:corner-down-left' : 'lucide:chevron-up'"
              :size="17"
            />
          </button>
        </div>
      </div>
    </form>
    <AgentUsageStats
      :usage="usage"
      class="mt-1 px-1 leading-4"
    />
    <p
      v-if="reading"
      class="text-txt-3 mt-1.5 px-[3px] text-[10px] leading-[1.6] wrap-anywhere"
      role="status"
    >
      {{ readingProgress || t('正在读取附件…') }}
      <button
        type="button"
        data-cancel-reading
        class="text-violet ml-2 cursor-pointer underline"
        @click="emit('cancelReading')"
      >
        {{ t('取消读取') }}
      </button>
    </p>
    <p
      v-if="attachments.length"
      class="text-txt-3 mt-1.5 px-[3px] text-[10px] leading-[1.6] wrap-anywhere"
    >
      {{
        t(
          '文件加密保存在本机，模型按需读取内容；图片直接发送给所选模型。附件会随聊天记录保留。'
        )
      }}
    </p>
  </footer>
</template>
