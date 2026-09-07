import type { TerminalCommand } from '@/types/terminal-command'

export const DEFAULT_TERMINAL_COMMANDS: readonly TerminalCommand[] = [
  { id: 'list', name: '列出文件', command: 'ls -lah' },
  { id: 'pwd', name: '当前路径', command: 'pwd' },
  { id: 'disk', name: '磁盘空间', command: 'df -h' },
  { id: 'memory', name: '内存占用', command: 'free -h' },
  { id: 'directory', name: '目录大小', command: 'du -sh *' },
  { id: 'processes', name: '实时进程', command: 'top' },
  { id: 'uptime', name: '系统负载', command: 'uptime' },
  { id: 'ports', name: '监听端口', command: 'ss -tulnp' },
  { id: 'network', name: '网络地址', command: 'ip addr' },
  { id: 'system', name: '系统信息', command: 'uname -a' },
]
