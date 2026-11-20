import { Link } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { usePageChrome } from '../components/layout/ShellContext'

/** Empty state for modules that have no Stitch design yet. */
export function ModulePlaceholder({ title, icon }: { title: string; icon: string }) {
  usePageChrome([{ label: 'Workspace', to: '/command-center' }, { label: title }])
  return (
    <section className="bg-light-surface border border-light-outline-variant rounded-md px-6 py-16 flex flex-col items-center text-center gap-3">
      <div className="w-12 h-12 rounded-md bg-light-primary-container text-light-on-primary-container flex items-center justify-center">
        <Icon name={icon} size={24} />
      </div>
      <h1 className="font-headline text-headline-md text-light-on-surface">{title}</h1>
      <p className="font-body text-body-md text-light-on-surface-variant max-w-md">
        This module has no screen designs yet. Connect a data source to start populating DataPilot.
      </p>
      <Link
        to="/connect"
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg transition-colors duration-state-change"
      >
        <Icon name="hub" size={18} />
        Open Connect
      </Link>
    </section>
  )
}
