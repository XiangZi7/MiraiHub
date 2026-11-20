import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const boundary = dataModule(`
  export const calls = []
  export class Channel { constructor(callback) { this.onmessage = callback } }
  export async function invoke(command, args) { calls.push({ command, args }) }
`)
const { calls } = await import(boundary)
const load = sourceLoader({
  '@tauri-apps/api/core': boundary,
  '@/i18n': dataModule('export const i18n = { global: { t: value => value } }'),
  '@/utils/window': dataModule('export const IS_TAURI = true'),
})
const { sendRdpInput } = await load('src/api/rdp.ts')

test('RDP 实际 API 保留安全组合键专用消息与目标 session，不合成浏览器按键', async () => {
  const events = [{ type: 'releaseAll' }, { type: 'ctrlAltDelete' }]
  await sendRdpInput('session-fixture', events)
  assert.deepEqual(calls, [
    {
      command: 'rdp_input',
      args: { sessionId: 'session-fixture', events },
    },
  ])
})
