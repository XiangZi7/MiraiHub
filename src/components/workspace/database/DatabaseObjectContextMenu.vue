<script setup lang="ts">
import { computed } from 'vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import type { ContextMenuItem } from '@/types/context-menu'
import type { DatabaseObject } from '@/types/database'

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
    table: '表',
    view: '视图',
    procedure: '存储过程',
    function: '函数',
  }[object.kind]

  return [
    {
      id: 'open-object',
      label: object.kind === 'table' ? '浏览数据' : '打开对象',
      icon: relation ? 'lucide:table-2' : 'lucide:file-code-2',
      groupLabel: `${object.schema}.${object.name}`,
    },
    {
      id: 'query-object',
      label: relation
        ? '生成 SELECT 查询'
        : object.kind === 'procedure'
          ? '生成 CALL 查询'
          : '生成函数查询',
      icon: 'lucide:square-terminal',
    },
    {
      id: 'structure-object',
      label: '查看结构',
      icon: 'lucide:columns-3',
      disabled: !relation,
    },
    {
      id: 'copy-object',
      label: '复制限定名称',
      icon: 'lucide:copy',
      separatorBefore: true,
    },
    { id: 'rename-object', label: '重命名…', icon: 'lucide:pencil' },
    { id: 'refresh', label: '刷新对象树', icon: 'lucide:rotate-cw' },
    {
      id: 'remove-object',
      label: `删除${kindLabel}…`,
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
    label="数据库对象操作"
    @close="emit('close')"
    @select="select"
  />
</template>
