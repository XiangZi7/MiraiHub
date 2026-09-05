import mainCss from '@/assets/styles/main.css?raw'
import { skinBackground, skinCss } from './skin-runtime'
import {
  normalizeSkinSettings,
  resolveSkinSettings,
  type SkinSettings,
} from './skin'

// Use the app's actual tokens, so preview and workspace stay in sync.
const tokens = mainCss.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const previewCss = `
*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}
body{font:12px 'Segoe UI','Microsoft YaHei',sans-serif;color:var(--color-txt);background:var(--color-canvas)}
.win{height:100%;position:relative;isolation:isolate;background:var(--color-window)}
.wallpaper{position:absolute;inset:0;z-index:-1;background-position:center;background-size:cover;background-repeat:no-repeat}
.wallpaper:after{content:'';position:absolute;inset:0;background:var(--skin-wallpaper-wash,#10101766)}
.win-bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid var(--color-line)}
.brand{height:17px;width:17px;border-radius:5px;background:linear-gradient(135deg,var(--color-blue),var(--color-pink));display:inline-grid;place-items:center;color:white;font-size:10px;font-weight:600}
.spacer{flex:1}.muted{color:var(--color-txt-3)}.dot{width:5px;height:5px;background:var(--color-success);border-radius:50%;display:inline-block}
.layout{display:flex;height:calc(100% - 38px)}.app-sidebar{width:174px;flex-shrink:0;background:var(--color-panel);border-right:1px solid var(--color-line);padding:12px 10px}
.tools{display:flex;gap:14px;margin:0 6px 20px}.label{font-size:9px;color:var(--color-txt-4);letter-spacing:1px;margin:16px 10px 6px}
.nav-item{padding:7px 10px;display:flex;gap:9px;align-items:center;color:var(--color-txt-2);border-radius:5px}.nav-item-active{background:var(--color-raised);color:var(--color-accent)}
.main{min-width:0;flex:1}.tabs{display:flex;height:36px;border-bottom:1px solid var(--color-line);padding:0 10px;gap:15px;align-items:center}
.tab{height:36px;display:flex;align-items:center;gap:7px;color:var(--color-accent);border-bottom:2px solid var(--color-accent);padding:0 12px}
.content{display:flex;height:calc(100% - 36px);padding:10px;gap:10px}.pane{background:var(--color-pane);border:1px solid var(--color-line);border-radius:9px;overflow:hidden;flex:1}
.objects{width:172px;flex:none}.pane-title{height:34px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--color-line);color:var(--color-accent)}
.search{padding:8px;margin:10px;background:var(--color-card);border-radius:5px;font-size:10px;color:var(--color-txt-3)}
.sql{padding:18px 14px;height:137px;font:12px/1.8 Consolas,monospace;background:var(--color-terminal);color:var(--color-term-fg)}
.sql em{font-style:normal;color:var(--color-accent)}.sql span{color:var(--color-txt-4);display:inline-block;width:24px}
.result-title{padding:9px 14px;color:var(--color-txt-3);border-top:1px solid var(--color-line)}
table{width:100%;border-collapse:collapse;text-align:left;font-size:11px}td,th{font-weight:400;border:1px solid var(--color-line-soft);padding:7px 12px}th{background:var(--color-card);color:var(--color-txt-3)}
.status{display:flex;justify-content:space-between;border-top:1px solid var(--color-line);padding:8px 12px;color:var(--color-txt-3);font-size:10px}
`

export function skinPreviewDocument(values: SkinSettings): string {
  const settings = resolveSkinSettings(normalizeSkinSettings(values))
  const image = skinBackground(settings)
  const css = `:root {${tokens}}\n${previewCss}\n${skinCss(settings)}\n.wallpaper{background-image:${image ? `url(${JSON.stringify(image)})` : 'none'};opacity:${Number(settings.skinBackgroundOpacity) / 100};filter:blur(${Number(settings.skinBackgroundBlur)}px);inset:-${Number(settings.skinBackgroundBlur) * 2}px;background-size:${settings.skinBackgroundFit};background-position:${settings.skinBackgroundPosition}}`
  // CSS is text, never markup; the sandbox also disallows scripts/navigation.
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark light"><style>${css.replace(/</g, '\\3c ')}</style></head><body>
<section class="win"><div class="wallpaper"></div><header class="win-bar"><span class="brand">M</span><span>MiraiHub</span><span class="spacer"></span><span class="muted">‹　↗　−　□　×</span></header>
<div class="layout"><aside class="app-sidebar"><div class="tools muted">◫　⊞ <span class="spacer"></span>«</div><div class="label">WORKSPACE</div><div class="nav-item">▤　Servers</div><div class="nav-item nav-item-active">▥　Databases</div><div class="nav-item">♧　SSH Keys</div><div class="nav-item">◷　Recent</div><div class="label">DATABASES</div><div class="nav-item">⌄　Development</div><div class="nav-item nav-item-active"><span class="dot"></span>　Localhost</div></aside>
<main class="main"><div class="tabs"><div class="tab"><span class="dot"></span>Localhost　×</div><span class="muted">+</span><span class="spacer"></span><span class="muted">♧　⊙　⚙</span></div><div class="content">
<section class="pane objects"><div class="pane-title">▥　Localhost <span class="spacer"></span>＋　⟳</div><div class="search">⌕　搜索数据库、表、视图</div><div class="nav-item">⌄　▱　miraihub</div><div class="nav-item">　⌄　Tables　<span class="muted">3</span></div><div class="nav-item nav-item-active">　　　▦　connections</div><div class="nav-item">　　　▦　projects</div><div class="nav-item">　　　▦　settings</div></section>
<section class="pane"><div class="tabs"><div class="tab">Query 1</div><span class="muted">Query 2　＋</span></div><div class="pane-title">▷　运行 <span class="muted">　⟳　◇</span></div><div class="sql"><div><span>1</span><em>SELECT</em> name, host, status</div><div><span>2</span><em>FROM</em> connections</div><div><span>3</span><em>WHERE</em> status = <em>'connected'</em>;</div></div><div class="result-title">结果　<span class="muted">3 rows · 0.012 s</span></div><table><thead><tr><th>name</th><th>host</th><th>status</th></tr></thead><tbody><tr><td>Localhost</td><td>127.0.0.1</td><td>connected</td></tr><tr><td>Development</td><td>192.168.1.10</td><td>connected</td></tr><tr><td>Staging</td><td>192.168.1.20</td><td>connected</td></tr></tbody></table><div class="status"><span><i class="dot"></i>　Connected</span><span>UTF-8</span></div></section>
</div></main></div></section></body></html>`
}
