<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { toast } from '@/composables/useToast'
import { RSA_BITS_OPTIONS, SSH_KEY_KIND_OPTIONS } from '@/constants/ssh-keys'
import type { GenerateKeyRequest, SshKeyKind } from '@/types/ssh'
import { cn } from '@/utils/cn'

/**
 * 生成 SSH 密钥。
 *
 * 只收集参数并把请求交出去，实际生成在 Rust 侧（keys.rs）——
 * 私钥内容从不进入前端，写文件时就带上 0600 权限。
 */

const emit = defineEmits<{
  close: []
  /** 参数校验通过，请求生成 */
  submit: [request: GenerateKeyRequest]
}>()

/** 各算法的默认文件名，与 ssh-keygen 的命名习惯一致 */
const DEFAULT_LABELS: Record<SshKeyKind, string> = {
  ed25519: 'id_ed25519',
  rsa: 'id_rsa',
  ecdsa: 'id_ecdsa',
}

const form = reactive({
  kind: 'ed25519' as SshKeyKind,
  label: DEFAULT_LABELS.ed25519,
  bits: 4096,
  comment: '',
  passphrase: '',
  confirm: '',
})

// 提交中：生成 RSA-4096 要几秒，期间禁掉按钮避免连点生成出重名冲突
const submitting = shallowRef(false)

/** RSA 之外的算法位数固定，选项藏起来免得让人以为可调 */
const showBits = computed(() => form.kind === 'rsa')

/** 换算法时同步默认文件名，除非用户已经手改过 */
function selectKind(kind: SshKeyKind): void {
  const wasDefault = form.label === DEFAULT_LABELS[form.kind]

  form.kind = kind

  if (wasDefault)
    form.label = DEFAULT_LABELS[kind]
}

/** 校验并提交 */
function submit(): void {
  const label = form.label.trim()

  if (!label) {
    toast.warning('请填写密钥名')
    return
  }

  // 与 Rust 侧 validate_label 保持一致。前端先挡一道是为了即时反馈，
  // 后端那道才是真正的防线 —— 这里的校验绕过去也没用
  if (label.includes('/') || label.includes('\\') || label.includes('..')) {
    toast.warning('密钥名不能包含路径分隔符或 ..')
    return
  }

  if (label.endsWith('.pub')) {
    toast.warning('密钥名不能以 .pub 结尾，公钥会自动生成')
    return
  }

  if (form.passphrase !== form.confirm) {
    toast.warning('两次输入的口令不一致')
    return
  }

  submitting.value = true

  emit('submit', {
    label,
    kind: form.kind,
    // 只有 RSA 需要位数，其余算法传了也会被后端忽略，索性不传
    bits: form.kind === 'rsa' ? form.bits : undefined,
    comment: form.comment.trim() || undefined,
    // 空串表示不加密，转成 undefined 让后端走"不加密"分支
    passphrase: form.passphrase || undefined,
  })
}

/** 生成失败时由父组件调回来，解除提交锁定；错误由全局 Toast 展示。 */
function fail(): void {
  submitting.value = false
}

defineExpose({ fail })
</script>

<template>
  <AppDialog
    title="生成新密钥"
    description="密钥会写入 ~/.ssh，私钥不会离开本机"
    @close="emit('close')"
  >
    <form class="grid gap-3.5" @submit.prevent="submit">
      <!-- 算法 -->
      <fieldset class="space-y-1.5">
        <legend class="text-[11px] font-medium text-txt-2">
          算法
        </legend>
        <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="密钥算法">
          <AppButton
            v-for="option in SSH_KEY_KIND_OPTIONS"
            :key="option.value"
            role="radio"
            :aria-checked="form.kind === option.value"
            :class="cn(
              'h-auto flex-col !items-start !gap-0.5 !px-2.5 !py-2 text-left',
              form.kind === option.value
                ? '!border-violet/60 !bg-violet/12 !text-txt'
                : 'text-txt-3',
            )"
            @click="selectKind(option.value)"
          >
            <span class="text-[11.5px] font-medium">{{ option.label }}</span>
            <span class="text-[10px] text-txt-4">{{ option.hint }}</span>
          </AppButton>
        </div>
      </fieldset>

      <AppTextField
        v-model="form.label"
        label="密钥名"
        placeholder="id_ed25519"
        required
      />

      <!-- RSA 位数 -->
      <fieldset v-if="showBits" class="space-y-1.5">
        <legend class="text-[11px] font-medium text-txt-2">
          位数
        </legend>
        <div class="flex gap-2" role="radiogroup" aria-label="RSA 密钥位数">
          <AppButton
            v-for="bits in RSA_BITS_OPTIONS"
            :key="bits"
            role="radio"
            :aria-checked="form.bits === bits"
            :class="cn(
              'flex-1 text-[11.5px]',
              form.bits === bits
                ? '!border-violet/60 !bg-violet/12 !text-txt'
                : 'text-txt-3',
            )"
            @click="form.bits = bits"
          >
            {{ bits }}
          </AppButton>
        </div>
      </fieldset>

      <AppTextField
        v-model="form.comment"
        label="注释（可选）"
        placeholder="留空则用 user@hostname"
      />

      <AppTextField
        v-model="form.passphrase"
        label="口令（可选）"
        type="password"
        placeholder="留空表示不加密私钥"
        autocomplete="new-password"
      />

      <AppTextField
        v-if="form.passphrase"
        v-model="form.confirm"
        label="确认口令"
        type="password"
        placeholder="再输一次"
        autocomplete="new-password"
      />

      <!-- 不设口令的风险要说明白：私钥文件被拿走就等于服务器被拿走 -->
      <p
        v-if="!form.passphrase"
        class="card flex items-start gap-1.5 border-amber/25 bg-amber/8 px-2.5 py-2 text-[11px] text-amber"
      >
        <AppIcon name="lucide:triangle-alert" :size="13" class="mt-px shrink-0" />
        <span>不设口令的私钥，任何拿到文件的人都能直接登录你的服务器</span>
      </p>

    </form>

    <template #footer>
      <div class="flex-1" />
      <AppButton @click="emit('close')">
        取消
      </AppButton>
      <AppButton
        variant="primary"
        :disabled="submitting"
        @click="submit"
      >
        {{ submitting ? '生成中…' : '生成' }}
      </AppButton>
    </template>
  </AppDialog>
</template>
