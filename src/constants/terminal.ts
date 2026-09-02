import type { TermSpan } from '@/types'

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
