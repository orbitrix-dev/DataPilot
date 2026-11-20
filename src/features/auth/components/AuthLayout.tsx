import type { ReactNode } from 'react'
import { Brand } from '../../../components/ui/Brand'
import { cn } from '../../../lib/cn'

type AuthLayoutProps = {
  /** Footer line under the card. */
  footer: ReactNode
  /** `md` for most auth cards, `lg` for organization creation. */
  width?: 'md' | 'lg'
  children: ReactNode
}

/** Full-screen auth frame: centered brand header, bordered card, and footer note. */
export function AuthLayout({ footer, width = 'md', children }: AuthLayoutProps) {
  const max = width === 'lg' ? 'max-w-lg' : 'max-w-md'
  return (
    <div className="min-h-screen bg-light-surface-variant text-light-on-surface font-body antialiased flex flex-col justify-between px-4 py-8 md:py-12">
      <header className={cn('w-full mx-auto flex items-center justify-center mb-6', max)}>
        <Brand size="lg" />
      </header>

      <main className={cn('w-full mx-auto', max)}>
        <div className="bg-light-surface border border-light-outline-variant rounded-md p-6 md:p-8 flex flex-col gap-gutter-lg">
          {children}
        </div>
      </main>

      <footer className={cn('w-full mx-auto mt-8 text-center', max)}>
        <p className="font-body text-body-sm text-light-on-surface-variant">{footer}</p>
      </footer>
    </div>
  )
}
