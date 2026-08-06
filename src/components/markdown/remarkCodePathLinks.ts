/**
 * remarkCodePathLinks — mdast 插件
 * 将正文文本节点中的 `路径:行号` 引用替换为 ccd-file:// 链接节点。
 * 由渲染层（MarkdownContent 的 components.a）负责解析与打开。
 *
 * 注意：替换产生的 link 节点 children 不会被再次遍历（自写 DFS，
 * 仅对替换前的树结构访问一次），避免链接文本自匹配导致无限递归。
 */
import type { Root, Text } from 'mdast'
import type { Plugin } from 'unified'
import { FILE_REFERENCE_PATTERN, encodeFileLink, isPathLike } from './pathUtils'

type LinkNode = { type: 'link'; url: string; children: Text[] }

interface PendingReplacement {
  parent: unknown[]
  index: number
  replacement: Array<Text | LinkNode>
}

/** 把文本节点改写为「文本 + 链接」混合序列；无匹配时返回 null。 */
function splitIntoChildren(value: string): Array<Text | LinkNode> | null {
  FILE_REFERENCE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  let lastIndex = 0
  const children: Array<Text | LinkNode> = []

  while ((match = FILE_REFERENCE_PATTERN.exec(value)) !== null) {
    const prefix = match[1] ?? ''
    const candidate = match[2]!
    const lineText = match[3]!
    if (!isPathLike(candidate)) continue
    const start = match.index
    const end = match.index + match[0].length
    if (start > lastIndex) {
      children.push({ type: 'text', value: value.slice(lastIndex, start) })
    }
    if (prefix) children.push({ type: 'text', value: prefix })
    children.push({
      type: 'link',
      url: encodeFileLink(candidate, Number(lineText)),
      children: [{ type: 'text', value: `${candidate}:${lineText}` }],
    })
    lastIndex = end
  }

  if (children.length === 0) return null
  if (lastIndex < value.length) {
    children.push({ type: 'text', value: value.slice(lastIndex) })
  }
  return children
}

const remarkCodePathLinks: Plugin<[], Root> = () => (tree: Root) => {
  const pending: PendingReplacement[] = []

  const walk = (node: unknown, parent: unknown[] | null, index: number): void => {
    if (!node || typeof node !== 'object') return
    const item = node as { type?: string; children?: unknown[] }
    if (item.type === 'text' && parent) {
      const replacement = splitIntoChildren((item as Text).value)
      if (replacement) pending.push({ parent, index, replacement })
      return
    }
    if (Array.isArray(item.children)) {
      for (let childIndex = 0; childIndex < item.children.length; childIndex += 1) {
        walk(item.children[childIndex], item.children, childIndex)
      }
    }
  }

  walk(tree as unknown, null, 0)

  // 同一父节点内的替换按索引倒序执行，避免位移错位。
  pending.sort((a, b) => (a.parent === b.parent ? b.index - a.index : 0))
  for (const replacement of pending) {
    replacement.parent.splice(replacement.index, 1, ...replacement.replacement)
  }
}

export default remarkCodePathLinks
