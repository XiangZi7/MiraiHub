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
  '-- 暂无修改': '-- No changes',
  'MySQL 8.0.16 及以上版本才会强制执行检查约束。': 'MySQL enforces check constraints only on 8.0.16 and later.',
  'MySQL 的 DDL 会隐式提交，失败前已执行的语句无法回滚。': 'MySQL DDL commits implicitly; statements executed before a failure cannot be rolled back.',
  'RANGE / LIST 分区至少需要一个分区': 'RANGE / LIST partitioning needs at least one partition',
  'SQLite 不支持修改已有表的检查约束': 'SQLite cannot change check constraints of an existing table',
  'SQLite 不支持修改已有表的检查约束，仅可在新建表时设置。': 'SQLite cannot change check constraints of an existing table; set them when creating the table.',
  '不分区': 'No partitioning',
  '从模板或现有表复制结构': 'Copy structure from template or table',
  '例如：price >= 0 AND status IN (0, 1)': 'e.g. price >= 0 AND status IN (0, 1)',
  '保存时会创建或替换触发函数，再创建触发器；修改触发器会先删除再重建。': 'Saving creates or replaces the trigger function, then creates the trigger; changed triggers are dropped and recreated.',
  '保存时在事务中执行，任一语句失败将整体回滚。': 'Runs in a transaction; any failed statement rolls back everything.',
  '修改': 'Modify',
  '共 {value0} 条语句将被执行，可在 SQL 预览中查看完整内容。': '{value0} statement(s) will be executed. See the SQL preview for the full script.',
  '分区': 'Partitions',
  '分区“{value0}”的取值不合法': 'Partition "{value0}" has an invalid value',
  '分区值': 'Partition value',
  '分区名': 'Partition name',
  '分区名“{value0}”为空、不合法或重复': 'Partition name "{value0}" is empty, invalid or duplicated',
  '分区字段': 'Partition columns',
  '分区数': 'Partition count',
  '分区数必须是正整数': 'Partition count must be a positive integer',
  '分区方式': 'Partition method',
  '分区表达式': 'Partition expression',
  '分区表达式不能为空': 'Partition expression is required',
  '分区表达式不能包含语句分隔符或注释': 'Partition expression cannot contain statement separators or comments',
  '分区表达式涉及的字段必须包含在主键和所有唯一索引中，且分区表不支持外键。': 'Columns used by the partition expression must be part of the primary key and every unique index; partitioned tables do not support foreign keys.',
  '删除分区': 'Delete partition',
  '删除检查约束': 'Delete check constraint',
  '删除触发器': 'Delete trigger',
  '变更摘要': 'Change summary',
  '复制表': 'Copy table',
  '外键“{value0}”包含重复的字段': 'Foreign key "{value0}" contains duplicate columns',
  '外键“{value0}”的本地字段与引用字段数量不一致': 'Foreign key "{value0}" has mismatched local and referenced column counts',
  '多条语句以分号分隔，MySQL 会自动包裹 BEGIN…END；修改触发器会先删除再重建。': 'Separate statements with semicolons; MySQL wraps them in BEGIN…END automatically. Changed triggers are dropped and recreated.',
  '尚未配置检查约束': 'No check constraints',
  '尚未配置触发器': 'No triggers',
  '已复制表结构，请检查后创建': 'Structure copied. Review it before creating.',
  '已有表的分区仅供查看，调整分区请在查询中执行 ALTER TABLE … PARTITION。': 'Partitions of existing tables are read-only here; run ALTER TABLE … PARTITION in a query to change them.',
  '当前数据库未返回检查约束信息，暂不支持在此编辑。': 'This database did not return check constraints, so they cannot be edited here.',
  '当前数据库未返回触发器信息，暂不支持在此编辑。': 'This database did not return triggers, so they cannot be edited here.',
  '当前表未分区': 'This table is not partitioned',
  '执行失败的语句：{value0}\n错误：{value1}': 'Failed statement: {value0}\nError: {value1}',
  '撤销 (Ctrl+Z)': 'Undo (Ctrl+Z)',
  '暂无修改': 'No changes',
  '检查约束': 'Check constraints',
  '检查约束“{value0}”不能包含语句分隔符或注释': 'Check constraint "{value0}" cannot contain statement separators or comments',
  '检查约束“{value0}”缺少表达式': 'Check constraint "{value0}" needs an expression',
  '检查表达式': 'Check expression',
  '模板：基础表（主键 + 时间戳）': 'Template: basic table (primary key + timestamps)',
  '模板：日志表': 'Template: log table',
  '添加分区': 'Add partition',
  '添加字段对（多列外键）': 'Add column pair (composite key)',
  '添加检查约束': 'Add check',
  '添加触发器': 'Add trigger',
  '留空表示按表名和触发器名生成': 'Leave empty to generate from table and trigger names',
  '确认保存表结构修改': 'Confirm structure changes',
  '确认创建数据表': 'Confirm table creation',
  '移除字段对': 'Remove column pair',
  '第 {value0} 个检查约束': 'Check constraint #{value0}',
  '第 {value0} 个检查约束缺少名称': 'Check constraint #{value0} needs a name',
  '第 {value0} 个触发器': 'Trigger #{value0}',
  '第 {value0} 个触发器缺少名称': 'Trigger #{value0} needs a name',
  '第 {value0} 条语句执行失败，已回滚全部修改：{value1}': 'Statement {value0} failed and all changes were rolled back: {value1}',
  '第 {value0} 条语句执行失败，此前 {value1} 条已生效：{value2}': 'Statement {value0} failed; {value1} earlier statement(s) were already applied: {value2}',
  '约束名“{value0}”重复': 'Constraint name "{value0}" is duplicated',
  '行数': 'Rows',
  '表分区当前只支持 MySQL': 'Table partitioning is only supported for MySQL',
  '触发事件': 'Events',
  '触发函数体（plpgsql）': 'Function body (plpgsql)',
  '触发函数（留空自动生成）': 'Trigger function (generated if empty)',
  '触发器': 'Triggers',
  '触发器“{value0}”在当前数据库只能选择一个事件': 'Trigger "{value0}" can only have one event in this database',
  '触发器“{value0}”的 TRUNCATE 事件只支持 PostgreSQL 语句级触发器': 'Trigger "{value0}": TRUNCATE is only supported for PostgreSQL statement-level triggers',
  '触发器“{value0}”的函数体不能包含 {value1}': 'Trigger "{value0}" body cannot contain {value1}',
  '触发器“{value0}”的函数名不合法': 'Trigger "{value0}" has an invalid function name',
  '触发器“{value0}”缺少语句体': 'Trigger "{value0}" needs a body',
  '触发器“{value0}”至少需要一个事件': 'Trigger "{value0}" needs at least one event',
  '触发器“{value0}”重复': 'Trigger "{value0}" is duplicated',
  '触发器名': 'Trigger name',
  '触发时机': 'Timing',
  '触发级别': 'Level',
  '触发语句': 'Trigger statement',
  '重做 (Ctrl+Y)': 'Redo (Ctrl+Y)',
  'AI 生成表结构': 'AI: generate table',
  'AI 补全注释': 'AI: fill in comments',
  'AI 审查设计': 'AI: review design',
  'AI 辅助': 'AI assist',
  '存在错误': 'Has errors',
  'AI 返回的内容无法解析': 'Could not parse the AI response',
  '请先描述要创建的表': 'Describe the table first',
  'AI 请求失败': 'AI request failed',
  '已应用 AI 生成的表结构，可撤销':
    'Applied the AI-generated structure. You can undo it.',
  '已补全 {value0} 处注释': 'Filled in {value0} comments',
  '用自然语言描述表的用途和字段，生成后先预览再应用。':
    'Describe the table and its columns in plain language. Review the result before applying it.',
  '只会填写当前为空的表备注和字段备注。':
    'Only empty table and column comments are filled in.',
  '从命名、类型选择、索引和范式角度检查当前设计。':
    'Checks naming, type choices, indexes and normalization.',
  '表结构描述': 'Table description',
  '例如：订单表，包含用户、金额、状态、下单时间，按用户和状态查询':
    'e.g. An orders table with user, amount, status and order time, queried by user and status',
  'AI 正在分析…': 'AI is working…',
  '属性': 'Attributes',
  '应用后将用生成的字段替换当前字段列表，可使用撤销恢复。':
    'Applying replaces the current column list with the generated one. You can undo it.',
  '没有需要补全的注释': 'No comments need filling in',
  '未发现明显问题': 'No obvious problems found',
  '问题': 'Problem',
  '建议': 'Suggestion',
  '关闭': 'Close',
  '应用到设计器': 'Apply to designer',
  '填入注释': 'Fill in comments',
  '点击工具栏「添加字段」，或使用 AI 生成表结构':
    'Click “Add column” in the toolbar, or let AI generate the table',
  '字段名': 'Column',
  '备注': 'Comment',
  '触发器函数': 'Trigger function',
  '已删除触发器的专属函数': 'Functions used only by removed triggers',
  '同时删除触发器函数 {value0}': 'Also drop trigger function {value0}',
  '该函数仅被触发器 {value0} 使用，取消勾选则保留函数。':
    'Only trigger {value0} uses this function. Clear the box to keep it.',
  'MySQL 不支持 DDL 事务：每条语句执行后立即生效，中途失败时之前的语句不会回滚。失败后会列出已生效的语句，并尽量给出逆向语句供手动恢复。':
    'MySQL has no transactional DDL: each statement takes effect immediately, and statements that ran before a failure are not rolled back. On failure, the applied statements are listed along with suggested reverse statements for manual recovery where possible.',
  '以下 {value0} 条语句已生效，未被回滚：':
    'These {value0} statements were applied and not rolled back:',
  '建议的逆向语句（请核对后手动执行，已删除的数据无法恢复）':
    'Suggested reverse statements (review before running manually; dropped data cannot be recovered)',
  '无法自动推导逆向语句，请根据上方已生效的语句手动恢复。':
    'Reverse statements could not be derived. Restore manually based on the applied statements above.',
  '逆向语句已复制': 'Reverse statements copied',
  '当前数据库暂不支持在设计器中维护分区':
    'Partitions cannot be maintained in the designer for this database',
  '当前表未分区；为已有表设置分区方式请在查询中执行 ALTER TABLE … PARTITION BY。':
    'This table is not partitioned. To partition an existing table, run ALTER TABLE … PARTITION BY in a query.',
  '当前表包含子分区，暂不支持在此维护，请在查询中执行 ALTER TABLE … PARTITION。':
    'This table has subpartitions, which cannot be maintained here. Run ALTER TABLE … PARTITION in a query.',
  'HASH / KEY 分区在此只能清空分区；增减分区数请在查询中执行 ADD PARTITION PARTITIONS / COALESCE PARTITION。':
    'HASH / KEY partitions can only be truncated here. To change the partition count, run ADD PARTITION PARTITIONS / COALESCE PARTITION in a query.',
  '分区方式 {value0} 暂不支持在此维护':
    'Partitioning method {value0} cannot be maintained here',
  '当前分区方式不支持 {value0}':
    'The current partitioning method does not support {value0}',
  '{value0} 需要选择至少一个分区': '{value0} needs at least one partition selected',
  '分区“{value0}”不存在': 'Partition "{value0}" does not exist',
  '分区“{value0}”被多个分区操作引用':
    'Partition "{value0}" is used by more than one partition operation',
  'RANGE 分区只能重组相邻的分区':
    'Only adjacent RANGE partitions can be reorganized',
  '不能删除全部分区；取消分区请在查询中执行 ALTER TABLE … REMOVE PARTITIONING。':
    'Cannot drop all partitions. To remove partitioning, run ALTER TABLE … REMOVE PARTITIONING in a query.',
  '{value0} 至少需要一个新分区': '{value0} needs at least one new partition',
  '最后一个分区是 MAXVALUE，无法追加 RANGE 分区；请改用重组分区拆分“{value0}”。':
    'The last partition is MAXVALUE, so RANGE partitions cannot be appended. Reorganize "{value0}" to split it instead.',
  'SQLite 需要重建表才能修改检查约束，请先单独保存字段、索引、外键或触发器的修改':
    'SQLite must rebuild the table to change check constraints. Save column, index, foreign key or trigger changes separately first.',
  '无法解析 SQLite 建表语句，不能通过重建表修改检查约束':
    'Cannot parse the SQLite CREATE TABLE statement, so check constraints cannot be changed by rebuilding the table',
  '表“{value0}”有指向自身的外键，重建会触发外键动作，请在查询中手动修改检查约束':
    'Table "{value0}" has a self-referencing foreign key and rebuilding it would fire foreign key actions. Change the check constraints manually in a query.',
  'SQLite 无法直接修改检查约束，以下语句将在同一事务中重建表，任一步失败都会整体回滚。':
    'SQLite cannot alter check constraints directly. The statements below rebuild the table in one transaction; if any step fails, everything is rolled back.',
  '1. 确认没有其他表的外键引用此表（删除旧表会触发外键动作）':
    '1. Make sure no other table references this table by foreign key (dropping the old table fires foreign key actions)',
  '2. 按新的检查约束创建临时表并复制数据':
    '2. Create a temporary table with the new check constraints and copy the data',
  '3. 删除旧表，并把临时表改回原名':
    '3. Drop the old table and rename the temporary table back',
  '4. 原样重建索引与触发器': '4. Recreate indexes and triggers as they were',
  '破坏性变更（需确认）': 'Destructive changes (confirmation required)',
  '只有勾选的项会应用：未勾选的删除保留原字段，未勾选的改名保留原字段名；删除字段会丢失该列数据。':
    'Only checked items are applied: unchecked drops keep the column and unchecked renames keep the original name. Dropping a column deletes its data.',
  '删除字段 {value0}': 'Drop column {value0}',
  '字段 {value0} 改名为 {value1}': 'Rename column {value0} to {value1}',
  '保存时将在同一事务中重建表（临时表→复制数据→删除旧表→改名→重建索引与触发器）；字段定义内联的 CHECK 保持不变。':
    'Saving rebuilds the table in one transaction (temporary table → copy data → drop old table → rename → recreate indexes and triggers). CHECKs written inline in column definitions stay unchanged.',
  '分区操作': 'Partition operation',
  '删除分区操作': 'Remove partition operation',
  '作用的分区': 'Target partitions',
  '新增的分区': 'New partitions',
  '重组为以下分区': 'Reorganize into these partitions',
  '添加分区操作': 'Add partition operation',
  '每项操作生成一条独立的 ALTER TABLE 语句；MySQL 分区操作不支持事务，失败前已执行的语句不会回滚。删除或清空分区会丢弃其中的数据。':
    'Each operation runs as a separate ALTER TABLE statement. MySQL partition operations are not transactional, so statements that ran before a failure are not rolled back. Dropping or truncating a partition discards its data.',
}
