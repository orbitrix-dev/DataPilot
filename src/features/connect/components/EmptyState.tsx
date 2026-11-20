import type { ReactNode } from 'react'
import { Icon } from '../../../components/ui/Icon'

export function EmptyState({ icon = 'search_off', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-6">
      <span className="w-10 h-10 rounded bg-light-surface-container text-light-on-surface-variant flex items-center justify-center">
        <Icon name={icon} size={22} />
      </span>
      <p className="font-title text-title-md text-light-on-surface">{title}</p>
      {children && <div className="font-body text-body-sm text-light-on-surface-variant">{children}</div>}
    </div>
  )
}
