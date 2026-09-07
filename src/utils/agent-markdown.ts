import MarkdownIt from 'markdown-it/browser'

export function isAgentWebLink(value: string): boolean {
  try {
    if (!/^https?:\/\//i.test(value)) return false
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      ['http:', 'https:'].includes(url.protocol)
    )
  } catch {
    return false
  }
}

// Only this renderer may supply HTML to the chat view. Raw HTML is escaped,
// links allow web URLs only, and model-provided images never load automatically.
const markdown = new MarkdownIt({ html: false, breaks: true })
markdown.validateLink = isAgentWebLink
const escape = markdown.utils.escapeHtml
markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  _env,
  renderer
) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, index, options)
}
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const label =
    renderer.renderInlineAsText(token.children ?? [], options, env) || '图片'
  const url = String(token.attrGet('src') ?? '')
  if (!isAgentWebLink(url)) return escape(label)
  return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">查看图片：${escape(label)}</a>`
}
markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0] || '代码'
  return `<div class="md-code"><div class="md-code-header"><span>${escape(language)}</span><button type="button" data-copy-code aria-label="复制代码">复制</button></div><pre tabindex="0" aria-label="代码块"><code>${escape(token.content)}</code></pre></div>\n`
}
markdown.renderer.rules.table_open = () =>
  '<div class="md-table" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n'
markdown.renderer.rules.table_close = () => '</table></div>\n'

export function renderAgentMarkdown(content: string): string {
  return markdown.render(content)
}
