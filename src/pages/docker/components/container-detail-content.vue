<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import ContainerStatusChip from '@/pages/docker/components/container-status-chip.vue'
import type { DockerContainerDetails } from '@/types/docker'
import { formatBytes } from '@/utils/format'
import { formatDateTime } from '@/utils/time'

const props = defineProps<{ details: DockerContainerDetails }>()
const { t } = useI18n()
const stateLabels: Record<string, string> = {
  created: '已创建',
  running: '运行中',
  paused: '已暂停',
  restarting: '正在重启',
  removing: '正在移除',
  exited: '已退出',
  dead: '已失效',
  starting: '正在启动',
  healthy: '健康',
  unhealthy: '不健康',
}

/** 使用本地时间和用户偏好显示引擎返回的时间。 */
function date(value: string | null): string {
  return value ? formatDateTime(Date.parse(value)) : '—'
}

/** 对已知状态使用界面语言，保留新版引擎返回的其他状态。 */
function stateName(value: string): string {
  return stateLabels[value] ? t(stateLabels[value]) : value || '—'
}

const metrics = computed(() => {
  const { stats, restartCount } = props.details
  const used = stats?.memoryBytes
  const limit = stats?.memoryLimitBytes
  return [
    [
      t('CPU 使用率'),
      stats?.cpuPercent == null ? '—' : `${stats.cpuPercent.toFixed(1)}%`,
    ],
    [
      t('内存用量 / 上限'),
      used == null && limit == null
        ? '—'
        : `${used == null ? '—' : formatBytes(used)} / ${limit == null ? '—' : formatBytes(limit)}`,
    ],
    [t('重启次数'), restartCount],
  ]
})

const facts = computed(() => {
  const d = props.details
  return [
    [t('容器 ID'), d.id],
    [t('镜像'), d.image],
    [t('创建时间'), date(d.createdAt)],
    [t('启动时间'), date(d.startedAt)],
    ...(d.finishedAt || d.exitCode != null
      ? [
          [t('退出时间'), date(d.finishedAt)],
          [t('退出码'), d.exitCode ?? '—'],
        ]
      : []),
    ...(d.oomKilled ? [[t('退出原因'), t('内存不足（OOM）')]] : []),
    ...(d.error ? [[t('错误'), d.error]] : []),
  ]
})

/** 这些清单共用现有表格，列宽分别保存在各自的详情区段。 */
function column(name: string, label: string, width: string) {
  return { name, label: t(label), width, sortable: false }
}
const tables = computed(() => {
  const { health, ports, mounts } = props.details
  return [
    {
      id: 'health',
      title: t('健康检查'),
      meta: health
        ? `${stateName(health.status)} · ${t('连续失败 {count} 次', { count: health.failingStreak })}`
        : '',
      empty: health ? t('暂无检查记录') : t('未配置健康检查'),
      columns: [
        column('start', '开始时间', '9rem'),
        column('end', '结束时间', '9rem'),
        column('exit', '退出码', '4rem'),
        column('output', '检查输出', '13rem'),
      ],
      rows: (health?.log ?? [])
        .slice()
        .reverse()
        .map(row => [
          date(row.start),
          date(row.end),
          row.exitCode,
          row.output || '—',
        ]),
    },
    {
      id: 'mounts',
      title: t('挂载目录'),
      meta: '',
      empty: t('没有挂载目录'),
      columns: [
        column('type', '类型', '5rem'),
        column('name', '卷名称', '7rem'),
        column('source', '主机路径', '12rem'),
        column('target', '容器路径', '11rem'),
        column('mode', '权限', '4.5rem'),
      ],
      rows: mounts.map(row => [
        row.type,
        row.name || '—',
        row.source || '—',
        row.destination,
        t(row.writable ? '读写' : '只读'),
      ]),
    },
    {
      id: 'ports',
      title: t('端口映射'),
      meta: '',
      empty: t('没有暴露端口'),
      columns: [
        column('container', '容器端口', '8rem'),
        column('host', '主机地址', '11rem'),
        column('published', '主机端口', '8rem'),
      ],
      rows: ports.map(row => [
        row.containerPort,
        row.hostIp || '—',
        row.hostPort || t('未发布'),
      ]),
    },
  ]
})
</script>

<template>
  <!-- 概览与三个只读清单随窗口宽度排版，保留原有表头、列宽调整和主题。 -->
  <div
    class="scroll-thin flex-1 space-y-4 overflow-auto p-4 text-xs select-text"
  >
    <!-- 状态与资源使用同一块指标面板；小窗口自动改为两列。 -->
    <dl
      class="border-line-soft bg-line-soft rounded-card grid grid-cols-2 gap-px overflow-hidden border md:grid-cols-4"
    >
      <div class="bg-pane min-w-0 px-4 py-3">
        <dt class="text-txt-3 mb-1.5">{{ t('容器状态') }}</dt>
        <dd>
          <ContainerStatusChip
            :state="details.state"
            :label="
              [
                stateName(details.state),
                details.health && stateName(details.health.status),
              ]
                .filter(Boolean)
                .join(' · ')
            "
            :health="details.health?.status"
            :exit-code="details.exitCode"
          />
        </dd>
      </div>
      <div
        v-for="[label, value] in metrics"
        :key="String(label)"
        class="bg-pane min-w-0 px-4 py-3"
      >
        <dt class="text-txt-3 mb-1.5">{{ label }}</dt>
        <dd class="text-txt font-mono text-sm font-medium tabular-nums">
          {{ value }}
        </dd>
      </div>
    </dl>
    <dl
      class="border-line-soft bg-card rounded-card grid grid-cols-1 gap-x-6 gap-y-3 border px-4 py-3 sm:grid-cols-2"
    >
      <div
        v-for="[label, value] in facts"
        :key="String(label)"
        class="min-w-0"
      >
        <dt class="text-txt-3 mb-1">{{ label }}</dt>
        <dd class="text-txt font-mono wrap-anywhere">{{ value }}</dd>
      </div>
    </dl>
    <section
      v-for="section in tables"
      :key="section.id"
      :aria-labelledby="'details-' + section.id"
    >
      <header class="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2
          :id="'details-' + section.id"
          class="text-txt font-semibold"
        >
          {{ section.title }}
        </h2>
        <span
          v-if="section.meta"
          class="text-txt-2"
          >{{ section.meta }}</span
        >
      </header>
      <!-- 各区段沿用数据库和 Docker 列表的共享表格，显示完整路径及多行检查结果。 -->
      <div
        v-if="section.rows.length"
        class="border-line-soft bg-card scroll-thin rounded-card overflow-x-auto border"
      >
        <AppDataTable
          :columns="section.columns"
          :width-scope="'docker:details:' + section.id"
          :aria-label="section.title"
        >
          <tr
            v-for="(cells, rowIndex) in section.rows"
            :key="rowIndex"
            class="border-line-soft border-b last:border-b-0"
          >
            <td
              v-for="(value, colIndex) in cells"
              :key="section.columns[colIndex]?.name"
              class="border-line-soft text-txt-2 border-r px-3 py-2 align-top font-mono wrap-anywhere whitespace-pre-wrap last:border-r-0"
            >
              {{ value }}
            </td>
          </tr>
        </AppDataTable>
      </div>
      <p
        v-else
        class="text-txt-3"
      >
        {{ section.empty }}
      </p>
    </section>
  </div>
</template>
