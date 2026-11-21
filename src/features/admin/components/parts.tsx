import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { focusRing, panelClass } from '../styles'
import type { RoleId } from '../data'
import { roleById } from '../data'
import { seatsUsed, useAdminState } from '../store'

/** Page width per design: forms are narrow, tables wide. */
export function AdminPage({ width = '5xl', children }: { width?: '3xl' | '4xl' | '5xl' | '6xl'; children: ReactNode }) {
  const w = { '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '5xl': 'max-w-5xl', '6xl': 'max-w-6xl' }[width]
  return <div className={cn(w, 'w-full mx-auto flex flex-col gap-6')}>{children}</div>
}

export function AdminHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-headline text-headline-md text-light-on-surface">{title}</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-0.5">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">{actions}</div>}
    </div>
  )
}

type Tab = { to: string; label: string; end?: boolean }

function Tabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 border-b border-light-outline-variant pb-3">
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

/** Users / Roles / Permissions (designed on the three pages). */
export function UsersTabs() {
  const s = useAdminState()
  return (
    <Tabs
      label="Users and permissions sections"
      tabs={[
        { to: '/users-permissions', label: `Users (${seatsUsed(s)})`, end: true },
        { to: '/users-permissions/roles', label: 'Roles' },
        { to: '/users-permissions/permissions', label: 'Permissions' },
      ]}
    />
  )
}

/** General / Security / API Keys / Notifications (designed on the four settings pages). */
export function SettingsTabs() {
  return (
    <Tabs
      label="Settings sections"
      tabs={[
        { to: '/settings', label: 'General', end: true },
        { to: '/settings/security', label: 'Security' },
        { to: '/settings/api-keys', label: 'API Keys' },
        { to: '/settings/notifications', label: 'Notifications' },
      ]}
    />
  )
}

export function BillingTabs() {
  return (
    <Tabs
      label="Billing sections"
      tabs={[
        { to: '/billing', label: 'Subscription & Billing', end: true },
        { to: '/billing/usage', label: 'Usage Overview' },
      ]}
    />
  )
}

export function RoleBadge({ role }: { role: RoleId }) {
  return (
    <span
      className={cn(
        'inline-block px-2 py-0.5 rounded font-label text-label-sm whitespace-nowrap',
        role === 'owner'
          ? 'bg-light-primary-container text-light-on-primary-container'
          : role === 'viewer'
            ? 'bg-light-surface-container text-light-on-surface-variant'
            : 'bg-light-surface-container text-light-on-surface',
      )}
    >
      {roleById(role).label}
    </span>
  )
}

/** Inline success banner (designed after "Save" on settings and permissions). */
export function SavedNotice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="bg-success-container rounded p-3 font-body text-body-sm text-on-success-container">
      {children}
    </div>
  )
}

/** Labelled checkbox row, as designed on Security and Notifications. */
export function CheckRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label htmlFor={id} className={cn('flex items-center justify-between gap-4 py-2', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <span className="min-w-0">
        <span className="block font-label text-label-md text-light-on-surface">{label}</span>
        {hint && <span className="block font-body text-body-sm text-light-on-surface-variant mt-0.5">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded text-light-primary focus:ring-light-primary shrink-0 w-4 h-4"
      />
    </label>
  )
}

/** Usage meter card (designed on Usage Overview). Turns amber at 80% and red at 100%. */
export function Meter({ label, value, used, limit, note }: { label: string; value: string; used: number; limit: number; note?: string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const bar = pct >= 100 ? 'bg-error' : pct >= 80 ? 'bg-warning' : 'bg-light-primary'
  return (
    <div className={cn(panelClass, 'p-4')}>
      <span className="font-label text-label-md text-light-on-surface-variant">{label}</span>
      <p className="font-headline text-headline-md mt-2 tabular-nums text-light-on-surface">{value}</p>
      <div
        className="w-full h-2 rounded-full bg-light-surface-container mt-2"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={cn('h-2 rounded-full', bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className="font-body text-body-sm text-light-on-surface-variant mt-2 tabular-nums">
        {Math.round(pct)}% used{note ? ` · ${note}` : ''}
      </p>
    </div>
  )
}
