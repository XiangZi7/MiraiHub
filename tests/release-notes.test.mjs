import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { generateReleaseNotes } from '../scripts/release-notes.mjs'

// 在隔离仓库中执行真实 Git 命令，验证日志范围与提交内容，而非模拟 Git 输出。
function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

// 为日志测试创建独立历史，清理时只删除已确认属于临时目录的测试仓库。
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'miraihub-release-notes-'))
  t.after(() => {
    assert.match(
      relative(resolve(tmpdir()), resolve(root)),
      /^miraihub-release-notes-[^/\\]+$/
    )
    rmSync(root, { recursive: true, force: true })
  })
  git(root, '-c', 'init.templateDir=', 'init', '--initial-branch=master')
  git(root, 'config', 'user.name', 'Release Test')
  git(root, 'config', 'user.email', 'release@example.test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'tag.gpgsign', 'false')
  git(root, 'config', 'core.hooksPath', join(root, 'no-hooks'))
  return root
}

// 新建空提交并返回真实哈希，供日志内容、正文和链接断言使用。
function commit(root, subject, body) {
  git(
    root,
    'commit',
    '--allow-empty',
    '-m',
    subject,
    ...(body ? ['-m', body] : [])
  )
  return git(root, 'rev-parse', 'HEAD')
}

// 使用默认正式版生成说明；个别场景可覆盖目标版本和已发布版本列表。
function notes(root, options = {}) {
  return generateReleaseNotes(root, {
    tag: 'v1.0.1',
    repository: 'XiangZi7/MiraiHub',
    releases: [{ tag_name: 'v1.0.0', draft: false, prerelease: false }],
    ...options,
  })
}

test('release notes show direct commits, emoji categories, bodies and links without version noise', t => {
  const root = fixture(t)
  commit(root, 'feat: 已发布的旧功能')
  git(root, 'tag', '-a', 'v1.0.0', '-m', 'Previous release')
  const feature = commit(
    root,
    '✨ feat(ssh): 新增 SSH 配置导入',
    '- 支持导入配置\n- 保留原有连接'
  )
  const fix = commit(root, '🐛 fix(database): 修复查询错误')
  commit(
    root,
    '♻️ refactor(useXterm): 优化终端渲染',
    '浅色主题使用 DOM，深色主题保留 WebGL。'
  )
  commit(root, '📝 docs: 补充使用说明')
  commit(root, '🔧 ci: 优化构建缓存')
  commit(root, 'chore(release): v1.0.1')
  git(root, 'tag', 'v1.0.1')

  const body = notes(root)
  assert.match(body, /共 5 项提交更新/)
  assert.match(body, /### ✨ 新增功能\n\n- ssh：新增 SSH 配置导入/)
  assert.ok(
    body.includes(
      `[\`${feature.slice(0, 7)}\`](https://github.com/XiangZi7/MiraiHub/commit/${feature})`
    )
  )
  assert.match(body, /\n  - 支持导入配置\n  - 保留原有连接/)
  assert.match(body, /### 🐛 问题修复\n\n- database：修复查询错误/)
  assert.ok(body.includes(`/commit/${fix}`))
  assert.match(body, /### ⚡ 优化改进\n\n- useXterm：优化终端渲染/)
  assert.match(body, /浅色主题使用 DOM，深色主题保留 WebGL/)
  assert.match(body, /### 📝 文档更新/)
  assert.match(body, /### 🔧 构建与维护/)
  assert.match(body, /## 下载与安装/)
  assert.match(body, /Full Changelog.*\/compare\/v1\.0\.0\.\.\.v1\.0\.1/)
  assert.doesNotMatch(body, /已发布的旧功能|chore\(release\)|### 📦 其他更新/)
})

test('failed tags, drafts, prereleases and unrelated branches cannot hide stable release changes', t => {
  const root = fixture(t)
  commit(root, 'feat: 初始版本')
  git(root, 'tag', 'v1.0.0')
  git(root, 'branch', 'other-release')
  commit(root, 'fix: 上次构建失败尚未发布的修复')
  git(root, 'tag', 'v1.0.1')
  commit(root, 'feat: 草稿尚未发布的功能')
  git(root, 'tag', 'v1.0.2')
  commit(root, 'perf: 预发布中的优化')
  git(root, 'tag', 'v1.0.3-beta.1')
  commit(root, 'fix: 本次修复')
  git(root, 'tag', 'v1.0.3')
  git(root, 'switch', 'other-release')
  commit(root, 'feat: 其他分支功能')
  git(root, 'tag', 'v9.0.0')

  const body = notes(root, {
    tag: 'v1.0.3',
    releases: [
      { tag_name: 'v1.0.0', draft: false, prerelease: false },
      { tag_name: 'v1.0.2', draft: true, prerelease: false },
      { tag_name: 'v1.0.3-beta.1', draft: false, prerelease: true },
      { tag_name: 'v9.0.0', draft: false, prerelease: false },
    ],
  })
  assert.match(body, /自 v1\.0\.0 以来，共 4 项提交更新/)
  assert.match(body, /上次构建失败尚未发布的修复/)
  assert.match(body, /草稿尚未发布的功能/)
  assert.match(body, /预发布中的优化/)
  assert.doesNotMatch(body, /初始版本|其他分支功能/)
})

test('prereleases compare against the previous published preview', t => {
  const root = fixture(t)
  commit(root, 'feat: 正式版功能')
  git(root, 'tag', 'v1.0.0')
  commit(root, 'feat: 第一轮预览功能')
  git(root, 'tag', 'v1.1.0-beta.1')
  commit(root, 'fix: 第二轮预览修复')
  git(root, 'tag', 'v1.1.0-beta.2')
  const body = notes(root, {
    tag: 'v1.1.0-beta.2',
    releases: [
      { tag_name: 'v1.0.0', draft: false, prerelease: false },
      { tag_name: 'v1.1.0-beta.1', draft: false, prerelease: true },
      { tag_name: 'v1.1.0-beta.2', draft: true, prerelease: true },
    ],
  })
  assert.match(body, /自 v1\.1\.0-beta\.1 以来，共 1 项提交更新/)
  assert.match(body, /第二轮预览修复/)
  assert.doesNotMatch(body, /正式版功能|第一轮预览功能/)
})

test('first release includes plain commits, escaped titles and breaking changes', t => {
  const root = fixture(t)
  commit(root, '支持 [配置] <导入> 与 `预览`')
  commit(root, 'feat(api)!: 调整连接配置格式')
  git(root, 'tag', 'v1.0.1')
  const body = notes(root, { releases: [] })
  assert.match(body, /首次发布，共 2 项提交更新/)
  assert.match(body, /### 📦 其他更新/)
  assert.ok(body.includes('支持 \\[配置\\] \\<导入\\> 与 \\`预览\\`'))
  assert.match(body, /\*\*破坏性变更：\*\* api：调整连接配置格式/)
  assert.match(body, /完整提交记录.*\/commits\/v1\.0\.1/)
  assert.doesNotMatch(body, /\/compare\//)
})

test('merge commits and automated version bumps do not become update entries', t => {
  const root = fixture(t)
  commit(root, 'feat: 初始功能')
  git(root, 'tag', 'v1.0.0')
  git(root, 'switch', '-c', 'feature')
  commit(root, 'feat: 分支上的功能')
  git(root, 'switch', 'master')
  git(root, 'merge', '--no-ff', 'feature', '-m', 'Merge feature branch')
  commit(root, 'chore(release): v1.0.1')
  git(root, 'tag', 'v1.0.1')
  const body = notes(root)
  assert.match(body, /共 1 项提交更新/)
  assert.match(body, /分支上的功能/)
  assert.doesNotMatch(body, /Merge feature branch|release：/)
})

test('version-only releases state that there are no new feature or fix commits', t => {
  const root = fixture(t)
  commit(root, 'feat: 初始功能')
  git(root, 'tag', 'v1.0.0')
  commit(root, 'chore(release): v1.0.1')
  git(root, 'tag', 'v1.0.1')
  assert.match(notes(root), /本版本没有新的功能或修复提交/)
})

test('shallow history fails instead of silently publishing incomplete release notes', t => {
  const root = fixture(t)
  commit(root, 'feat: 初始功能')
  commit(root, 'fix: 后续修复')
  git(root, 'tag', 'v1.0.1')
  const shallow = join(root, 'shallow')
  git(
    root,
    'clone',
    '--depth=1',
    '--no-local',
    '--branch',
    'v1.0.1',
    root,
    shallow
  )
  assert.throws(() => notes(shallow), /需要完整 Git 历史/)
})
