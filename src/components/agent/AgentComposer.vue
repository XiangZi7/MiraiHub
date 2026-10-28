<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
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
import AgentProfileSelect from './AgentProfileSelect.vue'
import AgentPermissionSelect from './AgentPermissionSelect.vue'
import AgentContextPreview from './AgentContextPreview.vue'
import AgentUsageStats from './AgentUsageStats.vue'
import { useAgentErrorToasts } from '@/composables/useAgentErrorToasts'
import { useAgentDictation } from '@/composables/useAgentDictation'

const props = withDefaults(
  defineProps<{
    usage?: AgentUsage
    disabled: boolean
    /** 审批方式独立于发送状态，运行中或等待审批时仍可调整。 */
    permissionDisabled?: boolean
    busy: boolean
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
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
defineExpose({ focus: () => textarea.value?.focus() })
const placeholder = computed(() =>
  props.awaitingApproval
    ? t('请先审批或拒绝上方操作…')
    : props.isRedis
      ? t('询问 Redis 键、TTL，或描述要执行的命令…')
      : props.isDatabase
        ? t('询问数据库，或描述要完成的操作…')
        : t('agent.promptPlaceholder')
)
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    event.stopPropagation()
    if (props.canSend) emit('submit')
  }
}
function selectFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  if (!props.disabled) emit('attach', Array.from(input.files ?? []))
  input.value = ''
}
function paste(event: ClipboardEvent): void {
  const files = clipboardImages(event.clipboardData)
  if (!files.length) return
  if (!event.clipboardData?.getData('text/plain')) event.preventDefault()
  if (!props.disabled && !props.reading) emit('attach', files)
}
function drop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length && !props.disabled && !props.reading) emit('attach', files)
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
        :disabled="disabled || reading"
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
      <div class="flex min-w-0 flex-wrap items-center gap-1 pt-1.5">
        <IconButton
          :icon="reading ? 'lucide:loader-circle' : 'lucide:plus'"
          :size="18"
          :title="
            t(
              '最多 16 个附件，合计 1 GB；图片最多 4 张、每张 5 MB；Office 文件最多 128 MiB。支持 Ctrl+V 粘贴图片'
            )
          "
          :aria-label="t('上传文件')"
          :disabled="disabled || reading"
          class="text-txt-3 size-7 shrink-0 rounded-full p-0"
          @click="fileInput?.click()"
        />
        <AgentPermissionSelect
          v-model="approvalMode"
          :disabled="permissionDisabled ?? disabled"
        />
        <button
          type="button"
          class="bg-txt/5 text-txt-3 flex h-[25px] shrink-0 cursor-default items-center gap-1 rounded-full border-0 px-1.5 text-[10.5px] @min-[37.5rem]/agent:gap-[7px] @min-[37.5rem]/agent:px-3"
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

        <div class="ml-auto flex max-w-full min-w-0 items-center gap-1.5">
          <AgentProfileSelect
            class="max-w-[160px] min-w-0 @min-[37.5rem]/agent:min-w-0"
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
            v-if="!busy && !awaitingApproval"
            type="submit"
            class="border-accent/30 bg-accent focus-visible:outline-accent grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border text-white not-disabled:hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-3 disabled:cursor-default disabled:opacity-40"
            :aria-label="t('发送消息')"
            :title="t('发送 (Enter)，换行 (Shift+Enter)')"
            :disabled="!canSend"
          >
            <AppIcon
              name="lucide:chevron-up"
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
