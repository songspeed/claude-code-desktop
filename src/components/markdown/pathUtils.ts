/**
 * 正文路径引用解析：`路径:行号`（如 src/main.ts:12）的识别与解析工具。
 * 纯函数模块，可独立单测；渲染层负责文件存在性与打开动作。
 */

/** 常见源码/配置文件扩展名；用于「无分隔符片段是否形如代码路径」的判定。 */
export const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'kt', 'kts', 'c', 'cc', 'cpp', 'h', 'hh', 'hpp',
  'cs', 'php', 'rb', 'swift', 'scala', 'lua', 'pl', 'pm', 'r',
  'sh', 'zsh', 'bash', 'fish', 'ps1', 'bat', 'cmd',
  'yml', 'yaml', 'json', 'jsonc', 'md', 'markdown', 'txt', 'log', 'toml', 'ini',
  'cfg', 'conf', 'env', 'gitignore', 'gitattributes', 'npmrc', 'lock', 'sum',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte', 'jsx',
  'xml', 'sql', 'graphql', 'gql', 'proto', 'gradle', 'mk', 'cmake',
])

const SEPARATOR = /[\\/]/

/** 判定候选文本是否形如文件路径（含分隔符，或扩展名在代码扩展名白名单内）。 */
export function isPathLike(candidate: string): boolean {
  if (!candidate) return false
  if (SEPARATOR.test(candidate)) return true
  const dotIndex = candidate.lastIndexOf('.')
  if (dotIndex <= 0) return false
  return CODE_EXTENSIONS.has(candidate.slice(dotIndex + 1))
}

/**
 * 正文中 `路径:行号` 引用的匹配模式。
 * - 前边界：行首或空白/括号/引号（排除 `://` 之类 URL 结构）
 * - 路径：可选盘符（`C:`）+ 可选首个分隔符 + `[\w.@~-]` 字符，可含 `/` 或 `\`
 * - 行号：1~6 位数字，后随非数字边界
 */
export const FILE_REFERENCE_PATTERN = /(^|[\s([{'"`（【])((?:[A-Za-z]:)?(?!\/\/)[\\/]?[\w.@~-]+(?:[\\/][\w.@~-]+)*):(\d{1,6})(?![\d.])/g

/** 渲染层使用的伪协议前缀。 */
export const FILE_LINK_PROTOCOL = 'ccd-file://'

/** 由插件生成的链接 URL（path:line 均未编码，交由渲染层解析）。 */
export function encodeFileLink(path: string, line: number): string {
  return `${FILE_LINK_PROTOCOL}${encodeURIComponent(path)}:${line}`
}

/** 解析链接 URL，返回原始路径与行号；非 ccd-file:// 或格式错误返回 null。 */
export function parseFileLink(url: string): { path: string; line: number } | null {
  if (!url.startsWith(FILE_LINK_PROTOCOL)) return null
  const rest = url.slice(FILE_LINK_PROTOCOL.length)
  const separatorIndex = rest.lastIndexOf(':')
  if (separatorIndex <= 0) return null
  const encodedPath = rest.slice(0, separatorIndex)
  const lineText = rest.slice(separatorIndex + 1)
  if (!/^\d{1,6}$/.test(lineText)) return null
  let path: string
  try {
    path = decodeURIComponent(encodedPath)
  } catch {
    return null
  }
  return { path, line: Number(lineText) }
}

/** 相对路径拼接工作区根；绝对路径直接使用；无工作区返回 null。 */
export function resolveAbsolutePath(filePath: string, projectPath: string | null): string | null {
  if (!projectPath) return null
  if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')) return filePath
  return `${projectPath.replace(/[\\/]+$/, '')}/${filePath.replace(/^[\\/]+/, '')}`
}
