<script setup lang="ts">
// 浏览器预览入口复用独立启动页，Logo、动画和材质始终与原生启动窗口一致。
</script>

<template>
  <iframe
    class="splash-preview"
    src="/splash.html"
    title="MiraiHub 启动画面"
  />
</template>

<style scoped>
.splash-preview {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
</style>
