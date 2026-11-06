/** 提取片段中的唯一变量名，按首次出现顺序显示填写表单。 */
export function snippetVariables(command: string): string[] {
  return [...new Set([...command.matchAll(/\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu)].map(match => match[1]!))]
}

/** 替换所有变量；禁止控制字符，最终命令仍需在终端或批量预览中核对。 */
export function renderSnippet(command: string, values: Record<string, string>): string {
  return command.replace(/\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu, (_, name: string) => {
    const value = values[name]
    if (value === undefined || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid variable: ${name}`)
    return value
  })
}
