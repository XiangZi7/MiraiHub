import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'
// 表格虚拟滚动依赖动画帧，测试环境用定时器模拟。
globalThis.requestAnimationFrame ??= callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame ??= id => clearTimeout(id)
const vue = JSON.stringify(import.meta.resolve('vue'))
const api = dataModule(`
  export const mock={preview:null};
  const columns=[{name:'id',dataType:'int',autoIncrement:true,nullable:false},{name:'name',dataType:'varchar(100)',nullable:true},{name:'created_at',dataType:'datetime',nullable:true}];
  export const tableDetail=async()=>({schema:'demo',name:'items',kind:'table',columns,primaryKey:['id'],indexes:[],foreignKeys:[]});
  export const fetchRows=async()=>({columns,rows:[],offset:0,limit:100,hasMore:false});
  export const previewMutations=async(_id,request)=>{mock.preview=request;return ['INSERT INTO items ...']};
  export const errorMessage=String;
`)
const load = sourceLoader(
  {
    '@/api/database': api,
    '@/composables/useToast': dataModule(
      'export const toast={error(){},success(){}}'
    ),
    '@/components/workspace/database/database-value-input.vue': dataModule(
      `import {h} from ${vue}; export default {props:['modelValue','dataType'],emits:['update:modelValue'],setup:(p,{emit})=>()=>h('input',{'data-type':p.dataType,value:p.modelValue,onInput:value=>emit('update:modelValue',value)})}`
    ),
  },
  [
    'src/components/workspace/database/DatabaseTableView.vue',
    'src/components/ui/AppButton.vue',
  ]
)
const { i18n } = await load('src/i18n/index.ts')
const { default: Table } = await load(
  'src/components/workspace/database/DatabaseTableView.vue'
)
const { mock } = await import(api)
const node = (type, text = '') =>
  markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    querySelector: () => null,
  })
const renderer = createRenderer({
  createElement: node,
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (el, text) => {
    el.text = text
  },
  setElementText: (el, text) => {
    el.text = text
    el.children = []
  },
  patchProp: (el, key, _old, value) => {
    el.props[key] = value
  },
  parentNode: el => el.parent,
  nextSibling: () => null,
  insert(el, parent, anchor) {
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el)
  },
  remove(el) {
    el.parent?.children.splice(el.parent.children.indexOf(el), 1)
  },
})
const all = el => [el, ...el.children.flatMap(all)]
const text = el => el.text + el.children.map(text).join('')
const flush = async () => {
  for (let index = 0; index < 12; index++) await nextTick()
}
test('新增行第一次填写字段就启用提交，预览包含当前字段值，不需要额外新增行', async t => {
  i18n.global.locale.value = 'zh-CN'
  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(Table, {
        sessionId: 'demo',
        databaseKind: 'mysql',
        object: {
          schema: 'demo',
          name: 'items',
          kind: 'table',
          identity: 'demo.items',
        },
      }),
  })
  const errors = []
  app.config.errorHandler = error => errors.push(error)
  app.use(i18n).mount(root)
  t.after(() => {
    app.unmount()
    assert.deepEqual(errors, [])
  })
  await flush()
  const button = label =>
    all(root).find(
      el => el.type === 'button' && text(el).trim().startsWith(label)
    )
  assert.equal(button('提交').props.disabled, true)
  button('新增行').props.onClick()
  await flush()
  assert.equal(button('提交').props.disabled, true)
  const input = type =>
    all(root).find(el => el.type === 'input' && el.props['data-type'] === type)
  input('varchar(100)').props.onInput('First row')
  await flush()
  assert.equal(button('提交').props.disabled, false)
  assert.match(text(button('提交')), /\(1\)/)
  input('datetime').props.onInput('2026-11-06 09:30:00')
  await flush()
  button('提交').props.onClick()
  await flush()
  assert.deepEqual(mock.preview.mutations, [
    {
      type: 'insert',
      values: [
        { column: 'name', value: 'First row' },
        { column: 'created_at', value: '2026-11-06 09:30:00' },
      ],
    },
  ])
})
