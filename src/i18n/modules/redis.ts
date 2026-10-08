export const en = {
  搜索: 'Search',
  写入: 'Write',
  '输入键名，例如 user 或 cache': 'Enter a key name, e.g. user or cache',
  键搜索方式: 'Key search mode',
  包含: 'Contains',
  前缀: 'Prefix',
  匹配模式: 'Glob pattern',
  'user:* 前缀 · *token* 包含 · ? 单字符':
    'user:* prefix · *token* contains · ? one character',
  '留空搜索全部键，Enter 开始搜索':
    'Leave empty for all keys. Press Enter to search.',
  筛选已加载的键: 'Filter loaded keys',
  清除筛选: 'Clear filter',
  前缀分组层级: 'Prefix grouping depth',
  平铺列表: 'Flat list',
  一级分组: '1-level groups',
  二级分组: '2-level groups',
  三级分组: '3-level groups',
  '已加载的键中没有匹配项，请使用上方搜索':
    'No matches in loaded keys. Try the search above.',
  '每页最多 {count} 行': 'Up to {count} rows per page',
  当前键完整名称: 'Full name of the selected key',
  扫描未完成: 'More keys to scan',
  扫描完成: 'Scan complete',
  数量与分组仅统计已加载的键: 'Counts and groups include loaded keys only',
  常用命令速查: 'Common commands',
  '点击填入，修改后执行': 'Click to insert, edit, then run',
  命令分类: 'Command category',
  常用查询: 'Common queries',
  String: 'String',
  Hash: 'Hash',
  List: 'List',
  Set: 'Set',
  'Sorted Set': 'Sorted Set',
  Stream: 'Stream',
  写入与删除: 'Write and delete',
  目标键: 'Target key',
  命令模板目标键: 'Target key for command templates',
  'SCAN 匹配模式': 'SCAN match pattern',
  '返回 PONG 表示连接正常。': 'PONG means the connection is working.',
  统计当前库键数: 'Count keys in this DB',
  '返回当前 DB 的全部键数量，与左侧已加载数量不同。':
    'Returns the total key count in this DB, beyond the loaded keys in the sidebar.',
  按模式查找键: 'Find keys by pattern',
  '结果第一项是下一游标；替换命令中的 0 继续，返回 0 才结束。COUNT 是批量提示，可能返回空批次。':
    'The first result is the next cursor. Replace 0 with it to continue until it returns 0. COUNT is a hint; batches may be empty.',
  查看键类型: 'Check key type',
  '先确认类型，再选择对应的读取命令；类型不匹配会返回 WRONGTYPE。':
    'Check the type before choosing a read command. A type mismatch returns WRONGTYPE.',
  查看过期时间: 'Check expiry',
  '返回剩余秒数；-1 表示永不过期，-2 表示键不存在。':
    'Returns remaining seconds: -1 means no expiry; -2 means the key does not exist.',
  检查键是否存在: 'Check if a key exists',
  '返回 1 表示存在，0 表示不存在。':
    'Returns 1 if the key exists, otherwise 0.',
  查看键内存占用: 'Check key memory usage',
  '返回该键及其值占用的内存字节数（Redis 4.0+）。':
    'Returns the memory used by the key and its value in bytes (Redis 4.0+).',
  查看内存概况: 'Check memory overview',
  '查看 Redis 已用内存、峰值与内存限制。':
    'Shows Redis memory usage, peak usage, and memory limit.',
  读取字符串: 'Read a string',
  '读取 String 值；键不存在时返回 null。大值建议使用 GETRANGE。':
    'Reads a String value, or null if missing. Use GETRANGE for large values.',
  分段读取字符串: 'Read part of a string',
  '读取前 1024 个字节；修改起止位置可继续读取。':
    'Reads the first 1024 bytes. Change the start and end positions to read more.',
  查看字符串长度: 'Check string length',
  '返回字符串的字节长度。': 'Returns the string length in bytes.',
  读取一个字段: 'Read one field',
  '将 field 替换为要读取的 Hash 字段名。':
    'Replace field with the Hash field name to read.',
  分批读取字段和值: 'Scan fields and values',
  '返回下一游标与字段/值数组；替换游标可继续读取。':
    'Returns the next cursor and field/value array. Replace the cursor to read more.',
  统计字段数量: 'Count fields',
  '返回 Hash 中的字段数量。': 'Returns the number of fields in the Hash.',
  '读取列表前 100 项': 'Read the first 100 list items',
  '下标从 0 开始，结束下标包含在结果中；改为 100 199 读取下一段。':
    'Indexes start at 0 and include the end index. Use 100 199 to read the next range.',
  统计列表长度: 'Count list items',
  '返回 List 中的元素数量。': 'Returns the number of items in the List.',
  分批读取集合: 'Scan set members',
  '返回下一游标和成员数组；替换游标可继续读取。':
    'Returns the next cursor and members. Replace the cursor to read more.',
  统计集合成员: 'Count set members',
  '返回 Set 中不重复的成员数量。':
    'Returns the number of unique members in the Set.',
  检查集合成员: 'Check set membership',
  '将 member 替换为成员；返回 1 表示属于该集合。':
    'Replace member with a member name. Returns 1 if it is in the set.',
  读取成员及分数: 'Read members and scores',
  '按分数升序读取前 100 项，同时返回分数。':
    'Reads the first 100 members in ascending score order, including their scores.',
  统计有序集合成员: 'Count sorted set members',
  '返回 Sorted Set 中的成员数量。':
    'Returns the number of members in the Sorted Set.',
  查看成员分数: 'Check member score',
  '将 member 替换为要查询的成员。': 'Replace member with the member to query.',
  '读取流前 100 条': 'Read the first 100 stream entries',
  '返回消息 ID 和字段；用 (上一批最后ID 作为起点可继续（Redis 6.2+）。':
    'Returns entry IDs and fields. Use (lastID as the start to continue after the last entry (Redis 6.2+).',
  统计流消息: 'Count stream entries',
  '返回 Stream 中的消息数量。': 'Returns the number of entries in the Stream.',
  创建字符串键: 'Create a string key',
  '仅在键不存在时写入 value，并在 3600 秒后过期；请先修改示例值。':
    'Writes value only if the key does not exist, with a 3600-second expiry. Edit the example value first.',
  '写入 Hash 字段': 'Write a Hash field',
  '新增或覆盖 field 字段的值，执行后立即生效。':
    'Adds or overwrites the field value immediately.',
  向列表头部添加: 'Prepend to a list',
  '将 value 添加到 List 头部；键不存在时创建列表。':
    'Prepends value to the List, creating it if the key is missing.',
  添加集合成员: 'Add a set member',
  '将 member 添加到 Set，已有成员不会重复添加。':
    'Adds member to the Set. Existing members are not duplicated.',
  添加有序集合成员: 'Add a sorted set member',
  '以分数 0 添加 member；成员已存在时更新分数。':
    'Adds member with score 0, updating the score if it already exists.',
  追加流消息: 'Append a stream entry',
  '自动生成消息 ID，追加 field 和 value 字段。':
    'Appends field and value with an automatically generated entry ID.',
  设置过期时间: 'Set expiry',
  '将键设置为 3600 秒后过期，会替换已有过期时间。':
    'Sets the key to expire in 3600 seconds, replacing any existing expiry.',
  取消过期时间: 'Remove expiry',
  '移除键的过期时间，使其持续保留。': 'Removes the expiry so the key persists.',
  删除指定键: 'Delete a key',
  '立即删除整个键，内存异步释放；此操作无法撤销（Redis 4.0+）。':
    'Deletes the whole key immediately and frees memory asynchronously. This cannot be undone (Redis 4.0+).',
}

export const zh = Object.fromEntries(
  Object.keys(en).map(key => [key, key])
) as Record<keyof typeof en, string>
