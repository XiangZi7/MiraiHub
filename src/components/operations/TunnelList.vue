<script setup lang="ts">
import { computed, useId } from "vue";
import type { Tunnel } from "@/api/operations";
import AppButton from "@/components/ui/AppButton.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import IconButton from "@/components/ui/IconButton.vue";

const props = defineProps<{ tunnels: readonly Tunnel[] }>();
const emit = defineEmits<{
  copy: [tunnel: Tunnel];
  action: [tunnel: Tunnel];
}>();
const titleId = useId();
const runningCount = computed(
  () => props.tunnels.filter((tunnel) => tunnel.status === "running").length,
);
</script>

<template>
  <section class="tunnel-list-section" :aria-labelledby="titleId">
    <div class="tunnel-list-heading">
      <h3 :id="titleId">
        隧道列表 <span class="tunnel-count">{{ tunnels.length }}</span>
      </h3>
      <span v-if="runningCount" class="tunnel-running-summary"
        >{{ runningCount }} 个监听中</span
      >
    </div>
    <div
      class="tunnel-list scroll-thin"
      :tabindex="tunnels.length ? 0 : undefined"
      :aria-label="tunnels.length ? '隧道记录' : undefined"
    >
      <div v-if="!tunnels.length" class="tunnel-empty">
        <AppIcon name="lucide:network" :size="24" />
        <p>暂无隧道</p>
        <span>选择 SSH 连接并填写端口，建立第一条隧道。</span>
      </div>
      <article v-for="row in tunnels" :key="row.id" class="tunnel-row">
        <div class="tunnel-row-content">
          <div class="tunnel-row-route">
            <code>{{ row.bindHost }}:{{ row.bindPort }}</code>
            <AppIcon name="lucide:arrow-right" :size="14" aria-hidden="true" />
            <code>{{ row.targetHost }}:{{ row.targetPort }}</code>
          </div>
          <p class="tunnel-row-endpoint">通过 {{ row.endpoint }}</p>
          <div class="tunnel-row-status">
            <span
              class="tunnel-status-badge"
              :class="row.status === 'running' && 'is-running'"
            >
              <span class="tunnel-status-dot" />{{
                row.status === "running" ? "监听中" : "已停止"
              }}
            </span>
            <span>{{ row.connections }} 个活动连接</span>
          </div>
          <p v-if="row.error" class="tunnel-row-error">{{ row.error }}</p>
        </div>
        <div class="tunnel-row-actions">
          <IconButton
            icon="lucide:copy"
            title="复制本地连接地址"
            :size="14"
            @click="emit('copy', row)"
          />
          <AppButton size="sm" @click="emit('action', row)">{{
            row.status === "running" ? "停止" : "移除"
          }}</AppButton>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.tunnel-list-section {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.tunnel-list-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tunnel-list-heading h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}
.tunnel-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--color-raised);
  color: var(--color-txt-2);
  text-align: center;
  font-size: 10px;
  font-weight: 400;
}
.tunnel-running-summary {
  color: var(--color-success);
  font-size: 11px;
}
.tunnel-list {
  min-width: 0;
  max-height: 280px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--color-line);
  border-radius: 9px;
}
.tunnel-list:focus-visible {
  outline: 2px solid var(--color-violet);
  outline-offset: 2px;
}
.tunnel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 23px 16px;
  text-align: center;
  color: var(--color-txt-3);
}
.tunnel-empty p {
  margin-top: 3px;
  color: var(--color-txt-2);
  font-size: 12px;
}
.tunnel-empty span {
  font-size: 11px;
  line-height: 1.6;
}
.tunnel-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px;
  border-bottom: 1px solid var(--color-line-soft);
}
.tunnel-row:last-child {
  border-bottom: 0;
}
.tunnel-row-content {
  flex: 1;
  min-width: 0;
}
.tunnel-row-route {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.tunnel-row-route code {
  min-width: 0;
  overflow-wrap: anywhere;
}
.tunnel-row-route > svg {
  color: var(--color-txt-3);
}
.tunnel-row-endpoint {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  color: var(--color-txt-2);
}
.tunnel-row-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  color: var(--color-txt-3);
  font-size: 10px;
}
.tunnel-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-txt-2);
}
.tunnel-status-badge.is-running {
  color: var(--color-success);
}
.tunnel-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.tunnel-row-error {
  margin-top: 8px;
  color: var(--color-amber);
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.tunnel-row-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}
@media (max-width: 520px) {
  .tunnel-row {
    flex-direction: column;
    gap: 10px;
  }
  .tunnel-row-actions {
    align-self: flex-end;
  }
}
</style>
