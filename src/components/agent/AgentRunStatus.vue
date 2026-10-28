<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  busy: boolean
  label: string
  turnKey: string
  status: string
}>()
const state = reactive({ startedAt: 0, elapsed: 0, accumulated: 0 })
const { pause, resume } = useIntervalFn(
  () => {
    state.elapsed = state.accumulated + Date.now() - state.startedAt
  },
  1000,
  { immediate: false }
)
watch(
  () => [props.busy, props.turnKey] as const,
  ([busy, key], previous) => {
    if (key !== previous?.[1]) {
      state.accumulated = 0
      state.elapsed = 0
      state.startedAt = 0
    }
    if (busy) {
      if (!state.startedAt) state.startedAt = Date.now()
      resume()
    } else {
      if (state.startedAt) state.accumulated += Date.now() - state.startedAt
      state.elapsed = state.accumulated
      state.startedAt = 0
      pause()
    }
  },
  { immediate: true }
)
const elapsed = computed(() => {
  const seconds = Math.floor(state.elapsed / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
</script>

<template>
  <div
    data-agent-status
    class="text-agent-small flex min-h-7 items-center gap-2.5"
    :class="
      status === 'failed' ? 'text-danger' : busy ? 'text-txt-2' : 'text-txt-3'
    "
    role="status"
  >
    <AppIcon
      :name="
        busy
          ? 'lucide:loader-circle'
          : status === 'completed'
            ? 'lucide:check'
            : status === 'failed'
              ? 'lucide:circle-alert'
              : 'lucide:circle'
      "
      :size="15"
      :class="busy && 'text-txt-3 animate-spin motion-reduce:animate-none'"
    />
    <span
      v-if="busy || state.elapsed"
      class="tabular-nums"
      >{{ elapsed }}</span
    >
    <span>{{ label }}<span v-if="busy">…</span></span>
  </div>
</template>
