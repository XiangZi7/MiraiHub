<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
<template>
  <main class="text-txt grid h-screen place-items-center">
    {{ t('正在返回工作区…') }}
  </main>
</template>
