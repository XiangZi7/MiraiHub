import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { parse } from 'vue/compiler-sfc'

const requireVite = createRequire(import.meta.resolve('vite'))
const postcss = requireVite('postcss')
const tooltip = parse(
  readFileSync(
    new URL('../src/components/ui/AppTooltip.vue', import.meta.url),
    'utf8'
  )
).descriptor
const styles = postcss.parse(
  tooltip.styles.map(style => style.content).join('\n')
)
const theme = postcss.parse(
  readFileSync(
    new URL('../src/assets/styles/main.css', import.meta.url),
    'utf8'
  )
)

/** 按浏览器是否支持尖角轮廓查找规则，避免将兼容分支的边框误判成重复描边。 */
function tooltipRule(selector, supported) {
  let result
  styles.walkRules(rule => {
    const shape =
      rule.parent.type === 'atrule' && rule.parent.name === 'supports'
    if (rule.selector === selector && shape === supported) result = rule
  })
  assert.ok(result, selector)
  return result
}

/** 读取单个声明的真实 CSS 值，不受格式化换行影响。 */
function value(rule, property) {
  let result
  rule.walkDecls(property, declaration => {
    result = declaration.value.replace(/\s+/g, ' ').trim()
  })
  return result
}

test('玻璃裁剪与 SVG 共用完整轮廓，不再用直线和旋转方块分别补边', () => {
  const rule = tooltipRule('.app-tooltip', true)
  assert.equal(value(rule, 'border-color'), 'transparent')
  assert.equal(value(rule, 'box-shadow'), 'var(--shadow-pop-drop)')
  assert.equal(value(rule, '--menu-surface-clip'), 'var(--tooltip-shape-clip)')
  assert.equal(
    value(rule, '--menu-surface-inset'),
    'var(--tooltip-shape-inset)'
  )
  assert.match(tooltip.template.content, /<path :d="shape\.path"/)
  assert.match(
    tooltip.template.content,
    /:viewBox="`0 0 \$\{shape\.width\} \$\{shape\.height\}`"/
  )
  styles.walkRules(rule => {
    assert.equal(/\.app-tooltip::(?:before|after)/.test(rule.selector), false)
  })
})

test('圆角和描边不被视口裁剪，宿主 border 尺寸与旧浏览器回退保留', () => {
  const outline = tooltipRule('.app-tooltip-outline', false)
  assert.equal(value(outline, 'overflow'), 'visible')
  assert.equal(value(outline, 'stroke-width'), '1px')
  assert.equal(value(outline, 'stroke-linejoin'), 'round')
  assert.equal(value(outline, 'left'), '-1px')
  assert.equal(value(outline, 'display'), 'none')
  assert.equal(
    value(tooltipRule('.app-tooltip-outline', true), 'display'),
    'block'
  )
  assert.equal(
    value(tooltipRule('.app-tooltip', false), 'border-radius'),
    'var(--tooltip-radius, 6px)'
  )
  // 透明 border 仍占 1px，完整矩形回退不会改变气泡测量与定位。
  const classes = tooltip.template.content
    .match(/class="([^"]*)"/)[1]
    .split(/\s+/)
  assert.ok(classes.includes('border'))
  assert.ok(classes.includes('shadow-pop'))
  assert.equal(
    value(tooltipRule('.app-tooltip', false), 'box-shadow'),
    undefined
  )
})

test('明暗浮层阴影均保留原投影、硬外环和高光，拆分只供气泡按需复用', () => {
  const sets = []
  theme.walkDecls('--shadow-pop', declaration => {
    const declarations = new Map()
    declaration.parent.walkDecls(item =>
      declarations.set(item.prop, item.value)
    )
    sets.push(declarations)
  })
  assert.equal(sets.length, 2)
  for (const declarations of sets) {
    const shadow = declarations.get('--shadow-pop')
    assert.ok(shadow.includes('var(--shadow-pop-drop)'))
    assert.ok(shadow.includes('var(--shadow-pop-inset)'))
    assert.match(shadow, /0 0 0 1px/)
    assert.match(declarations.get('--shadow-pop-drop'), /^0 24px 56px -12px /)
    assert.match(declarations.get('--shadow-pop-inset'), /^inset 0 1px 0 /)
  }
})
