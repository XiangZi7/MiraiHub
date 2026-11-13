import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'
const load = sourceLoader()
const {
  codeColorSpans,
  commandColorSpans,
  outputColorSpans,
  terminalSourcePath,
} = await load('src/utils/terminal-highlighting.ts')
const { codeLanguage } = await load('src/utils/code-language.ts')
test('命令名、参数、字符串、变量和管道不依赖服务端 ANSI', () => {
  const command = 'grep --color "--literal $HOME" file.txt | cat -n'
  const spans = commandColorSpans(command)
  const has = (text, color) =>
    spans.some(
      span =>
        command.slice(span.start, span.end) === text && span.color === color
    )
  assert.ok(has('grep', 'blue'))
  assert.ok(has('--color', 'yellow'))
  assert.ok(has('cat', 'blue'))
  assert.ok(has('-n', 'yellow'))
  assert.ok(has('|', 'magenta'))
  assert.ok(spans.some(span => span.color === 'green'))
  assert.ok(!has('--literal', 'yellow'))
  assert.ok(commandColorSpans('echo $HOME').some(span => span.color === 'cyan'))
})
test('cat 源码与编辑器共用语言解析，JSON 键值与脚本关键字具有不同颜色', () => {
  assert.equal(terminalSourcePath('cat package.json'), 'package.json')
  assert.equal(terminalSourcePath('cat "my file.ts"'), 'my file.ts')
  assert.equal(terminalSourcePath('ls package.json'), undefined)
  assert.equal(terminalSourcePath('cat plain.log'), undefined)
  const code = '{"enabled": true, "message": "hello", "count": 3}'
  const spans = codeColorSpans(code, 'package.json')
  assert.ok(
    spans.some(
      span =>
        span.color === 'blue' &&
        code.slice(span.start, span.end).includes('enabled')
    )
  )
  assert.ok(
    spans.some(
      span =>
        span.color === 'green' &&
        code.slice(span.start, span.end).includes('hello')
    )
  )
  assert.ok(spans.some(span => span.color === 'yellow'))
  assert.ok(
    codeColorSpans('const answer = 42', 'main.ts').some(
      span => span.color === 'magenta'
    )
  )
  assert.equal(codeLanguage('main.vue').label, 'Vue')
  assert.equal(codeLanguage('nginx.conf').label, 'Nginx')
  assert.equal(codeLanguage('sysctl.conf').label, '纯文本')
})

test('Nginx 站点文件按完整目录识别，同名的普通配置不污染语言缓存', () => {
  const file = 'hub.yxcr.top.conf'
  assert.equal(codeLanguage('/etc/sysctl.d/' + file).label, '纯文本')
  assert.equal(codeLanguage('/etc/nginx/conf.d/' + file).label, 'Nginx')
  assert.equal(codeLanguage('/tmp/' + file).label, '纯文本')
  assert.equal(codeLanguage('/usr/local/nginx/conf/' + file).label, 'Nginx')
  assert.equal(codeLanguage('C:\\nginx\\conf.d\\' + file).label, 'Nginx')
  assert.equal(codeLanguage('/etc/nginx/sites-enabled/hub.yxcr.top').label, 'Nginx')
  assert.equal(codeLanguage('/etc/conf.d/' + file).label, '纯文本')
  const source = 'server {\n  listen 443 ssl;\n  server_name hub.yxcr.top;\n}'
  assert.ok(codeColorSpans(source, '/etc/nginx/conf.d/' + file).length > 2)
})

test('终端查看相对路径配置时沿用提示符中的实际工作目录识别语言', () => {
  assert.equal(
    terminalSourcePath('cat hub.yxcr.top.conf', '/etc/nginx/conf.d'),
    '/etc/nginx/conf.d/hub.yxcr.top.conf'
  )
  assert.equal(
    terminalSourcePath('cat /etc/nginx/conf.d/hub.yxcr.top.conf', '/tmp'),
    '/etc/nginx/conf.d/hub.yxcr.top.conf'
  )
  assert.equal(terminalSourcePath('cat sysctl.conf', '/etc'), undefined)
})
test('无色成功结果、目录、可执行文件和软链按实际类型配色', () => {
  assert.equal(outputColorSpans('Already up to date.')[0].color, 'green')
  assert.equal(
    outputColorSpans('bash: ./deploy.sh: Permission denied')[0].color,
    'red'
  )
  const files = [
    { name: 'web', kind: 'directory', permissions: 'rwxr-xr-x' },
    { name: 'run.sh', kind: 'file', permissions: 'rwxr-xr-x' },
    { name: 'current', kind: 'symlink', permissions: 'rwxrwxrwx' },
  ]
  const text = 'web  run.sh  current'
  const spans = outputColorSpans(text, files)
  assert.ok(
    spans.some(
      span =>
        span.color === 'blue' && text.slice(span.start, span.end) === 'web'
    )
  )
  assert.ok(
    spans.some(
      span =>
        span.color === 'green' && text.slice(span.start, span.end) === 'run.sh'
    )
  )
  assert.ok(
    spans.some(
      span =>
        span.color === 'cyan' && text.slice(span.start, span.end) === 'current'
    )
  )
  assert.equal(outputColorSpans('web run.sh', []).length, 0)
})
