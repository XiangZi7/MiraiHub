import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import {
  buildRelease,
  isTransientBundleError,
} from '../scripts/build-release.mjs'

/** 用有序的 CLI 结果验证阶段切换与重试次数，不实际编译或等待。 */
function simulate(results) {
  const calls = []
  const waits = []
  const messages = []
  return {
    calls,
    waits,
    messages,
    run: () =>
      buildRelease({
        platform: 'win32',
        target: '',
        environment: { TAURI_SIGNING_PRIVATE_KEY: 'test-only-key' },
        run: async (args, options) => {
          calls.push({ args, env: options.env })
          assert.ok(results.length, 'unexpected extra build or bundle command')
          return results.shift()
        },
        wait: async milliseconds => {
          waits.push(milliseconds)
        },
        log: message => messages.push(message),
      }),
  }
}

// 构造成功的 CLI 退出结果，用于编译和打包阶段。
const success = () => ({ status: 0, output: '' })
// 复现用户日志中的 DLL 下载 504，并保留可验证的退出码。
const transient = status => ({
  status,
  output:
    'Downloading nsis_tauri_utils.dll\nfailed to bundle project: `http status: 504`',
})

test('successful release compiles once before bundling and keeps signing variables in both phases', async () => {
  const fixture = simulate([success(), success()])
  assert.equal(await fixture.run(), 0)
  assert.deepEqual(
    fixture.calls.map(call => call.args),
    [
      ['build', '--no-bundle', '--', '--locked'],
      ['bundle', '--bundles', 'nsis'],
    ]
  )
  for (const call of fixture.calls) {
    assert.equal(call.env.TAURI_SIGNING_PRIVATE_KEY, 'test-only-key')
    assert.equal(call.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, '')
  }
  assert.deepEqual(fixture.waits, [])
  assert.doesNotMatch(fixture.messages.join('\n'), /test-only-key/)
})

test('504 bundling failures retry only packaging with bounded backoff', async () => {
  const fixture = simulate([success(), transient(1), transient(1), success()])
  assert.equal(await fixture.run(), 0)
  assert.equal(fixture.calls.filter(call => call.args[0] === 'build').length, 1)
  assert.equal(
    fixture.calls.filter(call => call.args[0] === 'bundle').length,
    3
  )
  assert.deepEqual(fixture.waits, [10000, 20000])
})

test('exhausted download retries return the last failing exit code', async () => {
  const fixture = simulate([
    success(),
    transient(1),
    transient(1),
    transient(7),
  ])
  assert.equal(await fixture.run(), 7)
  assert.equal(fixture.calls.length, 4)
  assert.deepEqual(fixture.waits, [10000, 20000])
})

test('a compile failure never enters bundling or a network retry', async () => {
  const fixture = simulate([transient(101)])
  assert.equal(await fixture.run(), 101)
  assert.equal(fixture.calls.length, 1)
  assert.deepEqual(fixture.waits, [])
})

test('permanent bundle failures, signing errors and 404 responses fail immediately', async () => {
  for (const output of [
    'failed to bundle project: makensis failed to open installer.nsi',
    'failed to sign updater: invalid signing key password',
    'failed to bundle project: http status: 404',
    'failed to bundle project: checksum mismatch',
  ]) {
    const fixture = simulate([success(), { status: 2, output }])
    assert.equal(await fixture.run(), 2)
    assert.equal(fixture.calls.length, 2)
    assert.deepEqual(fixture.waits, [])
  }
})

test('retry classification accepts temporary HTTP and transport errors', () => {
  for (const output of [
    'http status: 408',
    'http status: 425',
    'http status: 429',
    'http status: 500',
    'http status: 502',
    'http status: 503',
    'http status: 504',
    'http status: `504`',
    'request timed out',
    'connection reset by peer',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'dns error',
    'unexpected end of file',
  ])
    assert.equal(isTransientBundleError(output), true, output)
  for (const output of [
    'http status: 400',
    'http status: 401',
    'http status: 403',
  ])
    assert.equal(isTransientBundleError(output), false, output)
})

test('real child processes stream diagnostics and retry the installer without rerunning build', async t => {
  const root = mkdtempSync(join(tmpdir(), 'miraihub-build-release-'))
  t.after(() => {
    assert.match(
      relative(resolve(tmpdir()), resolve(root)),
      /^miraihub-build-release-[^/\\]+$/
    )
    rmSync(root, { recursive: true, force: true })
  })
  const cli = join(root, 'node_modules', '@tauri-apps', 'cli')
  mkdirSync(cli, { recursive: true })
  writeFileSync(
    join(cli, 'tauri.js'),
    `
    const fs = require('node:fs');
    const file = 'calls.json';
    const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    const args = process.argv.slice(2);
    calls.push(args);
    fs.writeFileSync(file, JSON.stringify(calls));
    if (args[0] === 'bundle' && calls.filter(call => call[0] === 'bundle').length === 1) {
      console.error('failed to bundle project: http status: 504');
      process.exit(1);
    }
    console.log('fixture ' + args[0] + ' completed');
  `
  )
  const waits = []
  const status = await buildRelease({
    projectRoot: root,
    platform: 'win32',
    target: '',
    environment: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: 'test-only-key' },
    wait: async milliseconds => {
      waits.push(milliseconds)
    },
    log() {},
  })
  assert.equal(status, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'calls.json'), 'utf8')), [
    ['build', '--no-bundle', '--', '--locked'],
    ['bundle', '--bundles', 'nsis'],
    ['bundle', '--bundles', 'nsis'],
  ])
  assert.deepEqual(waits, [10000])
})
