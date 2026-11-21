import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import type { StatusTone } from '../../connect/status'
import type { RunOutcome, WorkflowState } from '../data'
import { useAutomateState } from '../store'

const stateMeta: Record<WorkflowState, { tone: StatusTone; label: string }> = {
  published: { tone: 'success', label: 'Published' },
  paused: { tone: 'warning', label: 'Paused' },
  draft: { tone: 'neutral', label: 'Draft' },
}

export function StateBadge({ state }: { state: WorkflowState }) {
  return <StatusBadge tone={stateMeta[state].tone}>{stateMeta[state].label}</StatusBadge>
}

const outcomeMeta: Record<RunOutcome, { className: string; label: string }> = {
  executed: { className: 'bg-success-container text-on-success-container', label: 'Executed' },
  failed: { className: 'bg-error-container text-on-error-container', label: 'Failed' },
  running: { className: 'bg-light-primary-container text-light-on-primary-container', label: 'Running' },
  test: { className: 'bg-info-container text-on-info-container', label: 'Test simulated' },
  rejected: { className: 'bg-light-surface-container text-light-on-surface-variant', label: 'Rejected' },
}

export function OutcomeBadge({ outcome }: { outcome: RunOutcome }) {
  const m = outcomeMeta[outcome]
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-sm font-label text-label-sm whitespace-nowrap', m.className)}>
      {m.label}
    </span>
  )
}

/** Sub-navigation shared by the four Automate list pages (designed on the overview). */
export function AutomateTabs() {
  const { requests } = useAutomateState()
  const pending = requests.filter((r) => r.status === 'pending').length
  const tabs = [
    { to: '/automate', label: 'All workflows', end: true },
    { to: '/automate/approvals', label: `Approval Center (${pending})` },
    { to: '/automate/scheduled', label: 'Scheduled' },
    { to: '/automate/history', label: 'Execution history' },
  ]
  return (
    <nav aria-label="Automate sections" className="flex flex-wrap items-center gap-2 border-b border-light-outline-variant pb-3">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              'px-3 py-1.5 rounded font-label text-label-md tabular-nums transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
              isActive
                ? 'bg-light-primary-container text-light-on-primary-container'
                : 'text-light-on-surface-variant hover:bg-light-surface-container',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** Title + description + actions row used by every Automate page. A non-string title renders its own heading. */
export function AutomateHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="flex flex-wrap items-center gap-2 mb-1">{eyebrow}</div>}
        {typeof title === 'string' ? <h1 className="font-headline text-headline-md text-light-on-surface">{title}</h1> : title}
        {description && <p className="font-body text-body-md text-light-on-surface-variant mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** Link styled as a secondary or primary button. */
export function ButtonLink({ to, children, variant = 'secondary', className }: { to: string; children: ReactNode; variant?: 'primary' | 'secondary'; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2 rounded font-label text-label-lg transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-1',
        variant === 'primary'
          ? 'bg-light-primary text-light-on-primary hover:bg-light-secondary'
          : 'border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container',
        className,
      )}
    >
      {children}
    </Link>
  )
}

/** Warning row, optionally linking to the Trust page that explains a data problem. */
export function WarningNote({ children, to }: { children: ReactNode; to?: string }) {
  return (
    <div className="p-3.5 rounded bg-warning-container text-on-warning-container flex items-start gap-2.5 font-body text-body-sm">
      <Icon name="warning" size={18} className="shrink-0 mt-0.5" />
      <p className="flex-1">
        {children}{' '}
        {to && (
          <Link to={to} className="font-label text-label-md underline">
            Open in Trust
          </Link>
        )}
      </p>
    </div>
  )
}

export function WorkflowNotFound({ id }: { id?: string }) {
  return (
    <div className="max-w-xl w-full mx-auto bg-light-surface border border-light-outline-variant rounded-md p-8 flex flex-col items-center text-center gap-3">
      <Icon name="search_off" size={32} className="text-light-on-surface-variant" />
      <h1 className="font-title text-title-lg text-light-on-surface">{id ? `${id} was not found` : 'Not found'}</h1>
      <p className="font-body text-body-md text-light-on-surface-variant">It may have been created in another session. Workflows created here last until you reload the page.</p>
      <ButtonLink to="/automate">Back to workflows</ButtonLink>
    </div>
  )
}
