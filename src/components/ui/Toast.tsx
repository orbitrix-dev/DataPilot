import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

type ToastTone = 'success' | 'error' | 'warning' | 'info'
type ToastState = { id: number; message: string; tone: ToastTone } | null

const toneIcon: Record<ToastTone, { name: string; className: string }> = {
  success: { name: 'check_circle', className: 'text-success' },
  error: { name: 'error', className: 'text-error' },
  warning: { name: 'warning', className: 'text-warning' },
  info: { name: 'info', className: 'text-info' },
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {})

/** `const toast = useToast(); toast('Configuration saved')` */
export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null)
  const seq = useRef(0)

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    seq.current += 1
    setToast({ id: seq.current, message, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(t)
  }, [toast])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60]">
          <div
            role="status"
            aria-live="polite"
            className="bg-light-surface border border-light-outline rounded-md shadow-lg px-4 py-3 flex items-center gap-3"
          >
            <Icon name={toneIcon[toast.tone].name} className={toneIcon[toast.tone].className} />
            <span className="font-body text-body-md text-light-on-surface">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="p-1 rounded text-light-on-surface-variant hover:bg-light-surface-container"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
