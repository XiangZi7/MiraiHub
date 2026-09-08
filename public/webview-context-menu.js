// 仅在桌面客户端禁用 WebView 默认菜单；浏览器预览保留原生右键。
if ('__TAURI_INTERNALS__' in window) {
  window.addEventListener(
    'contextmenu',
    event => event.preventDefault(),
    // 捕获阶段覆盖空白区域及停止冒泡的组件，不阻止自定义菜单接收事件。
    { capture: true }
  )
}
