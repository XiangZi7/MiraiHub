import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'
const load = sourceLoader()
const { shellCompletionToken, filterShellSuggestions, shellSuggestionInput } =
  await load('src/utils/shell-completion.ts')
const {
  cleanFilePath,
  resolveFilePath,
  filePathCompletionContext,
  filePathKey,
} = await load('src/utils/file-path.ts')
const item = (value, kind = 'directory') => ({
  value,
  kind,
  label: value,
  description: '',
})

test('shell token 保留单双引号与反斜杠的完整替换范围，按 POSIX 规则解码', () => {
  for (const [line, raw, value] of [
    ['cd /var/a\\ b', '/var/a\\ b', '/var/a b'],
    ['cd "/var/a b', '"/var/a b', '/var/a b'],
    ["cd '/var/a b'", "'/var/a b'", '/var/a b'],
    ["cd 'O'\\''Brien'", "'O'\\''Brien'", "O'Brien"],
    ['cd "a\\q"', '"a\\q"', 'a\\q'],
    ['cd "a\\$b"', '"a\\$b"', 'a$b'],
    ['cd a\\', 'a\\', 'a'],
  ]) {
    const token = shellCompletionToken(line)
    assert.equal(token.raw, raw, line)
    assert.equal(token.value, value, line)
    assert.equal(line.slice(token.start), raw, line)
    assert.equal(token.commandPosition, false, line)
  }
  assert.equal(shellCompletionToken('~/path').home, true)
  assert.equal(shellCompletionToken("'~/path'").home, false)
  assert.equal(shellCompletionToken('\\~/path').home, false)
})

test('命令分隔符和重定向保留正确参数位置，空整行和不支持的求值不查询', () => {
  assert.equal(shellCompletionToken('ls | gre').commandPosition, true)
  assert.equal(shellCompletionToken('pwd && do').commandPosition, true)
  assert.equal(shellCompletionToken('echo > /va').commandPosition, false)
  assert.equal(shellCompletionToken('ls ').value, '')
  assert.equal(shellCompletionToken('ls ').start, 3)
  for (const line of [
    '',
    '  ',
    'ls | ',
    'echo $HOME/fo',
    'cd $(pwd)/x',
    'cd ~other/x',
    'echo *.txt',
    'cat # comment',
  ])
    assert.equal(shellCompletionToken(line), undefined, line)
  assert.equal(shellCompletionToken("cat '$HOME/file'").value, '$HOME/file')
})

test('SSH 候选按解码后的路径匹配，接受时正确替换引用和大小写而不自动执行', () => {
  assert.equal(shellSuggestionInput('cd /var/lo', item('/var/log/')), 'g/')
  const line = 'cd "/srv/My F'
  const raw = shellCompletionToken(line).raw
  assert.equal(
    shellSuggestionInput(line, item("'/srv/My Folder/'")),
    '\x7f'.repeat([...raw].length) + "'/srv/My Folder/'"
  )
  assert.equal(shellSuggestionInput('doc', item('docker', 'command')), 'ker ')
  assert.equal(
    shellSuggestionInput('cd /var/LO', item('/var/log/')),
    '\x7f'.repeat('/var/LO'.length) + '/var/log/'
  )
  assert.equal(
    filterShellSuggestions(
      [item("'/srv/My Folder/'"), item('/srv/other/')],
      shellCompletionToken('cd /srv/My\\ F')
    ).length,
    1
  )
  for (const value of ['echo;top', 'top\nwhoami', 'top\x1b[A', 'top other']) {
    assert.equal(shellSuggestionInput('to', item(value)), undefined, value)
    assert.equal(
      filterShellSuggestions([item(value)], shellCompletionToken('to')).length,
      0,
      value
    )
  }
})

test('文件地址按实际父目录查询，不把当前目录项拼到其他路径上', () => {
  assert.deepEqual(filePathCompletionContext('/var/lo', '/root'), {
    directory: '/var/',
    prefix: 'lo',
  })
  assert.deepEqual(filePathCompletionContext('src/co', '/srv/app'), {
    directory: '/srv/app/src/',
    prefix: 'co',
  })
  assert.deepEqual(
    filePathCompletionContext('/srv/app', '/srv/app', false, true),
    { directory: '/srv/app', prefix: '' }
  )
  assert.equal(
    resolveFilePath('../logs', '/srv/link'),
    '/srv/link/../logs',
    '符号链接的 .. 必须由原生文件系统解析'
  )
  assert.equal(resolveFilePath('~/logs', '/root'), '~/logs')
  assert.equal(resolveFilePath('logs', '/'), '/logs')
})

test('本地地址支持盘符、UNC、根相对地址和复制为路径的引号及 file URL', () => {
  assert.equal(resolveFilePath('D:', 'C:\\Users\\admin', true), 'D:\\')
  assert.equal(resolveFilePath('\\logs', 'D:\\work', true), 'D:\\logs')
  assert.equal(
    resolveFilePath('../logs', 'D:\\work', true),
    'D:\\work\\../logs'
  )
  assert.equal(
    resolveFilePath('\\\\server\\share\\dir', 'D:\\work', true),
    '\\\\server\\share\\dir'
  )
  assert.equal(
    resolveFilePath('\\logs', '\\\\server\\share\\work', true),
    '\\\\server\\share\\logs'
  )
  assert.equal(
    resolveFilePath('/logs', '//server/share/work', true),
    '//server/share/logs'
  )
  assert.equal(cleanFilePath('"D:\\My Folder"', true), 'D:\\My Folder')
  assert.equal(cleanFilePath('file:///D:/My%20Folder', true), 'D:/My Folder')
  assert.equal(
    cleanFilePath('file://server/share/My%20Folder', true),
    '//server/share/My Folder'
  )
  assert.deepEqual(
    filePathCompletionContext('D:\\other\\fo', 'C:\\work', true),
    { directory: 'D:\\other\\', prefix: 'fo' }
  )
  assert.deepEqual(filePathCompletionContext('D:', 'C:\\work', true), {
    directory: 'D:\\',
    prefix: '',
  })
  assert.equal(
    filePathKey('D:\\My Folder\\', true),
    filePathKey('d:/my folder', true)
  )
  assert.notEqual(filePathKey('/srv/Folder'), filePathKey('/srv/folder'))
})
