<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, useId } from 'vue'
import type { Tunnel } from '@/api/operations'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = defineProps<{ tunnels: readonly Tunnel[] }>()
const emit = defineEmits<{
  copy: [tunnel: Tunnel]
  action: [tunnel: Tunnel]
}>()
const titleId = useId()
const runningCount = computed(
  () => props.tunnels.filter(tunnel => tunnel.status === 'running').length
)
// 拼接 host:port，IPv6 地址加方括号
function address(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}
// 生成列表行的类型徽标、路由摘要与复制提示，旧记录缺省按本地转发处理
function describe(row: Tunnel) {
  const bind = address(row.bindHost, row.bindPort)
  const target = address(row.targetHost, row.targetPort)
  if (row.kind === 'dynamic')
    return {
      badge: 'D',
      title: t('动态转发'),
      tone: 'border-cyan/40 bg-cyan/10 text-cyan',
      from: `SOCKS5 ${bind}`,
      to: '',
      copy: t('复制 SOCKS5 代理地址'),
    }
  if (row.kind === 'remote')
    return {
      badge: 'R',
      title: t('远程转发'),
      tone: 'border-amber/40 bg-amber/10 text-amber',
      from: `${t('远端')} ${bind}`,
      to: `${t('本机')} ${target}`,
      copy: t('复制远端监听地址'),
    }
  return {
    badge: 'L',
    title: t('本地转发'),
    tone: 'border-violet/40 bg-violet/10 text-violet',
    from: bind,
    to: target,
    copy: t('复制本地连接地址'),
  }
}
</script>

<template>
  <section
    class="tunnel-list-section"
    :aria-labelledby="titleId"
  >
    <div class="tunnel-list-heading">
      <h3 :id="titleId">
        {{ t('隧道列表') }}
        <span class="tunnel-count">{{ tunnels.length }}</span>
      </h3>
      <span
        v-if="runningCount"
        class="tunnel-running-summary"
        >{{ t('tunnel.listening', { count: runningCount }) }}</span
      >
    </div>
    <div
      class="tunnel-list scroll-thin"
      :tabindex="tunnels.length ? 0 : undefined"
      :aria-label="tunnels.length ? t('隧道记录') : undefined"
    >
      <div
        v-if="!tunnels.length"
        class="tunnel-empty"
      >
        <AppIcon
          name="lucide:network"
          :size="24"
        />
        <p>{{ t('暂无隧道') }}</p>
        <span> {{ t('选择 SSH 连接并填写端口，建立第一条隧道。') }} </span>
      </div>
      <article
        v-for="row in tunnels"
        :key="row.id"
        class="tunnel-row"
      >
        <div class="tunnel-row-content">
          <div class="tunnel-row-route">
            <abbr
              :title="describe(row).title"
              :aria-label="describe(row).title"
              :class="
                cn(
                  'inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border font-mono text-[10px] font-semibold no-underline',
                  describe(row).tone
                )
              "
              >{{ describe(row).badge }}</abbr
            >
            <code>{{ describe(row).from }}</code>
            <template v-if="describe(row).to">
              <AppIcon
                name="lucide:arrow-right"
                :size="14"
                aria-hidden="true"
              />
              <code>{{ describe(row).to }}</code>
            </template>
          </div>
          <p class="tunnel-row-endpoint">
            {{ t('tunnel.via', { endpoint: row.endpoint }) }}
          </p>
          <div class="tunnel-row-status">
            <span
              class="tunnel-status-badge"
              :class="row.status === 'running' && 'is-running'"
            >
              <span class="tunnel-status-dot" />{{
                row.status === 'running' ? t('监听中') : t('已停止')
              }}
            </span>
            <span>{{
              t('tunnel.connections', { count: row.connections })
            }}</span>
          </div>
          <p
            v-if="row.error"
            class="tunnel-row-error"
          >
            {{ row.error }}
          </p>
        </div>
        <div class="tunnel-row-actions">
          <IconButton
            icon="lucide:copy"
            :title="describe(row).copy"
            :size="14"
            @click="emit('copy', row)"
          />
          <AppButton
            size="sm"
            @click="emit('action', row)"
            >{{ row.status === 'running' ? t('停止') : t('移除') }}</AppButton
          >
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
