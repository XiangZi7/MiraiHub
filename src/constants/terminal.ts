import type { ITheme } from '@xterm/xterm'
import type { TermSpan } from '@/types'

/**
 * xterm.js 配色。
 *
 * 值写成十六进制而不是引用 main.css 的 --color-term-* 变量：
 * xterm 把颜色取到 canvas 里做像素合成，只认能直接解析的具体色值，
 * 拿不到 CSS 变量，也不接受带透明度的 oklch。
 * 这里的色相与设计令牌保持一致，改令牌时需同步这份。
 *
 * background 用全透明：终端容器自身已铺了 bg-terminal（半透明底色，
 * 透出系统 acrylic），xterm 再涂一层不透明底会把这个效果盖掉。
 */
export const TERMINAL_THEME: ITheme = {
  background: '#00000000',
  foreground: '#dededf',
  cursor: '#7ee787',
  cursorAccent: '#0d0d10',
  selectionBackground: '#ffffff26',

  black: '#2a2a30',
  red: '#ff6b62',
  green: '#7ee787',
  yellow: '#ffcb6b',
  blue: '#7cb0ff',
  magenta: '#d9a3ff',
  cyan: '#84e0e8',
  white: '#cfcfd2',

  brightBlack: '#5b5b63',
  brightRed: '#ff8a7a',
  brightGreen: '#9df0a4',
  brightYellow: '#ffd98a',
  brightBlue: '#9cc4ff',
  brightMagenta: '#e6bcff',
  brightCyan: '#a6ecf2',
  brightWhite: '#f0f0f2',
}

/** 终端输出内容，每行由带语法色的片段组成 */
export const TERMINAL_LINES: TermSpan[][] = [
  [{ text: 'Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-104-generic x86_64)' }],
  [],
  [{ text: ' * Documentation:  ' }, { text: 'https://help.ubuntu.com', tone: 'blue' }],
  [{ text: ' * Management:     ' }, { text: 'https://landscape.canonical.com', tone: 'blue' }],
  [{ text: ' * Support:        ' }, { text: 'https://ubuntu.com/advantage', tone: 'blue' }],
  [],
  [{ text: 'Last login: Today at 09:41 AM from 192.168.1.10' }],
  [
    { text: 'user@production-server', tone: 'green' },
    { text: ':' },
    { text: '~', tone: 'blue' },
    { text: '$ ls -la' },
  ],
  [{ text: 'total 56' }],
  [{ text: 'drwxr-xr-x   7 user  user   4096 May 22 09:41 .' }],
  [{ text: 'drwxr-xr-x   3 root  root   4096 Apr 10  2023 ..' }],
  [{ text: '-rw-------   1 user  user    220 Apr 10  2023 .bash_logout' }],
  [{ text: '-rw-r--r--   1 user  user   3771 Apr 10  2023 .bashrc' }],
  [
    { text: 'drwx------   4 user  user   4096 May 22 09:40 ' },
    { text: '.cache', tone: 'cyan' },
  ],
  [
    { text: 'drwxrwxr-x   3 user  user   4096 May 21 18:30 ' },
    { text: 'project', tone: 'green' },
  ],
  [
    { text: 'drwxr-xr-x   2 user  user   4096 May 20 14:22 ' },
    { text: 'logs', tone: 'green' },
  ],
  [{ text: '-rw-r--r--   1 user  user    807 Apr 10  2023 .profile' }],
  [],
  [
    { text: 'user@production-server', tone: 'green' },
    { text: ':' },
    { text: '~', tone: 'blue' },
    { text: '$ ' },
  ],
]

/** 终端语法色 → Tailwind class */
export const TERM_TONE_CLASS: Record<NonNullable<TermSpan['tone']>, string> = {
  fg: 'text-term-fg',
  green: 'text-term-green',
  blue: 'text-term-blue',
  cyan: 'text-term-cyan',
  dim: 'text-term-dim',
}
