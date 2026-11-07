<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { TableDesignerChange } from '@/types/database-designer'

const { t } = useI18n()

const props = defineProps<{
  sql: string
  error: string
  changes: readonly TableDesignerChange[]
  editing: boolean
  /** 当前方言是否能整体回滚。 */
  transactional: boolean
}>()

const emit = defineEmits<{ copy: [] }>()

const KEYWORDS = new Set(
  `ADD AFTER ALTER AND AS AUTO_INCREMENT BEFORE BEGIN BY CASCADE CHANGE CHARSET CHECK COLLATE COLUMN COMMENT CONSTRAINT CREATE DEFAULT DELETE DROP EACH END ENGINE EXECUTE FOR FOREIGN FUNCTION IF IN INDEX INSERT INTO IS KEY LANGUAGE LESS MAXVALUE MODIFY NOT NULL ON OR PARTITION PARTITIONS PRIMARY RANGE LIST HASH REFERENCES RENAME REPLACE RESTART RESTRICT RETURNS ROW ROW_FORMAT SCHEMA SET STATEMENT TABLE THAN TO TRIGGER TRUNCATE TYPE UNIQUE UPDATE USING VALUES WITH ACTION NO RETURN NEW OLD SEQUENCE`.split(
    ' '
  )
)

type Token = { text: string; kind: 'keyword' | 'string' | 'ident' | 'comment' | 'number' | 'plain' }

/** 将 SQL 切分为带类型的片段，用于在模板中逐段着色（不使用 v-html，避免注入）。 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  const pattern =
    /(--[^\n]*)|('(?:[^']|'')*')|(`[^`]*`|"[^"]*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/gsu
  for (const match of sql.matchAll(pattern)) {
    const [text, comment, str, ident, num, word] = match
    if (comment) tokens.push({ text, kind: 'comment' })
    else if (str) tokens.push({ text, kind: 'string' })
    else if (ident) tokens.push({ text, kind: 'ident' })
    else if (num) tokens.push({ text, kind: 'number' })
    else if (word)
      tokens.push({
        text,
        kind: KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'plain',
      })
    else {
      const last = tokens.at(-1)
      if (last?.kind === 'plain') last.text += text
      else tokens.push({ text, kind: 'plain' })
    }
  }
  return tokens
}

const tokens = computed(() => tokenize(props.sql))
const tokenClass: Record<Token['kind'], string> = {
  keyword: 'text-violet font-semibold',
  string: 'text-success',
  ident: 'text-blue',
  number: 'text-orange',
  comment: 'text-txt-4 italic',
  plain: '',
}

const actionMeta: Record<
  TableDesignerChange['action'],
  { label: string; icon: string; tone: string }
> = {
  add: { label: '新增', icon: 'lucide:plus', tone: 'text-success bg-success/10' },
  modify: {
    label: '修改',
    icon: 'lucide:pencil',
    tone: 'text-orange bg-orange/10',
  },
  remove: {
    label: '删除',
    icon: 'lucide:minus',
    tone: 'text-danger bg-danger/10',
  },
  rename: {
    label: '重命名',
    icon: 'lucide:arrow-right-left',
    tone: 'text-blue bg-blue/10',
  },
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2 p-3">
    <div
      v-if="changes.length"
      class="border-line-soft bg-card/60 scroll-thin max-h-40 shrink-0 overflow-y-auto rounded-lg border p-2"
    >
      <p class="text-txt-3 mb-1.5 text-[10px] font-semibold">
        {{ t('变更摘要') }}（{{ changes.length }}）
      </p>
      <ul class="flex flex-wrap gap-1.5">
        <li
          v-for="(change, index) in changes"
          :key="index"
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
          :class="actionMeta[change.action].tone"
        >
          <AppIcon
            :name="actionMeta[change.action].icon"
            :size="10"
          />
          {{ t(actionMeta[change.action].label) }}{{ t(change.target) }}
          <code class="font-mono">{{ change.name }}</code>
          <span
            v-if="change.detail"
            class="opacity-70"
            >（{{ change.detail }}）</span
          >
        </li>
      </ul>
    </div>
    <p
      v-else-if="editing && !error"
      class="text-txt-4 text-[10px]"
    >
      {{ t('暂无修改') }}
    </p>
    <div class="flex items-center justify-between gap-2">
      <p class="text-txt-4 flex items-center gap-1 text-[10px]">
        <AppIcon
          :name="transactional ? 'lucide:shield-check' : 'lucide:triangle-alert'"
          :size="11"
        />
        {{
          transactional
            ? t('保存时在事务中执行，任一语句失败将整体回滚。')
            : t('MySQL 的 DDL 会隐式提交，失败前已执行的语句无法回滚。')
        }}
      </p>
      <AppButton
        size="sm"
        :disabled="!sql"
        @click="emit('copy')"
      >
        <AppIcon
          name="lucide:copy"
          :size="12"
        />
        {{ t('复制 SQL') }}
      </AppButton>
    </div>
    <p
      v-if="error"
      class="text-danger bg-danger/10 rounded-md px-2 py-1.5 text-[11px]"
    >
      {{ error }}
    </p>
    <pre
      class="border-line-soft bg-panel scroll-thin min-h-0 flex-1 overflow-auto rounded-lg border p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap select-text"
    ><template v-if="sql"><span
      v-for="(token, index) in tokens"
      :key="index"
      :class="tokenClass[token.kind]"
    >{{ token.text }}</span></template><span
      v-else
      class="text-txt-4"
    >{{ editing ? t('-- 暂无修改') : '' }}</span></pre>
  </section>
</template>
