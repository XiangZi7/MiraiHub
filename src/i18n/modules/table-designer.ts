/** 表设计器（字段 / 索引增强）新增的文案。中文为键。 */
export const en: Record<string, string> = {
  // 校验
  '字段“{value0}”需要填写枚举值': 'Column “{value0}” needs enum values',
  '字段“{value0}”必须指定长度': 'Column “{value0}” requires a length',
  '字段“{value0}”不允许为空，默认值不能是 NULL':
    'Column “{value0}” is NOT NULL, so its default cannot be NULL',
  '字段“{value0}”的排序规则不合法': 'Column “{value0}” has an invalid collation',
  '字段“{value0}”的字符集不合法': 'Column “{value0}” has an invalid charset',
  '字段“{value0}”的生成表达式不能包含语句分隔符或注释':
    'The generated expression of column “{value0}” cannot contain statement separators or comments',
  '生成列“{value0}”不能同时设置默认值或自动递增':
    'Generated column “{value0}” cannot have a default or auto increment',
  '自动递增字段“{value0}”必须是主键或索引的第一列':
    'Auto-increment column “{value0}” must be a primary key or the first column of an index',
  '空间索引当前只支持 MySQL': 'Spatial indexes are only supported on MySQL',
  'PostgreSQL 的 HASH 索引不支持唯一约束':
    'PostgreSQL HASH indexes cannot be unique',
  '空间索引“{value0}”只能包含一个字段':
    'Spatial index “{value0}” can only contain one column',
  '索引“{value0}”的条件不能包含语句分隔符或注释':
    'The condition of index “{value0}” cannot contain statement separators or comments',
  '索引“{value0}”的表达式不能包含语句分隔符或注释':
    'Expressions in index “{value0}” cannot contain statement separators or comments',
  '索引“{value0}”的前缀长度必须是正整数':
    'Prefix lengths in index “{value0}” must be positive integers',
  '全文索引“{value0}”只能使用字符串字段':
    'Fulltext index “{value0}” can only use string columns',
  '空间索引“{value0}”只能使用空间类型字段':
    'Spatial index “{value0}” can only use spatial columns',
  '索引“{value0}”的字段“{value1}”需要前缀长度':
    'Column “{value1}” in index “{value0}” needs a prefix length',
  '字段“{value0}”的长度必须大于 0':
    'The length of column “{value0}” must be greater than 0',
  '字段“{value0}”的小数位不能大于精度':
    'The scale of column “{value0}” cannot exceed its precision',
  '字段“{value0}”只有日期时间类型才能默认当前时间':
    'Only date/time columns can default to the current time (“{value0}”)',
  '索引名不能使用保留名 PRIMARY': 'Index name cannot be the reserved PRIMARY',
  '索引“{value0}”包含重复的字段':
    'Index “{value0}” contains duplicate columns',
  '索引“{value0}”的前缀长度超过字段“{value1}”的长度':
    'The prefix length in index “{value0}” exceeds the length of column “{value1}”',

  // 类型分组
  整数: 'Integer',
  小数: 'Decimal',
  字符串: 'String',
  日期时间: 'Date & time',
  二进制: 'Binary',
  其他: 'Other',
  空间: 'Spatial',
  当前表: 'Current table',
  网络: 'Network',

  // 字段编辑
  '跟随表默认（{value0}）': 'Table default ({value0})',
  跟随表默认: 'Table default',
  无默认值: 'No default',
  文本: 'Text',
  表达式: 'Expression',
  '已选 {value0} 个': '{value0} selected',
  '{value0} 个字段': '{value0} columns',
  在当前字段后插入: 'Insert after current column',
  '上移 (Alt+↑)': 'Move up (Alt+↑)',
  '下移 (Alt+↓)': 'Move down (Alt+↓)',
  '复制字段 (Ctrl+D)': 'Duplicate column (Ctrl+D)',
  '删除字段 (Delete)': 'Delete column (Delete)',
  'PostgreSQL 不支持调整已有字段的位置，排序只对新建表生效':
    'PostgreSQL cannot reorder existing columns; ordering only applies to new tables',
  'Enter 下一行 · Alt+↑↓ 移动 · Ctrl+D 复制 · Delete 删除':
    'Enter next row · Alt+↑↓ move · Ctrl+D duplicate · Delete remove',
  小数位: 'Scale',
  选择字段: 'Select column',
  生成列: 'Generated column',
  枚举值: 'Enum values',
  复合主键中的顺序: 'Order in composite primary key',
  空字符串: 'Empty string',
  字段属性: 'Column properties',
  默认值类型: 'Default kind',
  更新时自动设为当前时间: 'Set to current time on update',
  零填充: 'Zero fill',
  生成列表达式: 'Generated expression',
  '留空表示普通字段，如 price * qty':
    'Leave empty for a regular column, e.g. price * qty',
  生成列存储方式: 'Generated column storage',

  // 索引编辑
  空间索引: 'Spatial index',
  索引备注: 'Index comment',
  '条件（部分索引 WHERE）': 'Condition (partial index WHERE)',
  '索引列（按顺序）': 'Index columns (in order)',
  索引表达式: 'Index expression',
  '切换升序 / 降序': 'Toggle ascending / descending',
  上移: 'Move up',
  下移: 'Move down',
  移出索引: 'Remove from index',
  添加表达式: 'Add expression',
}
