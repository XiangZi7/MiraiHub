import { useStorage } from '@vueuse/core'

/** 表浏览器和查询结果共用表头偏好；重开视图后仍保留，默认显示声明的类型参数。 */
export const columnTypeParametersVisible = useStorage<boolean>(
  'miraihub:database-column-type-parameters-visible',
  true
)

/** 表头右键切换字段长度显示，并同步到所有数据库视图及本地持久化偏好。 */
export function toggleColumnTypeParameters(): void {
  columnTypeParametersVisible.value = !columnTypeParametersVisible.value
}
