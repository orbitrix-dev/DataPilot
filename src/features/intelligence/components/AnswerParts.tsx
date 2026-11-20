import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import type { Reliability } from '../trust'

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary'

/** Small uppercase label above a block ("Direct answer", "Recommended action"). */
export function Eyebrow({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return (
    <span className={cn('font-label text-label-sm uppercase', primary ? 'text-light-primary' : 'text-light-on-surface-variant')}>
      {children}
    </span>
  )
}

/** "Verified" / "Qualified (INC-204)" / "Forecast" pill. */
export function ReliabilityPill({ reliability, children }: { reliability: Reliability; children?: ReactNode }) {
  const tone =
    reliability.status === 'verified'
      ? 'bg-success-container text-on-success-container'
      : reliability.status === 'forecast'
        ? 'bg-info-container text-on-info-container'
        : 'bg-warning-container text-on-warning-container'
  return (
    <span className={cn('px-2.5 py-1 rounded-full font-label text-label-sm shrink-0 whitespace-nowrap', tone)}>
      {children ?? reliability.label}
    </span>
  )
}

/** Question row with the asker's avatar (anomaly and recommendation designs). */
export function QuestionHeader({ question, aside }: { question: string; aside?: ReactNode }) {
  return (
    <div className="bg-light-surface border border-light-outline-variant rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full bg-light-surface-container flex items-center justify-center font-label text-label-md text-light-on-surface shrink-0"
          aria-hidden="true"
        >
          EW
        </div>
        <h1 className="font-title text-title-lg text-light-on-surface">{question}</h1>
      </div>
      {aside}
    </div>
  )
}

/** Full-width warning band for a Trust issue that qualifies the answer. */
export function TrustNotice({
  icon = 'warning',
  title,
  children,
  action,
}: {
  icon?: string
  title: ReactNode
  children: ReactNode
  action?: { label: string; to: string }
}) {
  return (
    <div
      role="status"
      className="bg-warning-container border border-light-outline-variant rounded-md p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
    >
      <div className="flex items-start gap-3">
        <Icon name={icon} className="text-on-warning-container shrink-0 mt-0.5" />
        <div>
          <p className="font-label text-label-lg text-on-warning-container">{title}</p>
          <p className="font-body text-body-sm text-on-warning-container mt-0.5">{children}</p>
        </div>
      </div>
      {action && (
        <Link
          to={action.to}
          className={cn(
            'self-start px-3 py-1.5 rounded bg-light-surface border border-light-outline font-label text-label-md text-light-on-surface shrink-0 hover:bg-light-surface-container',
            focusRing,
          )}
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}

/** Grey metric tile inside an answer card. */
export function StatTile({
  label,
  value,
  valueClass,
  caption,
  size = 'md',
}: {
  label: string
  value: string
  valueClass?: string
  caption?: ReactNode
  /** `sm` = title-lg value (conversation design), `md` = headline-md. */
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className={cn(
        'p-3.5 rounded bg-light-surface-container-low',
        size === 'sm' && 'border border-light-outline-variant',
      )}
    >
      <span className="font-label text-label-sm text-light-on-surface-variant">{label}</span>
      <p
        className={cn(
          'tabular-nums',
          size === 'sm' ? 'font-title text-title-lg mt-0.5' : 'font-headline text-headline-md mt-1',
          valueClass ?? 'text-light-on-surface',
        )}
      >
        {value}
      </p>
      {caption && <div className="font-body text-body-sm text-light-on-surface-variant mt-1">{caption}</div>}
    </div>
  )
}

/** Labelled metadata item (date range, source, freshness, reliability). */
export function MetaItem({ label, children, uppercase = false }: { label: string; children: ReactNode; uppercase?: boolean }) {
  return (
    <div className="min-w-0">
      <span
        className={cn(
          'font-label text-label-sm text-light-on-surface-variant block',
          uppercase && 'uppercase',
        )}
      >
        {label}
      </span>
      <div className="font-body text-body-sm text-light-on-surface mt-0.5 break-words">{children}</div>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-mono-sm text-light-on-surface">{children}</code>
}

export function SourceList({ sources }: { sources: string[] }) {
  return (
    <span className="font-mono text-mono-sm text-light-on-surface-variant">
      {sources.join(', ')}
    </span>
  )
}

export type FollowUp = { label: string; to: string }

/** Rounded follow-up chips. */
export function FollowUps({
  items,
  title = 'Follow-up questions',
  inline = false,
}: {
  items: FollowUp[]
  title?: string
  /** Inline = label and chips on one row, inside the answer card (conversation design). */
  inline?: boolean
}) {
  const chips = items.map((f) => (
    <Link
      key={f.label}
      to={f.to}
      className={cn(
        'px-3 py-1.5 rounded-full border hover:border-light-primary text-light-on-surface transition-colors duration-state-change',
        inline
          ? 'border-light-outline bg-light-surface-container-low font-label text-label-sm'
          : 'bg-light-surface border-light-outline-variant font-body text-body-sm',
        focusRing,
      )}
    >
      {f.label}
    </Link>
  ))
  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="font-label text-label-sm text-light-on-surface-variant">Follow up:</span>
        {chips}
      </div>
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-label text-label-md text-light-on-surface-variant uppercase">{title}</h2>
      <div className="flex flex-wrap gap-2">{chips}</div>
    </section>
  )
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn('font-label text-label-md text-light-primary hover:underline rounded-sm', focusRing)}>
      {children}
    </Link>
  )
}

export function OutlineLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center px-3 py-2 rounded border border-light-outline bg-light-surface hover:bg-light-surface-container font-label text-label-md text-light-on-surface whitespace-nowrap',
        focusRing,
      )}
    >
      {children}
    </Link>
  )
}

/** Horizontal value bar used for drivers and rankings. */
export function MeterRow({
  label,
  value,
  pct,
  tone = 'primary',
}: {
  label: ReactNode
  value: string
  /** 0–100 */
  pct: number
  tone?: 'primary' | 'error' | 'warning' | 'neutral'
}) {
  const bar = { primary: 'bg-light-primary', error: 'bg-error', warning: 'bg-warning', neutral: 'bg-light-outline' }[tone]
  const text = { primary: 'text-light-on-surface', error: 'text-error', warning: 'text-warning', neutral: 'text-light-on-surface-variant' }[tone]
  return (
    <div>
      <div className="flex justify-between gap-3 font-body text-body-sm mb-1">
        <span className="text-light-on-surface">{label}</span>
        <span className={cn('font-mono text-mono-sm whitespace-nowrap', text)}>{value}</span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-light-surface-container" aria-hidden="true">
        <div className={cn('h-2.5 rounded-full', bar)} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  )
}
