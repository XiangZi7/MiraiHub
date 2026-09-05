<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { AgentApproval } from '@/types/agent'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  approval: AgentApproval
  target: string
  busy: boolean
}>()
const emit = defineEmits<{ decide: [approve: boolean] }>()
// 每一条新审批都必须重新核对，不继承上一条的确认状态。
const state = reactive({ reviewed: false, time: Date.now() })
const { reviewed } = toRefs(state)
watch(
  () => props.approval.id,
  () => {
    state.reviewed = false
    state.time = Date.now()
  }
)
useIntervalFn(() => {
  state.time = Date.now()
}, 1000)
const seconds = computed(() =>
  Math.max(0, Math.ceil((props.approval.expiresAt - state.time) / 1000))
)
const expired = computed(() => seconds.value === 0)
</script>

<template>
  <section
    class="approval"
    aria-label="操作审批"
  >
    <div class="flex items-center gap-2 font-medium">
      <AppIcon
        name="lucide:shield-alert"
        :size="16"
      />{{ expired ? '审批已过期' : '需要你的审批'
      }}<span class="ml-auto text-[10px] font-normal"
        >{{ Math.floor(seconds / 60) }}:{{
          String(seconds % 60).padStart(2, '0')
        }}</span
      >
    </div>
    <p class="text-txt-3 mt-3 text-[11px]">执行目标（已锁定）</p>
    <p class="text-txt mt-1 font-mono text-[12px] break-all">{{ target }}</p>
    <p class="text-txt-3 mt-3 text-[11px]">{{ approval.label }} · 完整内容</p>
    <pre
      class="command"
      dir="ltr"
      >{{ approval.command }}</pre>
    <p class="text-txt-3 text-[11px]">AI 提议的原因</p>
    <p
      class="text-txt-2 mt-1 text-[12px] leading-relaxed break-words whitespace-pre-wrap"
    >
      {{ approval.reason }}
    </p>
    <p class="text-txt-3 mt-3 text-[11px] leading-relaxed">
      仅批准这一次操作；结果会发给已配置的模型。操作可能立即生效，停止任务不会自动回滚。
    </p>
    <label
      class="text-txt-2 my-3 flex cursor-pointer items-start gap-2 text-[11px]"
      ><input
        v-model="reviewed"
        type="checkbox"
        class="mt-0.5 accent-amber-400"
        :disabled="busy || expired"
      />我已核对目标、完整命令及其影响</label
    >
    <div class="flex flex-wrap gap-2">
      <AppButton
        size="sm"
        :disabled="busy"
        @click="emit('decide', false)"
        >拒绝并停止</AppButton
      ><AppButton
        size="sm"
        variant="danger"
        :disabled="busy || expired || !reviewed"
        @click="emit('decide', true)"
        >批准本次执行</AppButton
      >
    </div>
  </section>
</template>
<style scoped>
.approval {
  border: 1px solid #e9b45466;
  background: #e9b4540a;
  border-radius: 10px;
  padding: 14px;
  color: #ebc478;
}
.command {
  margin: 8px 0 12px;
  padding: 12px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #0006;
  border: 1px solid #ffffff0c;
  border-radius: 6px;
  color: var(--color-txt);
  font-size: 12px;
  line-height: 1.6;
  unicode-bidi: plaintext;
}
</style>
