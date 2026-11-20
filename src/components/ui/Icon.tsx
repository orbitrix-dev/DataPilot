import { cn } from '../../lib/cn'

type IconProps = {
  /** Material Symbols Outlined ligature name, e.g. "analytics". */
  name: string
  /** Pixel size; maps to the `text-[Npx]` classes used in the Stitch screens. */
  size?: number
  filled?: boolean
  className?: string
}

export function Icon({ name, size = 20, filled = false, className }: IconProps) {
  return (
    <span
      className={cn('material-symbols-outlined', className)}
      style={{ fontSize: size, fontVariationSettings: filled ? "'FILL' 1" : undefined }}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}
