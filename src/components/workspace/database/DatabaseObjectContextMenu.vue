<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import type { ContextMenuItem } from '@/types/context-menu'
import type { DatabaseObject } from '@/types/database'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  x: number
  y: number
  object: DatabaseObject | null
}>()

const emit = defineEmits<{
  close: []
  open: [object: DatabaseObject, panel?: 'data' | 'columns']
  inspect: [object: DatabaseObject]
  query: [object: DatabaseObject]
  copy: [object: DatabaseObject]
  rename: [object: DatabaseObject]
  remove: [object: DatabaseObject]
  refresh: []
}>()

const items = computed<ContextMenuItem[]>(() => {
  const object = props.object
  if (!object) return []
  const relation = object.kind === 'table' || object.kind === 'view'
  const kindLabel = {
    table: t('表'),
    view: t('视图'),
    procedure: t('存储过程'),
    function: t('函数'),
  }[object.kind]

  return [
    {
      id: 'open-object',
      label: object.kind === 'table' ? t('浏览数据') : t('打开对象'),
      icon: relation ? 'lucide:table-2' : 'lucide:file-code-2',
      groupLabel: `${object.schema}.${object.name}`,
    },
    {
      id: 'query-object',
      label: relation
        ? t('生成 SELECT 查询')
        : object.kind === 'procedure'
          ? t('生成 CALL 查询')
          : t('生成函数查询'),
      icon: 'lucide:square-terminal',
    },
    {
      id: 'structure-object',
      label: t('查看结构'),
      icon: 'lucide:columns-3',
      disabled: !relation,
    },
    {
      id: 'copy-object',
      label: t('复制限定名称'),
      icon: 'lucide:copy',
      separatorBefore: true,
    },
    { id: 'rename-object', label: t('重命名…'), icon: 'lucide:pencil' },
    { id: 'refresh', label: t('刷新对象树'), icon: 'lucide:rotate-cw' },
    {
      id: 'remove-object',
      label: t('删除{value0}…', { value0: kindLabel }),
      icon: 'lucide:trash-2',
      iconTone: 'danger',
      danger: true,
      separatorBefore: true,
    },
  ]
})

function select(id: string): void {
  const object = props.object
  if (!object) return
  if (id === 'open-object') emit('open', object)
  else if (id === 'query-object') emit('query', object)
  else if (
    id === 'structure-object' &&
    (object.kind === 'table' || object.kind === 'view')
  ) {
    emit('inspect', object)
    emit('open', object, 'columns')
  } else if (id === 'copy-object') emit('copy', object)
  else if (id === 'rename-object') emit('rename', object)
  else if (id === 'remove-object') emit('remove', object)
  else if (id === 'refresh') emit('refresh')
}
</script>

<template>
  <AppContextMenu
    :open="open && Boolean(object)"
    :x="x"
    :y="y"
    :items="items"
    :label="t('数据库对象操作')"
    @close="emit('close')"
    @select="select"
  />
</template>
