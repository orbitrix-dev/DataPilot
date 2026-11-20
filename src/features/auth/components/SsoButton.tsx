import { Icon } from '../../../components/ui/Icon'

type SsoButtonProps = {
  icon: string
  label: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}

export function SsoButton({ icon, label, loading, disabled, onClick }: SsoButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
      className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container-low transition-colors duration-state-change disabled:opacity-60"
    >
      <Icon
        name={loading ? 'progress_activity' : icon}
        size={18}
        className={loading ? 'text-light-primary animate-spin' : 'text-light-primary'}
      />
      <span className="font-label text-label-md">{label}</span>
    </button>
  )
}
