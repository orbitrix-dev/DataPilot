import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../../../components/ui/Icon'

/** Destructive confirmation (Stitch `remove-dialog`): warning icon header, alertdialog role. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  cancelLabel,
  confirmLabel,
  busy = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children: ReactNode
  cancelLabel: string
  confirmLabel: string
  busy?: boolean
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
      role="alertdialog"
      aria-labelledby="connect-confirm-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="bg-light-surface border border-light-outline rounded-lg shadow-lg max-w-md w-full p-0 overflow-hidden"
    >
      <header className="px-6 pt-5 pb-2 flex items-center gap-3">
        <span className="w-9 h-9 rounded bg-error-container text-on-error-container flex items-center justify-center">
          <Icon name="warning" size={20} />
        </span>
        <h2 id="connect-confirm-title" className="font-title text-title-lg text-light-on-surface">
          {title}
        </h2>
      </header>
      <div className="px-6 py-2">
        <p className="font-body text-body-md text-light-on-surface-variant">{children}</p>
      </div>
      <footer className="px-6 py-4 mt-2 bg-light-surface-container-low border-t border-light-outline-variant flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded border border-light-outline bg-light-surface font-label text-label-lg"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-4 py-2 rounded bg-error text-on-error font-label text-label-lg disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </footer>
    </dialog>
  )
}
