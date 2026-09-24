/** Application-owned native messages. Service responses, SQL, and shell output stay verbatim. */
export const en = {
  '任务容量无效：每轮模型请求须为 1–128 次，上下文须为 64–4000 KB，历史消息须为 16–2048 条，失败重试须为 0–999 次':
    'Invalid task limits: use 1–128 model requests, 64–4000 KB of context, 16–2048 messages, and 0–999 retries.',
  'Redis 扫描参数无效': 'Invalid Redis scan arguments',
  'Redis 键标识无效': 'Invalid Redis key identifier',
  'Redis 操作超时；写入可能已生效，请核对结果':
    'Redis operation timed out. Writes may have taken effect; check the result.',
  '扫描 Redis 键': 'Scan Redis keys',
  '读取 Redis 键': 'Read Redis key',
  '执行 Redis 命令': 'Run Redis command',
  '扫描当前 Redis 数据库中的一批键':
    'Scan one batch of keys in the current Redis database',
  '读取 Redis 键类型、TTL 和部分内容':
    'Read Redis key type, TTL and a bounded value preview',
  'Redis 连接已断开，请重新连接':
    'Redis connection closed. Reconnect to continue.',
  'Redis 数据库索引必须是非负整数':
    'Redis database index must be a non-negative integer',
  'Redis TLS 请选择 Disable 或 Verify Full':
    'For Redis TLS, select Disable or Verify Full',
  'Redis 命令转义不完整': 'Incomplete Redis command escape',
  'Redis 命令引号未闭合': 'Unclosed quote in Redis command',
  '请输入 Redis 命令': 'Enter a Redis command',
  '此命令会改变 Redis 连接状态；切换数据库请使用顶部数据库索引':
    'This command changes Redis connection state. Use the database index field to switch databases.',
  'Redis 键不存在或已过期': 'Redis key does not exist or has expired',
  'Redis 键不存在或类型已变化，请刷新':
    'Redis key no longer exists or its type changed. Refresh to continue.',
  'TTL 必须为正整数，-1 表示永不过期':
    'TTL must be a positive integer, or -1 for no expiry',
  '只读检查：自动执行': 'Read-only check: automatic execution',
  '审批已过期，未执行该操作；可以继续发送消息':
    'Approval expired. The operation was not executed. You can continue chatting.',
  '模型连接或响应超时，请稍后重试；长上下文、模型思考或中转站拥堵可能增加等待时间':
    'The model connection or response timed out. Try again later; long context, model reasoning or a busy relay may increase the wait.',
  '无法连接模型服务，请检查网络、证书及 API 地址':
    'Cannot connect to the model service. Check the network, certificate and API URL.',
  '模型连接中断或请求失败，请检查网络与中转站状态':
    'The model connection was interrupted or the request failed. Check the network and relay status.',
  模型流式响应超过传输容量限制: 'The model stream exceeded the transfer limit',
  '模型流式响应不是有效 JSON': 'The model stream contains invalid JSON',
  '模型服务在生成过程中返回错误，请检查模型与中转站状态':
    'The model service returned an error during generation. Check the model and relay status.',
  服务未返回兼容的流式响应:
    'The service did not return a compatible streaming response',
  '服务返回了 Responses 流，请在 AI Agent 设置中将 API 格式改为 OpenAI · Responses':
    'The service returned a Responses stream. Set the API format to OpenAI · Responses in AI Agent settings.',
  '服务返回了 Claude Messages 流，请在 AI Agent 设置中将 API 格式改为 Claude · Messages':
    'The service returned a Claude Messages stream. Set the API format to Claude · Messages in AI Agent settings.',
  '流式分片缺少 choices，请检查 API 格式与中转站协议转换':
    'A stream chunk is missing choices. Check the API format and relay protocol conversion.',
  '模型结束标记后仍返回内容或冲突状态，未执行本次工具调用':
    'The model sent content or a conflicting status after completion. This tool call was not executed.',
  '服务未返回兼容 OpenAI Responses 的响应':
    'The service did not return a compatible OpenAI Responses response',
  模型工具调用分片无效: 'The model returned invalid tool call fragments',
  '模型工具调用的 id/type 不是字符串，未执行本次操作':
    'The tool call id/type is not a string. This operation was not executed.',
  '模型工具调用的 ID 在分片间发生冲突，未执行本次操作':
    'The tool call ID conflicts across fragments. This operation was not executed.',
  '模型工具调用的函数名或参数不是字符串，未执行本次操作':
    'The tool function name or arguments are not strings. This operation was not executed.',
  '模型工具调用缺少函数名，未执行本次操作':
    'The tool call is missing a function name. This operation was not executed.',
  '模型工具调用缺少参数，未执行本次操作':
    'The tool call is missing arguments. This operation was not executed.',
  '模型工具调用参数必须是 JSON 对象，未执行本次操作':
    'Tool call arguments must be a JSON object. This operation was not executed.',
  '模型工具调用参数不完整，未执行本次操作':
    'Tool call arguments are incomplete. This operation was not executed.',
  '模型工具调用参数不是有效 JSON，未执行本次操作':
    'Tool call arguments are not valid JSON. This operation was not executed.',
  '模型服务未能完成此回复，请调整请求后重试':
    'The model service could not complete this response. Adjust the request and try again.',
  '模型流式响应未完整结束，未执行本次工具调用，请重试':
    'The model stream did not finish. This tool call was not executed. Try again.',
  '此窗口无权调用 AI 功能': 'This window cannot access AI features',
  任务已取消: 'Task cancelled',
  审批已使用或不存在: 'Approval has already been used or does not exist',
  审批与本次操作不匹配: 'Approval does not match this operation',
  '审批已过期，请重新发起请求': 'Approval expired. Submit a new request.',
  'AI 会话不存在，请开始新对话':
    'AI session not found. Start a new conversation.',
  'SSH 目标不能包含数据库': 'An SSH target cannot include a database',
  'AI 仅支持已连接的 SSH 或数据库':
    'AI requires a connected SSH session or database',
  '连接或活动数据库已变化，审批失效':
    'The connection or active database changed. Approval is no longer valid.',
  数据库已切换: 'Database switched',
  读取数据库结构超时: 'Reading database structure timed out',
  'SQL 超时，已请求取消；此前语句可能已提交，请核对结果':
    'SQL timed out and cancellation was requested. Earlier statements may have committed. Check the results.',
  服务未返回兼容的文本响应:
    'The service did not return a compatible text response',
  '模型连接成功（未发送服务器或数据库数据）':
    'Model connection successful (no server or database data was sent)',
  'AI 配置已变化，请重新选择配置后发送':
    'AI configuration changed. Select the profile again before sending.',
  '运行中的 AI 对话过多，请先停止或清空对话':
    'Too many active AI conversations. Stop or clear one first.',
  请等待当前任务结束或开始新对话:
    'Wait for the current task to finish or start a new conversation',
  '已阻止并行工具调用，请使用支持单工具调用的模型':
    'Parallel tool calls were blocked. Use a model that supports single tool calls.',
  '缺少有效工具调用 ID': 'A valid tool call ID is missing',
  不支持的工具类型: 'Unsupported tool type',
  '等待审批；尚未执行': 'Awaiting approval; not executed yet',
  '完全访问权限：自动执行': 'Full access: automatic execution',
  模型没有返回文本或有效工具调用:
    'The model returned neither text nor a valid tool call',
  '已拒绝；任务停止，未执行该操作':
    'Rejected; task stopped without executing this operation',
  用户批准本次执行: 'User approved this operation',
  '已停止后续操作；正在执行的操作可能已生效':
    'Further operations stopped; operations already running may have taken effect',
  读取服务器状态: 'Read server status',
  读取数据库结构: 'Read database structure',
  '执行 Shell 命令': 'Execute shell command',
  '执行 SQL': 'Execute SQL',
  读取服务器的固定状态信息: 'Read predefined server status information',
  读取当前数据库的对象和字段结构:
    'Read objects and column definitions in the current database',
  工具参数不符合后端安全策略:
    'Tool arguments do not meet the backend safety policy',
  '工具参数为空、过长或包含非法字符':
    'Tool arguments are empty, too long, or contain invalid characters',
  工具参数过长: 'Tool arguments are too long',
  对象名称过长: 'Object name is too long',
  '未知工具或工具与当前连接类型不匹配，已阻止执行':
    'Execution blocked: unknown tool or incompatible connection type',
  只读探针不在允许列表中: 'Read-only probe is not in the allowlist',
  '服务未返回兼容的模型列表，请手动输入模型 ID':
    'The service returned an incompatible model list. Enter the model ID manually.',
  '模型列表分页无效，请手动输入模型 ID':
    'Invalid model list pagination. Enter the model ID manually.',
  '模型列表分页未前进，请手动输入模型 ID':
    'Model list pagination did not advance. Enter the model ID manually.',
  无法定位聊天记录目录: 'Could not locate the chat history directory',
  '无效的聊天会话 ID': 'Invalid conversation ID',
  聊天记录文件过大: 'Chat history file is too large',
  聊天记录已损坏: 'Chat history is corrupted',
  此聊天记录不属于当前连接或数据库:
    'This chat history belongs to a different connection or database',
  无法保存聊天记录: 'Could not save chat history',
  '请输入 1 至 60 个字符的会话名称，不能包含换行或控制字符':
    'Enter a conversation name of 1–60 characters without newlines or control characters',
  '上一轮操作仍在结束中，请稍后继续此会话':
    'The previous operation is still finishing. Resume this conversation shortly.',
  '此会话仍在处理中，请先停止当前操作':
    'This conversation is still running. Stop the current operation first.',
  '聊天记录已损坏，无法加载历史列表':
    'Chat history is corrupted. Could not load the history list.',
  '聊天记录文件与会话 ID 不匹配':
    'Chat history file does not match the conversation ID',
  '请输入不超过 16000 字节的消息，或添加文本附件':
    'Enter a message up to 16000 bytes or attach a text file',
  '附件必须是非空的 UTF-8 文本，单个文件不能超过 1 GB':
    'Attachments must contain non-empty UTF-8 text, up to 1 GB per file',
  无法读取附件: 'Could not read attachment',
  '请先在设置 → AI Agent 中启用并填写模型':
    'Enable and configure a model in Settings → AI Agent first',
  'API 地址无效': 'Invalid API URL',
  'API 地址必须使用 HTTPS（本机可用 HTTP），不能包含账号、查询参数或片段':
    'API URLs must use HTTPS (HTTP is allowed locally) and cannot include credentials, query parameters, or fragments',
  'AI 配置不存在，请重新选择或添加配置':
    'AI profile not found. Select or add a profile.',
  '请填写配置名称（最多 80 字）': 'Enter a profile name (up to 80 characters)',
  '最多保存 100 个 AI 配置': 'Up to 100 AI profiles can be saved',
  'AI 设置损坏，无法读取': 'AI settings are corrupted and cannot be read',
  无法定位设置目录: 'Could not locate the settings directory',
  模型或密钥格式无效: 'Invalid model or key format',
  '更换服务地址时请重新输入密钥或选择清除旧密钥，避免将旧密钥发送到其他服务':
    'When changing the service URL, re-enter the key or clear the old key to avoid sending it to another service',
  读取模型响应失败: 'Could not read model response',
  '模型响应超过 1 MB 限制': 'Model response exceeds the 1 MB limit',
  '模型响应不是有效 JSON': 'Model response is not valid JSON',
  '工具调用参数不是有效 JSON': 'Tool call arguments are not valid JSON',
  不支持的消息类型: 'Unsupported message type',
  工具定义无效: 'Invalid tool definition',
  '服务未返回兼容 Claude Messages 的响应':
    'The service did not return a compatible Claude Messages response',
  '模型输出达到长度上限，请缩小任务范围后重试':
    'Model output reached the length limit. Reduce the task scope and try again.',
  'Claude 工具参数无效': 'Invalid Claude tool arguments',
  '模型单轮返回的工具调用过多，未执行本次操作':
    'The model returned too many tool calls in one turn. Nothing was executed.',
  '并行工具调用未执行：请一次只调用一个工具，得到结果后再调用下一个。':
    'Parallel tool calls were not executed. Call one tool at a time and wait for its result.',
  'MCP 响应的单行超过 1 MB 限制':
    'A single line of the MCP response exceeds the 1 MB limit',
  'MCP 服务返回的不是 JSON': 'The MCP server did not return JSON',
  'MCP 服务返回错误': 'The MCP server returned an error',
  'MCP 服务的标准输入不可用': 'The MCP server stdin is unavailable',
  'MCP 服务的标准输出不可用': 'The MCP server stdout is unavailable',
  'MCP 服务已退出': 'The MCP server exited',
  'MCP 响应超过 1 MB 限制': 'The MCP response exceeds the 1 MB limit',
  'MCP 服务响应超时': 'The MCP server timed out',
  '读取 MCP 服务响应失败': 'Could not read the MCP server response',
  'MCP 服务的事件流没有返回匹配的响应':
    'The MCP event stream did not return a matching response',
  '请填写 MCP 服务器名称（最多 80 字）':
    'Enter an MCP server name (up to 80 characters)',
  'MCP 服务器的适用目标无效': 'Invalid target for the MCP server',
  '请填写启动命令（最多 512 字符，不能含控制字符）':
    'Enter a start command (up to 512 characters, no control characters)',
  '启动参数最多 32 项，每项最多 1024 字符':
    'Up to 32 arguments, 1024 characters each',
  '环境变量或请求头最多 32 项': 'Up to 32 environment variables or headers',
  '环境变量或请求头的名称无效（字母、数字与下划线，且不能以数字开头）':
    'Invalid environment variable or header name (letters, digits and underscores; cannot start with a digit)',
  环境变量或请求头的值过长或含控制字符:
    'An environment variable or header value is too long or contains control characters',
  'MCP 工具调用超时': 'The MCP tool call timed out',
  'MCP 服务器已删除或停用，未执行本次操作':
    'The MCP server was removed or disabled. Nothing was executed.',
  '最多保存 20 个 MCP 服务器': 'Up to 20 MCP servers can be saved',
  'MCP 服务器不存在，请刷新后重试':
    'MCP server not found. Refresh and try again.',
  'MCP 工具参数必须是 JSON 对象，未执行本次操作':
    'MCP tool arguments must be a JSON object. Nothing was executed.',
  '调用外部 MCP 工具': 'Call an external MCP tool',
  '调用 MCP 工具': 'Call MCP tool',
} satisfies Record<string, string>
export const zh = Object.fromEntries(
  Object.keys(en).map(key => [key, key])
) as Record<keyof typeof en, string>
