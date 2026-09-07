import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'
const { renderAgentMarkdown, isAgentWebLink } = await sourceLoader()(
  'src/utils/agent-markdown.ts'
)

test('renders chat Markdown with lists, emphasis, quotes, tables and copyable code', () => {
  const html = renderAgentMarkdown(
    '## 查询结果\n\n**管理员**有 `9` 个。\n\n- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二\n\n> 请核对\n\n| 表 | 数量 |\n| --- | ---: |\n| admin_user | 9 |\n\n```sql\nSELECT *\n  FROM admin_user\n WHERE id < 10;\n```\n\n[文档](https://example.com/docs)'
  )
  for (const tag of ['h2', 'strong', 'code', 'ul', 'ol', 'blockquote', 'table'])
    assert.match(html, new RegExp(`<${tag}[ >]`))
  assert.match(html, /data-copy-code/)
  assert.match(html, /SELECT \*\n  FROM admin_user\n WHERE id &lt; 10;/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /class="md-table"/)
})
test('escapes HTML and rejects script, local-file and custom-protocol links', () => {
  const html = renderAgentMarkdown(
    '<script>alert(1)</script>\n<img src="https://example.com/track" onerror="alert(1)">\n\n[x](javascript:alert(1)) [x](data:text/html;base64,PHNjcmlwdD4=) [x](file:///C:/secret) [x](tauri://localhost) [x](https://user:password@example.com)'
  )
  assert.doesNotMatch(html, /<(script|img|iframe|object)\b|<a\b/)
  assert.match(html, /&lt;script&gt;/)
  for (const link of [
    'javascript:alert(1)',
    'data:image/svg+xml,test',
    'file:///C:/secret',
    'tauri://localhost',
    '/settings',
    '//example.com',
    'https://user:password@example.com',
  ])
    assert.equal(isAgentWebLink(link), false, link)
  assert.equal(isAgentWebLink('https://example.com/docs?a=1'), true)
})
test('remote images require a click and fenced text cannot inject HTML or attributes', () => {
  const html = renderAgentMarkdown(
    '![服务截图](https://example.com/track.png)\n\n```sql\"onclick=\"evil\n</code></pre><img src=x onerror=evil>\n```'
  )
  assert.doesNotMatch(html, /<img\b|<script\b| onclick=/)
  assert.match(html, /查看图片：服务截图/)
  assert.match(html, /&lt;\/code&gt;&lt;\/pre&gt;&lt;img/)
})
test('unfinished Markdown keeps readable text and preserves code whitespace', () => {
  const html = renderAgentMarkdown(
    '开始处理\n下一行\n\n```sql\nSELECT id,\n  name\nFROM users'
  )
  assert.match(html, /开始处理<br>\n下一行/)
  assert.match(html, /SELECT id,\n  name\nFROM users/)
  assert.match(html, /<\/code><\/pre>/)
})
