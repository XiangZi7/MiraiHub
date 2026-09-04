<script setup lang="ts">
/**
 * 启动画面。
 *
 * 由 tauri.conf.json 里的 splash 窗口承载：主窗口初始隐藏，
 * 前端首屏就绪后调用 app_ready，Rust 侧显示主窗口并关掉这一个。
 * 这里只有黑底、品牌字标与版权行，不依赖任何设置或后端数据。
 */

const year = new Date().getFullYear()
</script>

<template>
  <div class="splash" data-tauri-drag-region>
    <div class="splash-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- 字标 M：两根竖笔 + 中央 V 形，右侧竖笔被一道斜切分开 -->
        <path fill="#fff" d="M9 11h11.5v42H9z" />
        <path fill="#fff" d="M20.5 11 32 30.6 43.5 11v12.8L32 43.2 20.5 23.8z" />
        <path fill="#fff" d="M43.5 11H55v18.9l-11.5 5.4z" />
        <path fill="#fff" d="M43.5 40.3 55 34.9V53H43.5z" />
      </svg>
    </div>

    <p class="splash-copyright">
      Copyright © 2022–{{ year }} MiraiHub. All rights reserved.
    </p>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
  user-select: none;
}

.splash-mark {
  display: grid;
  place-items: center;
  animation: splash-in 640ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.splash-mark svg {
  display: block;
  filter: drop-shadow(0 0 22px rgb(255 255 255 / 0.12));
  animation: splash-breathe 2.6s ease-in-out 700ms infinite;
}

.splash-copyright {
  position: absolute;
  right: 0;
  bottom: 24px;
  left: 0;
  color: rgb(255 255 255 / 0.92);
  font-family: var(--font-mono);
  font-size: 12.5px;
  letter-spacing: 0.01em;
  text-align: center;
  animation: splash-in 640ms cubic-bezier(0.2, 0.8, 0.2, 1) 120ms both;
}

@keyframes splash-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes splash-breathe {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.72;
  }
}

@media (prefers-reduced-motion: reduce) {
  .splash-mark,
  .splash-mark svg,
  .splash-copyright {
    animation: none;
  }
}
</style>
