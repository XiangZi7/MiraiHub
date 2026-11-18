import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { codeLanguage } = await sourceLoader()('src/utils/code-language.ts')

test('编辑器按语言或纯文本打开文件', () => {
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
  assert.equal(
    codeLanguage('/etc/nginx/sites-enabled/hub.yxcr.top').label,
    'Nginx'
  )
  assert.equal(codeLanguage('/etc/conf.d/' + file).label, '纯文本')
})
