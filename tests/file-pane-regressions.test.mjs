import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, shallowRef } from 'vue'
import { sourceLoader } from './helpers/source-module.mjs'
const load = sourceLoader()
const { fileIcon } = await load('src/constants/files.ts')
const { databaseInputType, dateInputValue, databaseDateValue } = await load(
  'src/utils/database-value.ts'
)
const { useFilePaneDrag } = await load(
  'src/components/workspace/useFilePaneDrag.ts'
)

test('文件图标按格式区分，大小写、点文件、目录和快捷方式有对应图标', () => {
  const formats = [
    'report.DOCX',
    'data.xlsx',
    'slides.pptx',
    'manual.pdf',
    'photo.png',
    'track.flac',
    'movie.mp4',
    'source.ts',
    'index.js',
    'App.vue',
    'backup.zip',
  ]
  assert.equal(
    new Set(formats.map(name => fileIcon(name).icon)).size,
    formats.length
  )
  assert.match(fileIcon('.env.local').icon, /config/)
  assert.match(fileIcon('.gitignore').icon, /git/)
  assert.match(fileIcon('Dockerfile').icon, /docker/)
  assert.match(fileIcon('VS Code.lnk').icon, /symlink/)
  assert.match(fileIcon('unknown.xyz').icon, /default-file/)
  assert.match(fileIcon('photos', 'directory').icon, /folder/)
})

test('日期输入保留本地时间，不转换时区或把 NULL 打开动作变成空值写入', () => {
  assert.equal(databaseInputType('date'), 'date')
  assert.equal(databaseInputType('DATETIME(6)'), 'datetime-local')
  assert.equal(
    databaseInputType('timestamp without time zone'),
    'datetime-local'
  )
  assert.equal(databaseInputType('timestamp with time zone'), 'text')
  assert.equal(
    databaseInputType('datetime(6)', '2026-11-06 09:30:45.123456'),
    'text'
  )
  assert.equal(databaseInputType('date', '0000-00-00'), 'text')
  assert.equal(databaseInputType('time', '120:30:00'), 'text')
  assert.equal(
    dateInputValue('2026-11-06 09:30:45.123', 'datetime-local'),
    '2026-11-06T09:30:45.123'
  )
  assert.equal(
    databaseDateValue('2026-11-06T09:30', 'datetime-local'),
    '2026-11-06 09:30:00'
  )
  assert.equal(databaseDateValue('', 'date'), '')
})

test('跨栏拖拽保留整组选择，只允许同会话的另一侧接收，取消后不传输', t => {
  const previousDocument = globalThis.document
  const target = new EventTarget()
  target.dataset = {
    fileSessionId: 'session',
    fileDropTarget: 'remote',
    fileDirectory: '/srv',
  }
  target.setAttribute = () => {}
  target.removeAttribute = () => {}
  globalThis.document = { elementFromPoint: () => ({ closest: () => target }) }
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  })
  const files = ['a', 'b', 'c'].map(name => ({
    name,
    path: `C:/Desktop/${name}`,
    kind: 'file',
  }))
  let selection = files.slice(0, 2).map(file => file.path)
  const container = shallowRef({
    focus() {},
    setPointerCapture() {},
    hasPointerCapture: () => false,
  })
  let drag
  const scope = effectScope()
  scope.run(() => {
    drag = useFilePaneDrag({
      source: () => 'local',
      sessionId: () => 'session',
      files: () => files,
      selection: () => selection,
      container,
      select: index => {
        selection = [files[index].path]
      },
    })
  })
  t.after(() => scope.stop())
  const event = (index, x = 10) => ({
    button: 0,
    buttons: 1,
    pointerId: 1,
    clientX: x,
    clientY: 20,
    target: {
      closest: () => ({ closest: () => ({ dataset: { fileIndex: index } }) }),
    },
    preventDefault() {},
  })
  const received = []
  target.addEventListener('mirai-file-drop', event =>
    received.push(event.detail)
  )
  assert.equal(drag.start(event(0)), true)
  assert.equal(selection.length, 2)
  drag.move(event(0, 100))
  drag.finish(event(0, 100))
  assert.equal(received.length, 1)
  assert.deepEqual(
    received[0].files.map(file => file.name),
    ['a', 'b']
  )
  assert.equal(received[0].directory, '/srv')
  target.dataset.fileSessionId = 'other-session'
  drag.start(event(0))
  drag.move(event(0, 100))
  drag.finish(event(0, 100))
  assert.equal(received.length, 1)
  target.dataset.fileSessionId = 'session'
  drag.start(event(0))
  drag.move(event(0, 100))
  drag.cancel()
  drag.finish(event(0, 100))
  assert.equal(received.length, 1)
})
