/** 体验增强（SQLite、执行计划、ER 图、结构对比、SSH 与 Agent 增强）新增的文案。中文为键。 */
export const en: Record<string, string> = {
  // SQLite 连接
  请填写连接名称并选择数据库文件:
    'Enter a connection name and choose a database file',
  数据库文件: 'Database file',
  '选择 SQLite 数据库文件': 'Choose SQLite database file',
  '选择或输入 .db / .sqlite 文件路径（不存在时自动创建）':
    'Choose or enter a .db / .sqlite path (created if missing)',
  'SQLite 暂不支持可视化设计表，已打开 SQL 模板':
    'SQLite tables cannot be designed visually yet; opened an SQL template instead',
  'SQLite 只支持 ADD / RENAME / DROP COLUMN':
    'SQLite only supports ADD / RENAME / DROP COLUMN',

  // SQL 编辑器与执行计划
  '让 AI 修复': 'Fix with AI',
  '正在分析执行计划…': 'Analyzing execution plan…',
  执行计划分析失败: 'Failed to analyze execution plan',
  查看执行计划: 'Explain plan',
  '格式化 SQL': 'Format SQL',
  运行当前语句: 'Run current statement',
  '这段 SQL 无法格式化，请检查语法':
    'This SQL cannot be formatted. Check the syntax.',
  '约 {count} 行': '~{count} rows',

  // ER 图
  'ER 图': 'ER diagram',
  '表过多，仅展示前 120 张': 'Too many tables; showing the first 120',
  '拖动表头移动 · 滚轮缩放 · 拖空白处平移':
    'Drag headers to move · Scroll to zoom · Drag empty space to pan',
  重置视图: 'Reset view',

  // 结构对比
  结构对比: 'Schema diff',
  结构对比失败: 'Schema diff failed',
  读取数据库列表失败: 'Failed to read databases',
  '对比两个库的表、字段与索引，生成让目标库与源库一致的迁移 SQL。':
    'Compare tables, columns and indexes of two databases and generate migration SQL that aligns the target with the source.',
  开始对比: 'Compare',
  两个库的结构一致: 'Both databases have the same structure',
  源: 'Source',
  目标: 'Target',
  '源（期望结构）': 'Source (desired structure)',
  '目标（将被修改）': 'Target (will be changed)',
  '已选 {count} 项': '{count} selected',
  新增表: 'Add table',
  删除表: 'Drop table',
  新增字段: 'Add column',
  删除字段: 'Drop column',
  修改字段: 'Modify column',
  新增索引: 'Add index',
  删除索引: 'Drop index',
  使用双花括号填写变量: 'Use double braces for variables',
  分组: 'Folder',
  '标签（逗号分隔）': 'Tags (comma separated)',
  填写片段变量: 'Fill snippet variables',
  发送到多台主机: 'Send to multiple hosts',
  填入终端: 'Insert into terminal',
  '搜索命令、分组或标签': 'Search commands, folders or tags',
  终端录制回放: 'Terminal recording playback',
  '录制达到容量上限，已保留前面的内容':
    'Recording limit reached; earlier output has been retained',
  回放进度: 'Playback position',
  播放: 'Play',
  播放速度: 'Playback speed',
  导出录制: 'Export recording',
  录制文件过大: 'Recording file is too large',
  读取录制失败: 'Failed to read recording',
  停止录制: 'Stop recording',
  开始录制: 'Start recording',
  导入录制回放: 'Import recording',
  低风险: 'Low risk',
  中风险: 'Medium risk',
  高风险: 'High risk',
  极高风险: 'Critical risk',
  我理解此操作可能造成不可恢复的数据丢失或服务中断:
    'I understand this operation may cause irreversible data loss or service interruption',
  本会话允许相同操作: 'Allow identical operations in this conversation',
  重试此步骤: 'Retry this step',
  '每百万 Token 单价（USD，留空不估算费用）':
    'Price per million tokens (USD; leave blank to disable estimates)',
  输入单价: 'Input price',
  输出单价: 'Output price',
  缓存读取单价: 'Cache read price',
  '输入 / 输出 / 缓存 Token': 'Input / output / cached tokens',
  '按自定义单价估算，实际账单以供应商为准':
    'Estimated using custom prices; actual provider billing may differ',
  本轮: 'This turn',
  会话: 'Conversation',
  管理提示词模板: 'Manage prompt templates',
  保存模板失败: 'Failed to save templates',
  斜杠命令: 'Slash command',
  提示词内容: 'Prompt content',
  添加: 'Add',
  目录同步: 'Directory sync',
  扫描目录失败: 'Failed to scan directories',
  '同步完成：成功 {done} / {total}':
    'Sync finished: {done} / {total} succeeded',
  同步失败: 'Sync failed',
  '按大小和修改时间比较，选中项目会覆盖目标文件；不会删除文件。':
    'Compare sizes and modification times. Selected files overwrite their destinations; no files are deleted.',
  '本地 → 远端': 'Local → Remote',
  '远端 → 本地': 'Remote → Local',
  '处理中…': 'Processing…',
  预览差异: 'Preview differences',
  没有需要同步的文件: 'No files need syncing',
  类型冲突: 'Type conflict',
  新增: 'New',
  覆盖: 'Overwrite',
  同步选中文件: 'Sync selected files',
  读取本地目录失败: 'Failed to read local directory',
  本地文件: 'Local files',
  选择本地目录: 'Choose local directory',
  本地目录路径: 'Local directory path',
  '双击文件上传，拖到另一栏传输':
    'Double-click a file to upload; drag across panes to transfer',
  本地与远端双栏: 'Local and remote panes',
  校验并续传: 'Verify and resume',
  '跳板链最多 5 跳，不能重复或同时配置目标代理':
    'A jump chain supports up to 5 unique hops and cannot use a target proxy',
  '跳板连接不存在，请重新选择': 'Jump connection is missing; select it again',
  '跳板链（按顺序连接）': 'Jump chain (connection order)',
  跳板主机: 'Jump host',
  移除: 'Remove',
  添加跳板: 'Add jump host',
  '选择已有 SSH 连接作为中转；代理只作用于第一跳。':
    'Use saved SSH connections as jump hosts. A proxy applies only to the first hop.',
  'SSH 连接链路': 'SSH connection route',
  本机: 'Local machine',
  连接中: 'Connecting',
  已断开: 'Disconnected',
  已连接: 'Connected',
  趋势时间范围: 'Trend time range',
  分钟: 'minutes',
  '优化器无法估算影响范围，请核对完整 SQL':
    'The optimizer could not estimate the scope; review the complete SQL',
  '优化器预估处理 {count} 行（实际影响行数以执行结果为准）':
    'Optimizer estimates processing {count} rows (actual affected rows depend on execution)',
  分析执行计划: 'Analyze execution plan',
  读取日志尾部: 'Read log tail',
  '列出 SSH 隧道': 'List SSH tunnels',
  比较服务器状态: 'Compare server status',
  说明: 'Description',
  '按所选权限审批工具；会话授权只匹配相同操作。':
    'Tools follow the selected permission mode; conversation grants match identical operations only.',
  桌面: 'Desktop',
  上传选中文件: 'Upload selected files',
  '已选择 {count} 项': '{count} items selected',
  本地已有同名文件或文件夹:
    'A local file or folder with this name already exists',
  结构对比已关闭: 'Schema comparison has been closed',
  '表数量超过 120，无法生成完整的结构迁移':
    'More than 120 tables; a complete migration cannot be generated',
  '无法读取部分表结构，已停止对比：{tables}':
    'Cannot read some table definitions; comparison stopped: {tables}',
  'SQLite 修改字段需要重建表，请手动迁移':
    'SQLite column changes require rebuilding the table; migrate manually',
  自增方式变化需要手动迁移: 'Identity changes require manual migration',
  特殊索引需要手动迁移: 'Special indexes require manual migration',
  '外键、主键或特殊表属性变化需要手动迁移':
    'Foreign key, primary key or table option changes require manual migration',
  修改索引: 'Modify index',
  修改约束: 'Modify constraint',
  复制失败: 'Copy failed',
  'AI 解读': 'AI insight',
  重新解读: 'Explain again',
  '发送 SQL、执行计划与相关表索引给当前 AI 配置':
    'Sends the SQL, plan and related table indexes to the active AI profile',
  'AI 正在解读执行计划…': 'AI is interpreting the plan…',
  相关节点: 'Related nodes',
  '请先调用 explain_sql 获取执行计划与相关索引，再分析附加 SQL 的性能并给出优化建议。':
    'Call explain_sql first to get the plan and related indexes, then analyze the attached SQL performance and suggest optimizations.',
}
