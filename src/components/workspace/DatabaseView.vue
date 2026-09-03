<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import type { TabItem } from '@/components/ui/TabBar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import TabBar from '@/components/ui/TabBar.vue'
import { DB_TREE, QUERY_ROWS, SQL_LINES } from '@/constants/database'
import { cn } from '@/utils/cn'

/** SQL 语法类别 → 颜色 class */
const TOKEN_CLASS: Record<string, string> = {
  keyword: 'text-violet',
  func: 'text-blue',
  num: 'text-orange',
  plain: 'text-term-fg',
}

/** 结果区下方标签 */
const RESULT_TABS = [
  { id: 'results', label: 'Results' },
  { id: 'messages', label: 'Messages' },
]

// 响应式状态
const state = reactive({
  // 查询标签页
  tabs: [
    { id: 'q1', label: 'Query 1' },
    { id: 'q2', label: 'Query 2' },
    { id: 'q3', label: 'Query 3' },
  ] as TabItem[],
  // 当前激活的查询标签
  activeTab: 'q1',
  // 结果区下方标签：results / messages
  resultTab: 'results',
})

const { tabs, activeTab, resultTab } = toRefs(state)

function selectResultTab(id: string): void {
  state.resultTab = id
}
</script>

<template>
  <div class="pane flex-1 flex-row">
    <!-- 对象树 -->
    <nav class="flex w-[196px] shrink-0 flex-col border-r border-line-soft bg-panel">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft px-2">
        <IconButton icon="lucide:database" :size="14" title="数据库" />
        <IconButton icon="lucide:list-tree" :size="14" title="对象树" />
        <div class="flex-1" />
        <IconButton icon="lucide:rotate-cw" :size="13" title="刷新" />
      </div>

      <div class="flex-1 overflow-y-auto p-1.5 scroll-thin">
        <button
          v-for="node in DB_TREE"
          :key="node.id"
          type="button"
          :class="cn('nav-item h-7 w-full text-xs', node.active && 'nav-item-active')"
          :style="{ paddingLeft: `${node.depth * 14 + 8}px` }"
        >
          <AppIcon
            v-if="!node.leaf"
            name="lucide:chevron-right"
            :size="12"
            :class="cn('text-txt-4 transition-transform', node.expanded && 'rotate-90')"
          />
          <span v-else class="w-3 shrink-0" />
          <AppIcon :name="node.icon" :size="13" class="text-txt-3" />
          <span class="truncate">{{ node.label }}</span>
        </button>
      </div>
    </nav>

    <!-- 查询区 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 查询标签栏 -->
      <div class="flex h-10 shrink-0 items-end border-b border-line-soft px-2">
        <TabBar v-model:active="activeTab" :tabs="tabs" addable />
      </div>

      <!-- 执行工具条 -->
      <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5">
        <IconButton icon="lucide:history" :size="14" title="历史" />

        <button
          type="button"
          class="grid size-6 place-items-center rounded bg-accent-deep text-black transition-colors hover:bg-accent"
          title="执行"
        >
          <AppIcon name="lucide:play" :size="12" />
        </button>

        <IconButton icon="lucide:square" :size="13" title="停止" />
        <IconButton icon="lucide:save" :size="14" title="保存" />
        <IconButton icon="lucide:wand-sparkles" :size="14" title="格式化" />
        <IconButton icon="lucide:table-2" :size="14" title="查看结构" />

        <div class="flex-1" />

        <button
          type="button"
          class="field h-7 w-[172px] justify-between text-xs"
        >
          <span class="text-txt-2">production</span>
          <AppIcon name="lucide:chevron-down" :size="12" class="text-txt-4" />
        </button>
      </div>

      <!-- SQL 编辑器 -->
      <div class="min-h-0 flex-[1.1] overflow-y-auto bg-terminal py-2 font-mono text-[12px] leading-[1.65] scroll-thin">
        <div
          v-for="line in SQL_LINES"
          :key="line.no"
          class="flex gap-3.5 px-3 transition-colors hover:bg-window/60"
        >
          <span class="w-5 shrink-0 select-none text-right text-txt-4">{{ line.no }}</span>
          <span class="whitespace-pre">
            <span
              v-for="(token, i) in line.tokens"
              :key="i"
              :class="TOKEN_CLASS[token.kind ?? 'plain']"
            >{{ token.text }}</span>
          </span>
        </div>
      </div>

      <!-- 结果区 -->
      <div class="flex min-h-0 flex-1 flex-col border-t border-line">
        <!-- 结果标签 -->
        <div class="flex h-8 shrink-0 items-center gap-0.5 border-b border-line-soft px-2">
          <button
            v-for="tab in RESULT_TABS"
            :key="tab.id"
            type="button"
            :class="cn(
              'rounded px-2.5 py-1 text-[11px] transition-colors',
              resultTab === tab.id ? 'bg-raised text-txt' : 'text-txt-3 hover:text-txt-2',
            )"
            @click="selectResultTab(tab.id)"
          >
            {{ tab.label }}
          </button>
          <div class="flex-1" />
          <IconButton icon="lucide:chevrons-up-down" :size="13" title="展开/收起" />
        </div>

        <!-- 结果表 -->
        <div class="min-h-0 flex-1 overflow-auto scroll-thin">
          <table class="w-full border-collapse text-left text-[11.5px]">
            <thead class="sticky top-0 bg-panel backdrop-blur-md">
              <tr class="text-txt-3">
                <th class="w-16 border-b border-line-soft px-3 py-1.5 font-medium">
                  id
                </th>
                <th class="w-[150px] border-b border-line-soft px-3 py-1.5 font-medium">
                  username
                </th>
                <th class="w-[220px] border-b border-line-soft px-3 py-1.5 font-medium">
                  email
                </th>
                <th class="border-b border-line-soft px-3 py-1.5 font-medium">
                  created_at
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in QUERY_ROWS"
                :key="row.id"
                class="text-txt-2 transition-colors hover:bg-hover"
              >
                <td class="border-b border-line-soft px-3 py-1.5">
                  {{ row.id }}
                </td>
                <td class="border-b border-line-soft px-3 py-1.5">
                  {{ row.username }}
                </td>
                <td class="border-b border-line-soft px-3 py-1.5">
                  {{ row.email }}
                </td>
                <td class="border-b border-line-soft px-3 py-1.5">
                  {{ row.createdAt }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 状态栏 -->
        <footer class="flex h-7 shrink-0 items-center border-t border-line-soft px-3 text-[10.5px] text-txt-3">
          <span>127 rows</span>
          <div class="flex-1" />
          <span class="flex items-center gap-1">
            <AppIcon name="lucide:timer" :size="11" />
            <span>Execution time: 23ms</span>
          </span>
        </footer>
      </div>
    </div>
  </div>
</template>
