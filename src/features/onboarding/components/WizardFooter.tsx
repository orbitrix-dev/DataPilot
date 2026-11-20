import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'

type WizardFooterProps = {
  canGoBack: boolean
  continueLabel: string
  onBack: () => void
  onContinue: () => void
}

export function WizardFooter({ canGoBack, continueLabel, onBack, onContinue }: WizardFooterProps) {
  return (
    <footer className="px-6 md:px-8 py-4 bg-light-surface-container-low border-t border-light-outline-variant flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack}
        className={cn(
          'inline-flex items-center gap-1.5 px-4 py-2 rounded border font-label text-label-lg',
          canGoBack
            ? 'border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container'
            : 'border-light-outline-variant bg-light-surface-container text-light-on-surface-variant cursor-not-allowed',
        )}
      >
        <Icon name="arrow_back" size={18} />
        <span>Back</span>
      </button>
      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center gap-1.5 px-5 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg transition-colors duration-state-change"
      >
        <span>{continueLabel}</span>
        <Icon name="arrow_forward" size={18} />
      </button>
    </footer>
  )
}
