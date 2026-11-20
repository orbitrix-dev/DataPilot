import { Link } from 'react-router-dom'
import { Brand } from '../../../components/ui/Brand'
import { Icon } from '../../../components/ui/Icon'

export function OnboardingTopbar() {
  return (
    <header className="h-14 bg-light-surface border-b border-light-outline-variant px-4 lg:px-8 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Brand />
        <span className="hidden sm:inline-block px-2 py-0.5 rounded-sm bg-light-surface-container text-light-on-surface-variant font-label text-label-sm">
          Setup Wizard
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5 font-body text-body-sm text-light-on-surface-variant">
          <Icon name="cloud_done" size={16} className="text-success" />
          <span>Progress saved</span>
        </span>
        <Link
          to="/command-center"
          className="font-label text-label-md text-light-on-surface-variant hover:text-light-on-surface"
        >
          Skip to Command Center
        </Link>
      </div>
    </header>
  )
}
