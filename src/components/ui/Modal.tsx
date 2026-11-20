import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/** Confirmation dialog built on native <dialog> (Stitch: modal-standard). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="bg-light-surface border border-light-outline rounded-lg shadow-lg max-w-md w-full p-0 overflow-hidden"
    >
      <header className="px-6 py-4 border-b border-light-outline-variant flex items-start justify-between gap-4">
        <div>
          <h2 className="font-title text-title-lg text-light-on-surface">{title}</h2>
          {description && <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="p-1 rounded text-light-on-surface-variant hover:bg-light-surface-container"
        >
          <Icon name="close" />
        </button>
      </header>
      {children && <div className="px-6 py-4">{children}</div>}
      {footer && (
        <footer className="px-6 py-3 bg-light-surface-container-low border-t border-light-outline-variant flex items-center justify-end gap-2">
          {footer}
        </footer>
      )}
    </dialog>
  )
}
