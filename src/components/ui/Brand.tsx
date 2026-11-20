import { Icon } from './Icon'
import { cn } from '../../lib/cn'

/** DataPilot logo mark + wordmark. */
export function Brand({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  const lg = size === 'lg'
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className={cn(
          'rounded bg-light-primary text-light-on-primary flex items-center justify-center shrink-0',
          lg ? 'w-9 h-9' : 'w-8 h-8',
        )}
      >
        <Icon name="analytics" size={lg ? 20 : 18} />
      </div>
      <span className={cn('font-title text-light-on-surface whitespace-nowrap', lg ? 'text-headline-md' : 'text-title-lg')}>
        DataPilot
      </span>
    </div>
  )
}
