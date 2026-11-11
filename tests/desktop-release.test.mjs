import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { releaseTargets, assetName } from '../scripts/release-targets.mjs'
import { assembleRelease } from '../scripts/assemble-release.mjs'
import { packageUnix } from '../scripts/package-unix.mjs'
import { buildRelease } from '../scripts/build-release.mjs'

const tag = 'v4.1.0-beta.1'
const version = tag.slice(1)
const commit = 'a'.repeat(40)
const repository = 'XiangZi7/MiraiHub'

/** 构造各平台独立产物，使用真实文件、哈希与聚合脚本验证发布门禁。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'miraihub-desktop-release-'))
  t.after(() => {
    assert.match(
      relative(resolve(tmpdir()), resolve(root)),
      /^miraihub-desktop-release-[^/\\]+$/
    )
    rmSync(root, { recursive: true, force: true })
  })
  const input = join(root, 'input')
  const output = join(root, 'output')
  for (const [id, target] of Object.entries(releaseTargets)) {
    const dir = join(input, `${id}-release`)
    mkdirSync(dir, { recursive: true })
    for (const extension of new Set([...target.downloads, target.updateFile])) {
      const name = assetName(target, extension, version)
      writeFileSync(join(dir, name), `fixture package ${id} ${extension}`)
      if (extension === target.updateFile)
        writeFileSync(
          join(dir, `${name}.sig`),
          Buffer.from(`fixture signature ${id}`).toString('base64') + '\n'
        )
    }
    writeFileSync(
      join(dir, 'version.json'),
      JSON.stringify({
        tag,
        version,
        commit,
        platform: target.platform,
        arch: target.arch,
      })
    )
    writeFileSync(
      join(dir, 'SHA256SUMS.txt'),
      readdirSync(dir)
        .sort()
        .map(
          name =>
            `${createHash('sha256')
              .update(readFileSync(join(dir, name)))
              .digest('hex')}  ${name}\n`
        )
        .join('')
    )
  }
  return { input, output, tag, commit, repository }
}

test('all desktop builds publish only versioned packages with working signed update URLs', t => {
  const options = fixture(t)
  assembleRelease(options)
  const manifest = JSON.parse(
    readFileSync(join(options.output, 'latest.json'), 'utf8')
  )
  assert.equal(manifest.version, version)
  assert.equal(Object.keys(manifest.platforms).length, 4)
  for (const [id, target] of Object.entries(releaseTargets)) {
    const directory = join(options.input, `${id}-release`)
    const update = manifest.platforms[target.updater]
    const updateName = assetName(target, target.updateFile, version)
    assert.equal(
      update.signature,
      readFileSync(join(options.output, `${updateName}.sig`), 'utf8').trim()
    )
    assert.equal(
      update.url,
      `https://github.com/${repository}/releases/download/${tag}/${assetName(target, target.updateFile, version)}`
    )
    assert.deepEqual(
      readFileSync(
        join(options.output, new URL(update.url).pathname.split('/').at(-1))
      ),
      readFileSync(join(directory, updateName))
    )
    for (const extension of target.downloads)
      assert.deepEqual(
        readFileSync(
          join(options.output, assetName(target, extension, version))
        ),
        readFileSync(
          join(directory, assetName(target, extension, version))
        )
      )
  }
  for (const name of readdirSync(options.output))
    assert.ok(
      ['latest.json', 'version.json', 'SHA256SUMS.txt'].includes(name) ||
        name.startsWith(`MiraiHub_${version}_`),
      `Unexpected unversioned release asset: ${name}`
    )
  for (const line of readFileSync(
    join(options.output, 'SHA256SUMS.txt'),
    'utf8'
  )
    .trim()
    .split('\n')) {
    const [hash, name] = line.split('  ')
    assert.equal(
      hash,
      createHash('sha256')
        .update(readFileSync(join(options.output, name)))
        .digest('hex')
    )
  }
})

test('missing platform, mixed source commits and changed binaries cannot reach publication', t => {
  for (const mode of ['missing', 'commit', 'corrupt']) {
    const options = fixture(t)
    if (mode === 'commit') options.commit = 'b'.repeat(40)
    if (mode === 'missing') options.input = join(options.input, 'absent')
    if (mode === 'corrupt')
      writeFileSync(
        join(
          options.input,
          'linux-x64-release',
          assetName(releaseTargets['linux-x64'], 'deb', version)
        ),
        'changed after packaging'
      )
    assert.throws(() => assembleRelease(options))
    assert.throws(() => readdirSync(options.output), /ENOENT/)
  }
})

test('macOS and Linux builds select native packages, retain target and omit empty Apple secrets', async () => {
  for (const [platform, target, bundles] of [
    ['darwin', 'aarch64-apple-darwin', 'app,dmg'],
    ['linux', 'x86_64-unknown-linux-gnu', 'deb,appimage'],
  ]) {
    const calls = []
    assert.equal(
      await buildRelease({
        platform,
        target,
        environment: {
          TAURI_SIGNING_PRIVATE_KEY: 'fixture',
          APPLE_CERTIFICATE: '',
          APPLE_ID: '',
          APPLE_SIGNING_IDENTITY: '-',
        },
        run: async (args, { env }) => {
          calls.push(args)
          assert.equal(env.APPLE_CERTIFICATE, undefined)
          assert.equal(env.APPLE_ID, undefined)
          assert.equal(env.APPLE_SIGNING_IDENTITY, '-')
          return { status: 0, output: '' }
        },
        log() {},
      }),
      0
    )
    assert.deepEqual(calls, [
      ['build', '--target', target, '--no-bundle', '--', '--locked'],
      ['bundle', '--target', target, '--bundles', bundles],
    ])
  }
})

test('each desktop system offers compatible shells and safely opens imported settings', () => {
  for (const [agent, platform, fallback, available] of [
    [
      'Windows NT 10.0',
      'windows',
      'powershell',
      ['powershell', 'cmd', 'git-bash'],
    ],
    [
      'Macintosh; Intel Mac OS X 10_15_7',
      'macos',
      'system',
      ['system', 'bash', 'zsh'],
    ],
    ['X11; Linux x86_64', 'linux', 'system', ['system', 'bash', 'zsh']],
  ]) {
    // 每个平台在独立进程初始化模块常量，避免 Node 的 data URL 模块缓存复用上一个系统。
    const script = `
      import assert from 'node:assert/strict';
      import { sourceLoader } from ${JSON.stringify(new URL('./helpers/source-module.mjs', import.meta.url).href)};
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(agent)} } });
      const load = sourceLoader();
      const system = await load('src/utils/platform.ts');
      const { LOCAL_SHELL_OPTIONS } = await load('src/constants/connection.ts');
      const { DEFAULT_SETTINGS } = await load('src/types/settings.ts');
      assert.equal(system.DESKTOP_PLATFORM, ${JSON.stringify(platform)});
      assert.equal(DEFAULT_SETTINGS.terminalShell, ${JSON.stringify(fallback)});
      const available = ${JSON.stringify(available)};
      assert.deepEqual(LOCAL_SHELL_OPTIONS.map(option => option.value), available);
      for (const shell of ['powershell', 'cmd', 'git-bash', 'system', 'bash', 'zsh', 'invalid'])
        assert.equal(system.normalizeLocalShell(shell), available.includes(shell) ? shell : ${JSON.stringify(fallback)});
    `
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'pipe',
    })
  }
})

test('Unix packaging preserves native artifacts and refuses missing signatures or mismatched targets', t => {
  for (const targetId of ['macos-x64', 'macos-arm64', 'linux-x64']) {
    const options = fixture(t)
    const root = resolve(options.input, '..')
    mkdirSync(join(root, 'src-tauri'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
    writeFileSync(
      join(root, 'src-tauri/tauri.conf.json'),
      JSON.stringify({ version })
    )
    writeFileSync(
      join(root, 'src-tauri/Cargo.toml'),
      `[package]\nname = "miraihub"\nversion = "${version}"\n`
    )
    writeFileSync(
      join(root, 'src-tauri/Cargo.lock'),
      `[[package]]\nname = "miraihub"\nversion = "${version}"\n`
    )
    const target = releaseTargets[targetId]
    const bundle = join(
      root,
      'src-tauri/target',
      target.triple,
      'release/bundle'
    )
    const paths =
      target.platform === 'macos'
        ? [
            `dmg/MiraiHub_${version}_${target.arch === 'x64' ? 'x64' : 'aarch64'}.dmg`,
            'macos/MiraiHub.app.tar.gz',
            'macos/MiraiHub.app.tar.gz.sig',
          ]
        : [
            `deb/MiraiHub_${version}_amd64.deb`,
            `appimage/MiraiHub_${version}_amd64.AppImage`,
            `appimage/MiraiHub_${version}_amd64.AppImage.sig`,
          ]
    for (const path of paths) {
      mkdirSync(resolve(bundle, path, '..'), { recursive: true })
      if (!path.endsWith('.sig'))
        writeFileSync(join(bundle, path), `native artifact ${path}`)
    }
    const parameters = { root, tag, commit, targetId, triple: target.triple }
    assert.throws(() => packageUnix(parameters), /Missing build output/)
    writeFileSync(join(bundle, paths.at(-1)), 'c2lnbmF0dXJl')
    assert.throws(
      () => packageUnix({ ...parameters, triple: 'wrong-architecture' }),
      /Rust target/
    )
    const output = packageUnix(parameters)
    assert.ok(
      readdirSync(output).includes(
        assetName(target, target.updateFile, version) + '.sig'
      )
    )
    assert.deepEqual(
      readFileSync(
        join(output, assetName(target, target.downloads[0], version))
      ),
      readFileSync(join(bundle, paths[0]))
    )
    assert.equal(
      JSON.parse(readFileSync(join(output, 'version.json'), 'utf8')).arch,
      target.arch
    )
  }
})

test('Windows build uploads the package directory under the name expected by release assembly', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  )
  const windows = workflow.slice(
    workflow.indexOf('  build-windows:'),
    workflow.indexOf('  build-unix:')
  )
  const upload = windows.slice(
    windows.indexOf('      - name: Upload release files')
  )
  assert.match(upload, /name: windows-x64-release/)
  assert.match(upload, /path: release-output\/\*/)
  assert.doesNotMatch(upload, /pattern:|release-input/)
})

test('Tauri manifest validation sees the configured macOS feature in the common dependency', () => {
  const manifest = readFileSync(
    new URL('../src-tauri/Cargo.toml', import.meta.url),
    'utf8'
  )
  const common =
    manifest.split(/^\[dependencies\]\s*$/m)[1]?.split(/^\[/m)[0] ?? ''
  const features =
    common.match(/^tauri\s*=.*features\s*=\s*\[([^\]]+)\]/m)?.[1] ?? ''
  const base = JSON.parse(
    readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8'
    )
  )
  for (const name of ['windows', 'macos', 'linux']) {
    const config =
      name === 'windows'
        ? {}
        : JSON.parse(
            readFileSync(
              new URL(`../src-tauri/tauri.${name}.conf.json`, import.meta.url),
              'utf8'
            )
          )
    const enabled =
      config.app?.macOSPrivateApi ?? base.app.macOSPrivateApi ?? false
    assert.equal(
      features.includes('"macos-private-api"'),
      enabled,
      `${name}: Tauri CLI and cargo test must see matching features`
    )
  }
})
