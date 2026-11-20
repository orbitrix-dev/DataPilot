import type { ReactNode } from 'react'
import { Icon } from '../../../components/ui/Icon'

type AuthHeadingProps = {
  title: string
  description: ReactNode
  /** Optional circular icon badge above the title. */
  icon?: string
  align?: 'center' | 'start'
}

export function AuthHeading({ title, description, icon, align = 'center' }: AuthHeadingProps) {
  if (icon) {
    return (
      <div className="text-center flex flex-col items-center gap-2">
        <div className="w-11 h-11 rounded-full bg-light-primary-container text-light-on-primary-container flex items-center justify-center">
          <Icon name={icon} size={22} />
        </div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">{title}</h1>
        <p className="font-body text-body-md text-light-on-surface-variant text-pretty">{description}</p>
      </div>
    )
  }
  return (
    <div className={align === 'center' ? 'text-center' : undefined}>
      <h1 className="font-headline text-headline-lg text-light-on-surface">{title}</h1>
      <p className="font-body text-body-md text-light-on-surface-variant mt-1.5 text-pretty">{description}</p>
    </div>
  )
}
