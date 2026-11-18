import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'vue/compiler-sfc'

// 使用项目实际安装的构建依赖，复现 Tailwind → Vite 的两轮生产 CSS 压缩。
const tailwindRequire = createRequire(import.meta.resolve('@tailwindcss/vite'))
const viteRequire = createRequire(import.meta.resolve('vite'))
const { compile, optimize } = tailwindRequire('@tailwindcss/node')
const { transform } = viteRequire('lightningcss')
const postcss = viteRequire('postcss')

function productionCss(source) {
  return transform({
    filename: 'production.css',
    code: Buffer.from(optimize(source, { minify: true }).code),
    minify: true,
    targets: { chrome: 105 << 16 },
  }).code.toString()
}

for (const file of [
  'src/assets/styles/main.css',
  'src/components/ui/ToastHost.vue',
]) {
  test(`生产压缩保留标准 backdrop-filter，包括关闭模糊的规则：${file}`, async () => {
    const path = fileURLToPath(new URL(`../${file}`, import.meta.url))
    let source = readFileSync(path, 'utf8')
    if (file.endsWith('.vue'))
      source = parse(source)
        .descriptor.styles.map(style => style.content)
        .join('\n')
    else
      source = (
        await compile(source, { base: dirname(path), onDependency() {} })
      ).build(['glass'])
    const expected = []
    postcss.parse(source).walkDecls('backdrop-filter', declaration => {
      expected.push([declaration.parent.selector, declaration.value])
    })
    assert.ok(expected.length)
    const actual = postcss.parse(productionCss(source))
    for (const [selector, value] of expected) {
      const matches = []
      actual.walkRules(rule => {
        if (rule.selector.replaceAll(' ', '') !== selector.replaceAll(' ', ''))
          return
        rule.walkDecls('backdrop-filter', declaration =>
          matches.push(declaration.value)
        )
      })
      assert.ok(
        matches.some(
          result => result.replaceAll(' ', '') === value.replaceAll(' ', '')
        ),
        `${selector} 在生产构建中丢失 backdrop-filter: ${value}`
      )
    }
  })
}

test('SSH 与本地终端共用透明底色，生产压缩后仍覆盖 xterm 的黑底', async () => {
  for (const file of [
    'src/components/workspace/TerminalPanel.vue',
    'src/pages/servers/components/local-terminal-panel.vue',
  ]) {
    const { descriptor, errors } = parse(
      readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    )
    assert.deepEqual(errors, [])
    assert.match(descriptor.template.content, /class="[^"\n]*\bterminal-pane\b/)
  }
  const path = fileURLToPath(
    new URL('../src/assets/styles/main.css', import.meta.url)
  )
  const result = await compile(readFileSync(path, 'utf8'), {
    base: dirname(path),
    onDependency() {},
  })
  const css = postcss.parse(productionCss(result.build([])))
  const overrides = []
  css.walkRules(rule => {
    // 面板选择器比 xterm 的黑底规则多一层类名，加载顺序不会影响底色。
    if (rule.selector !== '.terminal-pane .xterm .xterm-viewport') return
    rule.walkDecls('background-color', declaration =>
      overrides.push(declaration.value)
    )
  })
  assert.ok(overrides.some(value => ['transparent', '#0000'].includes(value)))
})

test('错误提示保留调用方的绝对定位，不混入相对定位', async () => {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { sourceLoader, dataModule } =
    await import('./helpers/source-module.mjs')
  const load = sourceLoader(
    {
      'vue-i18n': dataModule(
        'export const useI18n = () => ({ t: key => key })'
      ),
    },
    ['src/components/ui/SessionErrorNotice.vue']
  )
  const { default: Notice } = await load(
    'src/components/ui/SessionErrorNotice.vue'
  )
  for (const position of ['absolute', 'fixed']) {
    const html = await renderToString(
      createSSRApp(Notice, {
        message: '模拟连接失败',
        class: position + ' top-2 right-2',
      })
    )
    const root = html.match(/<div\b[^>]*>/)?.[0] ?? ''
    const classes = root.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    assert.deepEqual(
      classes.filter(value =>
        ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(value)
      ),
      [position]
    )
    assert.ok(html.includes('模拟连接失败'))
  }
})
