/** ssh-files 相关文案。中文原文即消息 ID，zh-CN 目录自动按 en 的键生成同名条目。 */
export const en: Record<string, string> = {
  修改权限: 'Change permissions',
  修改权限失败: 'Failed to change permissions',
  '已修改 {count} 个项目的权限': 'Changed permissions of {count} item(s)',
  所有者: 'Owner',
  用户组: 'Group',
  其他用户: 'Others',
  '读取 (r)': 'Read (r)',
  '写入 (w)': 'Write (w)',
  '执行 (x)': 'Execute (x)',
  八进制权限: 'Octal mode',
  递归应用到子项: 'Apply recursively to children',
  '目录内所有文件和子目录都会设为相同权限，不跟随符号链接。':
    'All files and subdirectories inside will get the same mode. Symbolic links are not followed.',
  应用权限: 'Apply',
  '请输入 3 到 4 位八进制权限，例如 644 或 0755':
    'Enter a 3 or 4 digit octal mode, such as 644 or 0755',
  '确定删除目录“{value0}”吗？目录中的所有文件和子目录都会被递归删除，此操作无法撤销。':
    'Delete the directory "{value0}"? All files and subdirectories inside will be deleted recursively. This cannot be undone.',
  '确定删除选中的 {count} 个项目吗？其中的目录会连同全部内容递归删除，此操作无法撤销。':
    'Delete the {count} selected items? Directories will be deleted recursively with all their contents. This cannot be undone.',
  '远端文件已被修改。覆盖保存会丢弃远端的改动，重新加载会丢弃本地草稿。':
    'The remote file has been modified. Overwriting discards the remote changes; reloading discards your local draft.',
  覆盖保存: 'Overwrite',
  重新加载: 'Reload',
}
