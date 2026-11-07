<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import type { ContextMenuItem } from '@/types/context-menu'

const { t } = useI18n()

/** 数据网格的单元格右键菜单；表数据和只读查询结果共用，只读时编辑类菜单项置灰。 */
const props = defineProps<{
  open: boolean
  x: number
  y: number
  canFilter?: boolean
  canEdit?: boolean
  canInsert?: boolean
  /** 活动单元格属于外键，可跳到被引用的记录。 */
  canFollow?: boolean
  /** 引用当前表的外键，作为“查看引用此行的记录”的子菜单。 */
  referencing?: ReadonlyArray<{ id: string; label: string }>
  /** 点击的行已标记删除，删除项变为撤销。 */
  deleted?: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
}>()

const items = computed<ContextMenuItem[]>(() => [
  { id: 'copy-value', label: t('复制值'), icon: 'lucide:copy' },
  { id: 'copy-row', label: t('复制行'), icon: 'lucide:rows-2' },
  {
    id: 'copy-as',
    label: t('复制为'),
    icon: 'lucide:clipboard-copy',
    children: [
      { id: 'copy:insert', label: 'INSERT' },
      { id: 'copy:update', label: 'UPDATE' },
      { id: 'copy:json', label: 'JSON' },
      { id: 'copy:markdown', label: 'Markdown' },
      { id: 'copy:tsv', label: 'TSV' },
      { id: 'copy:csv', label: 'CSV' },
      { id: 'copy:in', label: t('IN 列表') },
    ],
  },
  {
    id: 'view',
    label: t('在值查看器中打开'),
    icon: 'lucide:panel-right',
    separatorBefore: true,
  },
  {
    id: 'filter-equal',
    label: t('按此值筛选'),
    icon: 'lucide:filter',
    disabled: !props.canFilter,
    separatorBefore: true,
  },
  {
    id: 'filter-exclude',
    label: t('排除此值'),
    icon: 'lucide:filter-x',
    disabled: !props.canFilter,
  },
  ...(props.canFollow
    ? [
        {
          id: 'follow-key',
          label: t('打开被引用的记录'),
          icon: 'lucide:link',
          separatorBefore: true,
        },
      ]
    : []),
  ...(props.referencing?.length
    ? [
        {
          id: 'referencing',
          label: t('查看引用此行的记录'),
          icon: 'lucide:corner-down-right',
          separatorBefore: !props.canFollow,
          children: [...props.referencing],
        },
      ]
    : []),
  {
    id: 'set-null',
    label: t('设为 NULL'),
    icon: 'lucide:eraser',
    disabled: !props.canEdit || props.deleted,
    separatorBefore: true,
  },
  {
    id: 'clone',
    label: t('克隆行'),
    icon: 'lucide:copy-plus',
    disabled: !props.canInsert,
  },
  {
    id: 'delete',
    label: props.deleted ? t('撤销删除') : t('删除行'),
    icon: props.deleted ? 'lucide:undo-2' : 'lucide:trash-2',
    danger: !props.deleted,
    disabled: !props.canEdit,
  },
])
</script>

<template>
  <AppContextMenu
    :open="open"
    :x="x"
    :y="y"
    :items="items"
    :label="t('数据行操作')"
    @close="emit('close')"
    @select="emit('select', $event)"
  />
</template>
