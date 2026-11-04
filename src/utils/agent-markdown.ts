import MarkdownIt from 'markdown-it/browser'
import { i18n } from '@/i18n'

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
    renderer.renderInlineAsText(token.children ?? [], options, env) ||
    i18n.global.t('图片')
  const url = String(token.attrGet('src') ?? '')
  if (!isAgentWebLink(url)) return escape(label)
  return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(i18n.global.t('agent.viewImage', { name: label }))}</a>`
}
// 仅数据库面板中的 SQL 代码块提供应用入口，正文始终经过 HTML 转义。
markdown.renderer.rules.fence = (tokens, index, _options, env) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0] || i18n.global.t('代码')
  const apply =
    env?.canApplySql &&
    /^(sql|mysql|postgresql|postgres|pgsql|sqlite|tsql|mssql|plsql)$/i.test(
      language
    )
      ? `<button type="button" data-apply-sql>${escape(i18n.global.t('agent.applySql'))}</button>`
      : ''
  return `<div class="md-code"><div class="md-code-header"><span>${escape(language)}</span>${apply}<button type="button" data-copy-code aria-label="${escape(i18n.global.t('复制代码'))}">${escape(i18n.global.t('复制'))}</button></div><pre tabindex="0" aria-label="${escape(i18n.global.t('代码块'))}"><code>${escape(token.content)}</code></pre></div>\n`
}
markdown.renderer.rules.table_open = () =>
  `<div class="md-table" tabindex="0" role="region" aria-label="${escape(i18n.global.t('表格，可横向滚动'))}"><table>\n`
markdown.renderer.rules.table_close = () => '</table></div>\n'

// 渲染受限 Markdown；调用方明确开启时才添加 SQL 应用按钮。
export function renderAgentMarkdown(
  content: string,
  canApplySql = false
): string {
  return markdown.render(content, { canApplySql })
}
