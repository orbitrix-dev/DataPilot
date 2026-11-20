import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'

/** Slide-over side panel (Stitch: modal-drawer). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 bg-light-on-surface/40 flex justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md min-h-screen bg-light-surface border-l border-light-outline shadow-xl flex flex-col justify-between"
      >
        <div className="flex-1 overflow-y-auto">
          <header className="px-5 py-4 border-b border-light-outline-variant flex items-center justify-between">
            <h2 className="font-title text-title-lg text-light-on-surface">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close side panel"
              className="p-1 rounded text-light-on-surface-variant hover:bg-light-surface-container"
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="p-5">{children}</div>
        </div>
        {footer && (
          <footer className="px-5 py-4 border-t border-light-outline-variant bg-light-surface-container-low flex items-center justify-end gap-2">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  )
}
