<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IconButton from '@/components/ui/IconButton.vue'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const history = computed(() => {
  void route.fullPath
  return router.options.history.state
})
</script>

<template>
  <div
    class="flex items-center gap-0.5"
    :aria-label="t('页面导航')"
  >
    <IconButton
      icon="lucide:arrow-left"
      :title="t('返回上一页')"
      :disabled="!history.back"
      @click="router.back()"
    />
    <IconButton
      icon="lucide:arrow-right"
      :title="t('前进到下一页')"
      :disabled="!history.forward"
      @click="router.forward()"
    />
  </div>
</template>
