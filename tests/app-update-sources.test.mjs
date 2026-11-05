import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'
const { checkAppUpdate } = await sourceLoader()('src/api/app-updater.ts')

test('updates fall back across check and download failures, close old resources and retain the selected version', async () => {
  const calls = []
  const create = (version, fail = false) => ({
    version,
    async download(report) {
      calls.push(['download', version])
      if (fail) throw new Error('network')
      report({ event: 'Finished' })
    },
    async install() {
      calls.push(['install', version])
    },
    async close() {
      calls.push(['close', version])
    },
  })
  const pkg = await checkAppUpdate('auto', '', async prefix => {
    calls.push(['check', prefix])
    if (prefix.includes('gh-proxy.com')) throw new Error('offline')
    return create('3.1.0', prefix.includes('ghfast'))
  })
  await pkg.download(() => {}, { timeout: 100 })
  await pkg.install()
  await pkg.close()
  assert.deepEqual(
    calls.filter(x => x[0] === 'check').map(x => x[1]),
    ['https://gh-proxy.com/', 'https://ghfast.top/', '']
  )
  assert.equal(calls.filter(x => x[0] === 'close').length, 2)
  assert.deepEqual(
    calls.filter(x => x[0] === 'install'),
    [['install', '3.1.0']]
  )
})

test('a different version from a fallback source is discarded; verification errors remain errors', async () => {
  let closed = 0
  const pkg = await checkAppUpdate('ghfast', '', async prefix => ({
    version: prefix ? '3.1.0' : '3.2.0',
    async download() {
      throw new Error('signature verification failed')
    },
    async install() {
      assert.fail('unverified packages must not install')
    },
    async close() {
      closed++
    },
  }))
  await assert.rejects(
    pkg.download(() => {}, { timeout: 100 }),
    /signature/
  )
  assert.equal(closed, 2)
  await pkg.close()
  assert.equal(closed, 2)
})

test('direct mode never forwards requests, while custom mode requires an address and supports a direct fallback', async () => {
  const seen = []
  assert.equal(
    await checkAppUpdate('github', '', async prefix => {
      seen.push(prefix)
      return null
    }),
    null
  )
  assert.deepEqual(seen, [''])
  await assert.rejects(checkAppUpdate('custom', ''), /填写/)
  seen.length = 0
  await checkAppUpdate('custom', 'https://proxy.example/', async prefix => {
    seen.push(prefix)
    if (prefix) throw new Error('offline')
    return null
  })
  assert.deepEqual(seen, ['https://proxy.example/', ''])
})
