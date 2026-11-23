import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { parse } from 'vue/compiler-sfc'

const compilerRequire = createRequire(import.meta.resolve('vue/compiler-sfc'))
const { baseParse } = compilerRequire('@vue/compiler-dom')

const panel = readFileSync('src/pages/settings/components/ai-settings-panel.vue', 'utf8')
const form = readFileSync('src/pages/settings/components/ai-profile-form.vue', 'utf8')

/** 解析真实模板，按元素树验证分组而非依赖缩进。 */
function elements(source) {
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const result = []
  function visit(node, ancestors = []) {
    if (node.type === 1) result.push({ node, ancestors })
    for (const child of node.children ?? []) visit(child, node.type === 1 ? [...ancestors, node] : ancestors)
  }
  visit(baseParse(descriptor.template.content))
  return result
}

/** 获取模板元素的静态类名，用于验证业务区块归属。 */
function hasClass(node, name) {
  return node.props.some(prop => prop.type === 6 && prop.name === 'class' && prop.value?.content.split(/\s+/).includes(name))
}

test('MCP remains mounted in an independent extension card, outside security rules', () => {
  const mcp = elements(panel).filter(({ node }) => node.tag === 'McpServersPanel')
  assert.equal(mcp.length, 1)
  assert.ok(mcp[0].ancestors.some(node => hasClass(node, 'ai-extension-card')))
  assert.ok(!mcp[0].ancestors.some(node => hasClass(node, 'security-rules')))
})

test('advanced controls remain mounted in a native keyboard-accessible disclosure', () => {
  const nodes = elements(form)
  const details = nodes.find(({ node }) => node.tag === 'details')
  assert.ok(details)
  assert.ok(details.node.children.some(node => node.tag === 'summary'))
  assert.ok(!details.node.props.some(prop => prop.name === 'open'))
  const capacity = nodes.find(({ node }) => node.tag === 'AiCapacityFields')
  assert.ok(capacity.ancestors.includes(details.node))
  assert.ok(!capacity.node.props.some(prop => prop.type === 7 && prop.name === 'if'))
})

test('layout adapts to the settings container and motion preference', () => {
  assert.match(panel, /@container settings \(max-width: 680px\)/)
  assert.match(form, /@container settings \(max-width: 680px\)/)
  assert.match(panel, /prefers-reduced-motion: no-preference/)
  assert.match(form, /prefers-reduced-motion: reduce/)
  assert.ok(elements(panel).some(({ node }) => hasClass(node, 'ai-delete-action')))
})
