import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, shallowRef } from 'vue'
import { sourceLoader } from './helpers/source-module.mjs'
const load = sourceLoader()
const { fileIcon } = await load('src/constants/files.ts')
const { databaseInputType } = await load('src/utils/database-value.ts')
const { parseDateValue, formatDateValue, calendarDays, shiftMonth } =
  await load('src/utils/date-value.ts')
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
  assert.equal(fileIcon('.env.local').icon, 'lucide:file-cog')
  assert.match(fileIcon('.gitignore').icon, /git/)
  assert.equal(fileIcon('Dockerfile').icon, 'lucide:container')
  assert.match(fileIcon('VS Code.lnk').icon, /symlink/)
  assert.equal(fileIcon('unknown.xyz').icon, 'lucide:file')
  assert.match(fileIcon('photos', 'directory').icon, /folder/)
})

test('日期列按类型挂选择器，值按文本解析和拼回，保留小数秒与时区后缀', () => {
  assert.equal(databaseInputType('date'), 'date')
  assert.equal(databaseInputType('DATETIME(6)'), 'datetime')
  assert.equal(databaseInputType('timestamp(3) with time zone'), 'datetime')
  assert.equal(databaseInputType('time without time zone'), 'time')
  assert.equal(databaseInputType('varchar(32)'), 'text')

  const precise = parseDateValue('2026-11-06 09:30:45.123456+08', 'datetime')
  assert.deepEqual(
    [precise.year, precise.month, precise.day, precise.hour, precise.second],
    [2026, 11, 6, 9, 45]
  )
  assert.equal(
    formatDateValue({ ...precise, day: 7, hour: 0 }, 'datetime'),
    '2026-11-07 00:30:45.123456+08'
  )
  assert.equal(
    formatDateValue(parseDateValue('2026-11-06T09:30', 'datetime'), 'datetime'),
    '2026-11-06 09:30:00'
  )
  assert.equal(
    formatDateValue(
      parseDateValue('2026-11-06 09:30:45.1234567 +08:00', 'datetime'),
      'datetime'
    ),
    '2026-11-06 09:30:45.1234567 +08:00'
  )
  // 零日期、闰年外的 2 月 29 日、超过 24 小时的 TIME 都交给文本框原样保留。
  assert.equal(parseDateValue('0000-00-00', 'date'), null)
  assert.equal(parseDateValue('2025-02-29', 'date'), null)
  assert.equal(parseDateValue('120:30:00', 'time'), null)
  assert.equal(parseDateValue('', 'datetime'), null)
  assert.equal(
    formatDateValue(parseDateValue('0050-03-01', 'date'), 'date'),
    '0050-03-01'
  )

  const days = calendarDays(2026, 11, 1)
  assert.equal(days.length, 42)
  // 2026-11-01 是周日，周一开头时前面补 6 天十月。
  assert.deepEqual(days[6], { year: 2026, month: 11, day: 1, outside: false })
  assert.equal(days[0].outside, true)
  assert.deepEqual(calendarDays(2026, 11, 0)[0].day, 1)
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 })
  assert.deepEqual(shiftMonth(2026, 12, 12), { year: 2027, month: 12 })
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
