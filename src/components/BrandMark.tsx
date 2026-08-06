import { Monitor } from 'lucide-react'

const rayAngles = [-165, -130, -95, -60, -25, 10, 45, 80, 115, 150]

export default function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-mark-rays">
        {rayAngles.map((angle) => (
          <i key={angle} style={{ transform: `rotate(${angle}deg)` }} />
        ))}
      </span>
      <span className="brand-mark-core" />
      <Monitor className="brand-mark-terminal" size={13} strokeWidth={2.2} />
    </span>
  )
}
