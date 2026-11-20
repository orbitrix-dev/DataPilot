import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/** White surface with a 1px outline-variant border — the base container for cards, tables and panels. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('bg-light-surface border border-light-outline-variant rounded-md', className)}
      {...rest}
    />
  )
}
