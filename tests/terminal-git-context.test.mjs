import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const boundaryUrl = dataModule(`
  export const calls = []
  export const native = { exec: async () => ({ stdout: '', stderr: '', exitCode: 1 }) }
  export class Channel {}
  export async function invoke(command, args) { calls.push({ command, args }); return native.exec(args) }
`)
const { native, calls } = await import(boundaryUrl)
const load = sourceLoader({
  '@tauri-apps/api/core': boundaryUrl,
  '@tauri-apps/api/event': dataModule('export async function listen() {}'),
  '@/i18n': dataModule('export const i18n = { global: { t: value => value } }'),
  '@/utils/window': dataModule('export const IS_TAURI = true'),
  '@/api/connections': dataModule('export function get() {}'),
  '@/types/connection': dataModule(
    'export function isSshConnection() {} export function toSshConfig() {}'
  ),
})
const { readTerminalGitBranch } = await load('src/api/ssh.ts')
const bash =
  process.platform === 'win32'
    ? 'C:/Program Files/Git/bin/bash.exe'
    : '/bin/bash'

/** 将测试路径交给远端同类的 POSIX Shell；Windows Git Bash 使用盘符挂载路径。 */
function shellPath(path) {
  return path
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):/u, (_, drive) => `/${drive.toLowerCase()}`)
}

test(
  '普通 Bash 的 Git 查询使用真实仓库目录，支持上级仓库、特殊字符路径和分支切换',
  { skip: !existsSync(bash) },
  async t => {
    const root = resolve('terminal-check.local')
    mkdirSync(root, { recursive: true })
    const directory = mkdtempSync(join(root, 'terminal-git-'))
    t.after(() => {
      if (
        dirname(directory) === root &&
        basename(directory).startsWith('terminal-git-')
      )
        rmSync(directory, { recursive: true, force: true })
    })
    const repo = join(directory, "repo's $(echo unexpected)")
    execFileSync(
      'git',
      ['init', '--initial-branch=feature/terminal-v4', repo],
      { stdio: 'pipe' }
    )
    const nested = join(repo, 'web')
    mkdirSync(nested)
    native.exec = args => {
      assert.equal(args.sessionId, 'live-session')
      assert.equal(args.timeoutSecs, 5)
      try {
        return {
          stdout: execFileSync(
            bash,
            ['--noprofile', '--norc', '-c', args.command],
            {
              encoding: 'utf8',
              env: {
                ...process.env,
                HOME: shellPath(repo),
                GIT_CEILING_DIRECTORIES: shellPath(root),
              },
            }
          ),
          stderr: '',
          exitCode: 0,
        }
      } catch (error) {
        return {
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? '',
          exitCode: error.status,
        }
      }
    }
    assert.equal(
      await readTerminalGitBranch('live-session', shellPath(repo)),
      'feature/terminal-v4'
    )
    assert.equal(
      await readTerminalGitBranch('live-session', shellPath(nested)),
      'feature/terminal-v4'
    )
    assert.equal(
      await readTerminalGitBranch('live-session', '~/web'),
      'feature/terminal-v4'
    )
    execFileSync(
      'git',
      ['-C', repo, 'symbolic-ref', 'HEAD', 'refs/heads/fix/live-context'],
      { stdio: 'pipe' }
    )
    assert.equal(
      await readTerminalGitBranch('live-session', shellPath(nested)),
      'fix/live-context'
    )
    assert.equal(
      await readTerminalGitBranch('live-session', shellPath(directory)),
      ''
    )
    assert.ok(calls.every(call => call.command === 'ssh_exec'))
    assert.ok(calls.every(call => !call.args.command.includes('git status')))
  }
)

test('非 POSIX 提示符目录不执行远端命令，未提供成功结果时不伪造分支', async () => {
  calls.length = 0
  assert.equal(await readTerminalGitBranch('session', 'D:\\project'), '')
  assert.equal(calls.length, 0)
  native.exec = async () => ({
    stdout: '__MIRAI_GIT_NONE__\n',
    stderr: 'fatal: not a git repository',
    exitCode: 1,
  })
  assert.equal(await readTerminalGitBranch('session', '/not-a-repository'), '')
})

test('旧后端缺少 exit-status 时仍读取带明确标记的真实分支，忽略登录 banner', async () => {
  native.exec = async () => ({
    stdout: 'Welcome to server\n__MIRAI_GIT_BRANCH__:feature/real-ssh\n',
    stderr: '',
    exitCode: null,
  })
  assert.equal(
    await readTerminalGitBranch('session', '/repo'),
    'feature/real-ssh'
  )
  native.exec = async () => ({
    stdout: '',
    stderr: 'git: command not found',
    exitCode: null,
  })
  await assert.rejects(
    readTerminalGitBranch('session', '/repo'),
    /command not found/
  )
})
