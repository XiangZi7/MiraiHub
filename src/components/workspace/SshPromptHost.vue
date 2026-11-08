<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  toRefs,
  watch,
} from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppInput from '@/components/ui/AppInput.vue'
import {
  errorMessage,
  onAuthPrompt,
  onHostKeyPrompt,
  onPromptClosed,
  respondAuthPrompt,
  respondHostKey,
} from '@/api/ssh'
import { toast } from '@/composables/useToast'
import type { SshAuthPrompt, SshHostKeyPrompt } from '@/types/ssh'
import { IS_TAURI } from '@/utils/window'

const { t } = useI18n()

/**
 * SSH 连接过程中的全局确认框：主机密钥确认与键盘交互 / 二次验证。
 * 后端每个请求都在等待回应（120 秒超时视为拒绝），多个请求按到达顺序排队逐个处理。
 */

type PendingPrompt =
  | { kind: 'hostKey'; payload: SshHostKeyPrompt }
  | { kind: 'auth'; payload: SshAuthPrompt }

// 响应式状态
const state = reactive({
  // 等待处理的请求队列，队首即当前显示的对话框
  queue: [] as PendingPrompt[],
  // 当前键盘交互请求每一项的输入
  answers: [] as string[],
  // 是否正在把回应提交给后端
  submitting: false,
})
const { answers, submitting } = toRefs(state)

const formRef = ref<HTMLFormElement | null>(null)
const unlisteners: UnlistenFn[] = []
// 组件是否已卸载：订阅是异步建立的，卸载后才返回的订阅要立即退订
let disposed = false

// 登记一个异步建立的订阅；组件已卸载时立即退订，避免监听泄漏
async function track(pending: Promise<UnlistenFn>): Promise<void> {
  const stop = await pending
  if (disposed) stop()
  else unlisteners.push(stop)
}

// 队首的主机密钥请求
const hostKey = computed(() => {
  const head = state.queue[0]
  return head?.kind === 'hostKey' ? head.payload : null
})

// 队首的键盘交互请求
const auth = computed(() => {
  const head = state.queue[0]
  return head?.kind === 'auth' ? head.payload : null
})

// 主机密钥是否与 known_hosts 记录不符
const changed = computed(() => hostKey.value?.status === 'changed')

// 键盘交互对话框标题：优先用服务端给的名称
const authTitle = computed(() => auth.value?.name.trim() || t('身份验证'))

// 主机端点展示文案，非 22 端口带上端口号
function endpoint(host: string, port: number): string {
  return port === 22 ? host : `${host}:${port}`
}

// 切换到新的键盘交互请求时重置输入并聚焦第一个输入框（通常是验证码）
watch(
  () => state.queue[0],
  async head => {
    if (head?.kind !== 'auth') return
    state.answers = head.payload.prompts.map(() => '')
    await nextTick()
    formRef.value?.querySelector('input')?.focus()
  }
)

// 订阅后端的确认请求与失效通知
onMounted(async () => {
  if (!IS_TAURI) return
  await Promise.all([
    track(
      onHostKeyPrompt(payload => state.queue.push({ kind: 'hostKey', payload }))
    ),
    track(onAuthPrompt(payload => state.queue.push({ kind: 'auth', payload }))),
    track(onPromptClosed(requestId => removeRequest(requestId))),
  ])
})

// 卸载时取消订阅
onBeforeUnmount(() => {
  disposed = true
  unlisteners.splice(0).forEach(stop => stop())
})

// 从队列中移除指定请求（已回应、已超时或连接已放弃）
function removeRequest(requestId: string): void {
  state.queue = state.queue.filter(item => item.payload.requestId !== requestId)
}

// 回应主机密钥请求：accept 继续连接，remember 同时写入 known_hosts
async function answerHostKey(accept: boolean, remember: boolean): Promise<void> {
  const prompt = hostKey.value
  if (!prompt || state.submitting) return
  state.submitting = true
  try {
    await respondHostKey(prompt.requestId, accept, remember)
  } catch (caught) {
    toast.error({ title: t('主机密钥确认失败'), description: errorMessage(caught) })
  } finally {
    removeRequest(prompt.requestId)
    state.submitting = false
  }
}

// 提交或取消键盘交互认证；answers 为 null 表示取消本次连接
async function answerAuth(values: string[] | null): Promise<void> {
  const prompt = auth.value
  if (!prompt || state.submitting) return
  state.submitting = true
  try {
    await respondAuthPrompt(prompt.requestId, values)
  } catch (caught) {
    toast.error({ title: t('提交验证信息失败'), description: errorMessage(caught) })
  } finally {
    removeRequest(prompt.requestId)
    state.submitting = false
  }
}

// 回车提交当前填写的全部输入
function submitAuth(): void {
  void answerAuth([...state.answers])
}
</script>

<template>
  <Teleport to="body">
    <AppDialog
      v-if="hostKey"
      :title="changed ? t('主机密钥已变化') : t('验证主机密钥')"
      :description="
        t('正在连接 {value0}', { value0: endpoint(hostKey.host, hostKey.port) })
      "
      @close="answerHostKey(false, false)"
    >
      <div
        v-if="changed"
        role="alert"
        class="border-danger/40 bg-danger/10 text-danger mb-3 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed"
      >
        <p class="font-medium">
          {{ t('警告：服务器的主机密钥与之前记录的不一致！') }}
        </p>
        <p class="mt-1">
          {{
            t(
              '可能有人正在进行中间人攻击，也可能是服务器重装或更换了密钥。除非确认变更来源，否则请取消连接。'
            )
          }}
        </p>
      </div>
      <p
        v-else
        class="text-txt-2 mb-3 text-[11px] leading-relaxed"
      >
        {{
          t(
            '首次连接该主机，无法确认其身份。请与服务器管理员核对下面的指纹后再继续。'
          )
        }}
      </p>

      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
        <dt class="text-txt-3">{{ t('算法') }}</dt>
        <dd class="text-txt font-mono break-all">{{ hostKey.algorithm }}</dd>
        <dt class="text-txt-3">
          {{ changed ? t('新指纹') : t('指纹') }}
        </dt>
        <dd
          :class="[
            'font-mono break-all',
            changed ? 'text-danger' : 'text-txt',
          ]"
        >
          {{ hostKey.fingerprint }}
        </dd>
        <template v-if="changed && hostKey.oldFingerprint">
          <dt class="text-txt-3">{{ t('旧指纹') }}</dt>
          <dd class="text-txt-3 font-mono break-all">
            {{ hostKey.oldFingerprint }}
          </dd>
        </template>
      </dl>

      <template #footer>
        <div class="flex-1" />
        <AppButton
          :disabled="submitting"
          @click="answerHostKey(false, false)"
        >
          {{ t('取消') }}
        </AppButton>
        <AppButton
          :disabled="submitting"
          @click="answerHostKey(true, false)"
        >
          {{ t('仅本次') }}
        </AppButton>
        <AppButton
          :variant="changed ? 'danger' : 'primary'"
          :disabled="submitting"
          @click="answerHostKey(true, true)"
        >
          {{ t('信任并连接') }}
        </AppButton>
      </template>
    </AppDialog>

    <AppDialog
      v-else-if="auth"
      :title="authTitle"
      :description="
        t('{value0} 需要进一步验证', {
          value0: `${auth.username}@${endpoint(auth.host, auth.port)}`,
        })
      "
      @close="answerAuth(null)"
    >
      <form
        ref="formRef"
        class="flex flex-col gap-3"
        @submit.prevent="submitAuth"
      >
        <p
          v-if="auth.instructions.trim()"
          class="text-txt-2 text-[11px] leading-relaxed whitespace-pre-wrap"
        >
          {{ auth.instructions }}
        </p>
        <label
          v-for="(field, index) in auth.prompts"
          :key="index"
          class="flex flex-col gap-1.5"
        >
          <span class="text-txt-2 text-[11px]">
            {{ field.prompt.trim() || t('输入') }}
          </span>
          <AppInput
            v-model="answers[index]"
            :type="field.echo ? 'text' : 'password'"
            :disabled="submitting"
            monospace
            autocomplete="one-time-code"
            spellcheck="false"
          />
        </label>
        <!-- 让回车能触发表单提交 -->
        <button
          type="submit"
          class="hidden"
        />
      </form>

      <template #footer>
        <div class="flex-1" />
        <AppButton
          :disabled="submitting"
          @click="answerAuth(null)"
        >
          {{ t('取消') }}
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="submitting"
          @click="submitAuth"
        >
          {{ submitting ? t('验证中…') : t('继续') }}
        </AppButton>
      </template>
    </AppDialog>
  </Teleport>
</template>
