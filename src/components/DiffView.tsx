import type { DiffLine } from './diffPreview'

/** 差异行渲染：增行绿、删行红、等行灰。 */
export default function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="diff-view" aria-label="diff">
      {lines.map((line, index) => (
        <div key={`${index}:${line.type}:${line.text}`} className={`diff-line is-${line.type}`}>
          <span className="diff-line-marker">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
          <code>{line.text}</code>
        </div>
      ))}
    </div>
  )
}
