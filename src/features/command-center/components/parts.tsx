import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { TrustChip } from '../../insights/components/TrustChip'
import type { Activity } from '../activity'
import { categoryMeta } from '../activity'
import type { ActionItem, Alert } from '../signals'
import { useCommandCenter } from '../signals'
import { toneDot } from '../styles'

export const linkClass =
  'font-label text-label-md text-light-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary rounded-sm'

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary'

/** Title + description + actions row (designed on every Command Center screen). */
export function CCHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-headline text-headline-md text-light-on-surface">{title}</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-0.5">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** Sub-navigation between the Command Center pages (not designed; the overview linked to each page separately). */
export function CCTabs() {
  const { alerts, openActions } = useCommandCenter()
  const tabs = [
    { to: '/command-center', label: 'Overview', end: true },
    { to: '/command-center/performance', label: 'Performance' },
    { to: '/command-center/health', label: 'Business health' },
    { to: '/command-center/risks', label: 'Risk overview' },
    { to: '/command-center/alerts', label: `Alerts (${alerts.count})` },
    { to: '/command-center/actions', label: `Actions (${openActions.length})` },
    { to: '/command-center/activity', label: 'Activity' },
  ]
  return (
    <nav aria-label="Command Center sections" className="flex flex-wrap items-center gap-2 border-b border-light-outline-variant pb-3">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              'px-3 py-1.5 rounded font-label text-label-md tabular-nums transition-colors duration-state-change',
              focusRing,
              isActive ? 'bg-light-primary-container text-light-on-primary-container' : 'text-light-on-surface-variant hover:bg-light-surface-container',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** Small bordered button-style link used for page actions. */
export function ChipLink({ to, children, primary = false }: { to: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        'px-3 py-1.5 rounded font-label text-label-md whitespace-nowrap shrink-0 self-start lg:self-auto transition-colors duration-state-change',
        focusRing,
        primary ? 'bg-light-primary text-light-on-primary hover:bg-light-secondary' : 'border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container',
      )}
    >
      {children}
    </Link>
  )
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-3 min-w-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {typeof title === 'string' ? <h2 className="font-title text-title-md text-light-on-surface">{title}</h2> : title}
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="font-label text-label-sm uppercase text-light-on-surface-variant">{children}</span>
}

/** Alert card with the module link and, for business alerts, the live Trust status of the source data. */
export function AlertCard({ alert, compact = false }: { alert: Alert; compact?: boolean }) {
  const accent = alert.tone === 'error' ? 'border-l-error' : 'border-l-warning'
  if (compact) {
    return (
      <Link
        to={alert.to}
        className={cn(
          'p-3 rounded border border-light-outline-variant border-l-4 hover:border-light-primary flex items-center justify-between gap-3 transition-colors duration-state-change',
          accent,
          alert.kind === 'technical' && 'bg-light-surface-container-low',
          focusRing,
        )}
      >
        <div className="min-w-0">
          <p className="font-label text-label-md text-light-on-surface">{alert.title}</p>
          <p className="font-body text-body-sm text-light-on-surface-variant">{alert.detail}</p>
        </div>
        {alert.dependsOn ? <TrustChip dependsOn={alert.dependsOn} /> : <StatusBadge tone={alert.tone}>{alert.category}</StatusBadge>}
      </Link>
    )
  }
  return (
    <article className={cn('p-4 rounded-md border border-light-outline-variant border-l-4 bg-light-surface flex flex-col md:flex-row md:items-center justify-between gap-3', accent)}>
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={alert.tone}>{alert.category}</StatusBadge>
          {alert.dependsOn && <TrustChip dependsOn={alert.dependsOn} link />}
          <span className="font-body text-body-sm text-light-on-surface-variant">{alert.meta}</span>
        </div>
        <p className="font-title text-title-md text-light-on-surface">{alert.title}</p>
        <p className="font-body text-body-sm text-light-on-surface-variant">{alert.detail}</p>
      </div>
      <Link to={alert.to} className={cn(linkClass, 'shrink-0')}>
        {alert.linkLabel} →
      </Link>
    </article>
  )
}

const areaTone: Record<ActionItem['area'], 'warning' | 'primary' | 'error' | 'neutral'> = {
  Receivables: 'warning',
  Inventory: 'primary',
  Sales: 'neutral',
  'Data reliability': 'error',
}

export function ActionCard({ action }: { action: ActionItem }) {
  return (
    <article
      className={cn(
        'p-5 rounded-md border border-light-outline-variant bg-light-surface flex flex-col lg:flex-row lg:items-start justify-between gap-4',
        action.done && 'bg-light-surface-container-low',
      )}
    >
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={areaTone[action.area]}>{action.area}</StatusBadge>
          {action.done && (
            <StatusBadge tone="success" dot>
              Done
            </StatusBadge>
          )}
        </div>
        <h2 className={cn('font-title text-title-md', action.done ? 'text-light-on-surface-variant' : 'text-light-on-surface')}>{action.title}</h2>
        {action.done ? (
          <p className="font-body text-body-md text-light-on-surface-variant">
            {action.done.text}{' '}
            {action.done.to && (
              <Link to={action.done.to} className={linkClass}>
                {action.done.linkLabel} →
              </Link>
            )}
          </p>
        ) : (
          <>
            <p className="font-body text-body-md text-light-on-surface-variant">{action.detail}</p>
            {action.steps && action.steps.length > 0 && (
              <ul className="flex flex-col gap-1.5 mt-1">
                {action.steps.map((s) => (
                  <li key={s.to} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-body text-body-sm text-light-on-surface">
                    <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" aria-hidden="true" />
                    <span>{s.text}</span>
                    <Link to={s.to} className={linkClass}>
                      {s.linkLabel} →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {action.caution && (
              <p className="mt-1 p-2.5 rounded bg-warning-container text-on-warning-container font-body text-body-sm flex items-start gap-2">
                <Icon name="warning" size={16} className="shrink-0 mt-0.5" />
                <span>
                  {action.caution.text}{' '}
                  <Link to={action.caution.to} className="font-label text-label-md underline">
                    Open in Trust
                  </Link>
                </span>
              </p>
            )}
          </>
        )}
      </div>
      {!action.done && (
        <Link
          to={action.to}
          className={cn(
            'shrink-0 self-start inline-flex items-center gap-1.5 px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-md transition-colors duration-state-change',
            focusRing,
          )}
        >
          {action.cta}
          <Icon name="arrow_forward" size={16} />
        </Link>
      )}
    </article>
  )
}

export function ActivityRow({ item, compact = false }: { item: Activity; compact?: boolean }) {
  const meta = categoryMeta[item.category]
  const body = (
    <>
      <div className="min-w-0 flex items-start gap-3">
        {!compact && (
          <span className="w-8 h-8 rounded bg-light-surface-container flex items-center justify-center shrink-0 text-light-on-surface-variant">
            <Icon name={meta.icon} size={18} />
          </span>
        )}
        <div className="min-w-0">
          {!compact && <Eyebrow>{meta.label}</Eyebrow>}
          <p className={cn('font-body text-light-on-surface', compact ? 'text-body-sm' : 'text-body-md')}>
            {item.tone && item.tone !== 'neutral' && <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle', toneDot[item.tone])} aria-hidden="true" />}
            {item.text}
          </p>
          {!compact && item.actor && <p className="font-body text-body-sm text-light-on-surface-variant">{item.actor}</p>}
        </div>
      </div>
      <span className="font-body text-body-sm text-light-on-surface-variant shrink-0 tabular-nums">{item.time}</span>
    </>
  )
  const rowClass = cn('flex justify-between gap-3', compact ? 'py-2' : 'py-3 px-1')
  return item.to ? (
    <Link to={item.to} className={cn(rowClass, 'rounded-sm hover:bg-light-surface-container-low transition-colors duration-state-change', focusRing)}>
      {body}
    </Link>
  ) : (
    <div className={rowClass}>{body}</div>
  )
}
