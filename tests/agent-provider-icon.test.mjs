import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { sourceLoader } from './helpers/source-module.mjs'
const { agentProviderIcon, AI_PROVIDER_ICONS } = await sourceLoader()(
  'src/utils/agent-provider-icon.ts'
)

test('model branding wins over relay names and compatible API addresses', () => {
  for (const [model, provider] of [
    ['deepseek-v4-pro', 'deepseek'],
    ['claude-sonnet-4', 'claude'],
    ['gemini-3-pro', 'gemini'],
    ['doubao-seed', 'doubao'],
    ['gpt-5', 'openai'],
    ['o3', 'openai'],
  ])
    assert.equal(
      agentProviderIcon({
        model,
        baseUrl: 'https://relay.example/v1',
        name: '我的中转站',
      }),
      AI_PROVIDER_ICONS[provider]
    )
  assert.equal(
    agentProviderIcon({ baseUrl: 'https://api.anthropic.com/v1' }),
    AI_PROVIDER_ICONS.claude
  )
  assert.equal(
    agentProviderIcon({ name: '快乐代码 · deepseek-v4-pro' }),
    AI_PROVIDER_ICONS.deepseek
  )
  assert.equal(
    agentProviderIcon({
      model: 'unknown',
      baseUrl: 'https://relay.example/v1',
    }),
    AI_PROVIDER_ICONS.custom
  )
})

test('every provider icon is bundled locally as SVG with no scripts or remote images', () => {
  for (const path of Object.values(AI_PROVIDER_ICONS)) {
    assert.ok(existsSync('public' + path), path)
    const svg = readFileSync('public' + path, 'utf8')
    assert.match(svg, /<svg/)
    assert.doesNotMatch(svg, /<script|foreignObject|onload=|onclick=|<image/i)
  }
})
