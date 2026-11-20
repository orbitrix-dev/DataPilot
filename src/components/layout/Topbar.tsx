import { Fragment, useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useClickOutside } from '../../lib/useClickOutside'
import { cn } from '../../lib/cn'
import { organizations } from './navigation'
import type { Crumb } from './ShellContext'

type Menu = 'org' | 'notifications' | 'profile' | null

const notifications = [
  {
    icon: 'warning',
    tone: 'text-warning',
    title: 'Schema drift detected',
    body: (
      <>
        Column <code className="font-mono text-mono-sm">tax_region</code> added in upstream feed.
      </>
    ),
    time: '6m ago',
    unread: true,
  },
  {
    icon: 'check_circle',
    tone: 'text-success',
    title: 'Daily validation completed',
    body: 'All 42 connectors passed SLA checks.',
    time: '1h ago',
    unread: false,
  },
]

export function Topbar({ crumbs, onOpenMobileNav }: { crumbs: Crumb[]; onOpenMobileNav: () => void }) {
  const [menu, setMenu] = useState<Menu>(null)
  const [org, setOrg] = useState(organizations[0])
  const [unread, setUnread] = useState(2)
  const toast = useToast()
  const navigate = useNavigate()
  const rightRef = useRef<HTMLDivElement>(null)
  const orgRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setMenu(null), [])
  useClickOutside(orgRef, menu === 'org', close)
  useClickOutside(rightRef, menu === 'notifications' || menu === 'profile', close)

  const toggle = (m: Menu) => setMenu((cur) => (cur === m ? null : m))

  return (
    <header className="sticky top-0 z-30 h-14 bg-light-surface border-b border-light-outline-variant px-4 lg:px-6 flex items-center justify-between gap-gutter-md">
      <div className="flex items-center gap-gutter-sm min-w-0">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onOpenMobileNav}
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded text-light-on-surface-variant hover:bg-light-surface-container"
        >
          <Icon name="menu" />
        </button>

        <div className="relative" ref={orgRef}>
          <button
            type="button"
            onClick={() => toggle('org')}
            aria-haspopup="listbox"
            aria-expanded={menu === 'org'}
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded border border-light-outline-variant bg-light-surface hover:bg-light-surface-container-low transition-colors duration-state-change"
          >
            <span className="w-5 h-5 rounded-sm bg-light-primary text-light-on-primary flex items-center justify-center font-label text-label-sm">
              {org.initials}
            </span>
            <span className="font-label text-label-md text-light-on-surface hidden sm:inline">{org.name}</span>
            <Icon name="expand_more" size={16} className="text-light-on-surface-variant" />
          </button>
          {menu === 'org' && (
            <div className="absolute left-0 mt-1.5 w-60 bg-light-surface border border-light-outline rounded-md shadow-lg py-1.5 z-50">
              <div className="px-3 py-1.5 border-b border-light-outline-variant">
                <span className="font-label text-label-sm uppercase text-light-on-surface-variant">Organizations</span>
              </div>
              {organizations.map((o) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => {
                    setOrg(o)
                    close()
                    toast(`Switched to ${o.name}`)
                  }}
                  className={cn(
                    'w-full px-3 py-2 text-left flex items-center justify-between hover:bg-light-surface-container-low',
                    o.name === org.name && 'bg-light-primary-container/50',
                  )}
                >
                  <span className="font-label text-label-md text-light-on-surface">{o.name}</span>
                  {o.name === org.name && <Icon name="check" size={16} className="text-light-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1.5 pl-2 border-l border-light-outline-variant min-w-0">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1
              return (
                <Fragment key={`${c.label}-${i}`}>
                  {i > 0 && <Icon name="chevron_right" size={16} className="text-light-on-surface-variant shrink-0" />}
                  {last || !c.to ? (
                    <span className={cn('truncate', last ? 'font-label text-label-md text-light-on-surface' : 'font-body text-body-sm text-light-on-surface-variant')} aria-current={last ? 'page' : undefined}>
                      {c.label}
                    </span>
                  ) : (
                    <Link to={c.to} className="font-body text-body-sm text-light-on-surface-variant hover:text-light-on-surface whitespace-nowrap">
                      {c.label}
                    </Link>
                  )}
                </Fragment>
              )
            })}
          </nav>
        )}
      </div>

      <div className="flex items-center gap-gutter-sm" ref={rightRef}>
        <div className="relative hidden sm:flex items-center">
          <Icon name="search" size={18} className="text-light-on-surface-variant absolute left-3 pointer-events-none" />
          <input
            type="search"
            aria-label="Global search"
            placeholder="Search workspace..."
            className="w-56 lg:w-72 pl-9 pr-11 py-1.5 rounded border border-light-outline bg-light-surface-container-low text-body-sm text-light-on-surface placeholder:text-light-on-surface-variant focus:bg-light-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary"
          />
          <kbd className="absolute right-2 px-1.5 py-0.5 rounded-sm bg-light-surface border border-light-outline text-label-sm text-light-on-surface-variant font-mono">
            ⌘K
          </kbd>
        </div>
        <button type="button" aria-label="Search" className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded text-light-on-surface-variant hover:bg-light-surface-container">
          <Icon name="search" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggle('notifications')}
            aria-label="Notifications"
            aria-expanded={menu === 'notifications'}
            className="relative inline-flex items-center justify-center w-9 h-9 rounded text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change"
          >
            <Icon name="notifications" />
            {unread > 0 && <span role="status" aria-label="Unread notifications" className="absolute top-2 right-2 w-2 h-2 rounded-full bg-error" />}
          </button>
          {menu === 'notifications' && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-light-surface border border-light-outline rounded-md shadow-lg z-50 overflow-hidden">
              <header className="px-4 py-3 border-b border-light-outline-variant flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-title text-title-md text-light-on-surface">Notifications</span>
                  {unread > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-light-primary text-light-on-primary tabular-nums font-label text-label-sm">
                      {unread}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => setUnread(0)} className="font-label text-label-md text-light-primary hover:text-light-secondary">
                  Mark all read
                </button>
              </header>
              <div className="divide-y divide-light-outline-variant">
                {notifications.map((n) => (
                  <div key={n.title} className={cn('px-4 py-3 flex items-start gap-3', n.unread && unread > 0 && 'bg-light-primary-container/30')}>
                    <Icon name={n.icon} size={18} className={cn(n.tone, 'mt-0.5')} />
                    <div>
                      <p className="font-label text-label-md text-light-on-surface">{n.title}</p>
                      <p className="font-body text-body-sm text-light-on-surface-variant">{n.body}</p>
                      <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">{n.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggle('profile')}
            aria-expanded={menu === 'profile'}
            className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1 rounded hover:bg-light-surface-container transition-colors duration-state-change"
          >
            <div className="w-7 h-7 rounded-full bg-light-primary-container text-light-on-primary-container flex items-center justify-center font-label text-label-md">
              EV
            </div>
            <p className="hidden md:block font-label text-label-md text-light-on-surface leading-tight">Elena Vance</p>
            <Icon name="expand_more" size={16} className="text-light-on-surface-variant" />
          </button>
          {menu === 'profile' && (
            <div className="absolute right-0 mt-2 w-56 bg-light-surface border border-light-outline rounded-md shadow-lg py-1.5 z-50">
              <div className="px-3 py-2 border-b border-light-outline-variant">
                <p className="font-label text-label-md text-light-on-surface">Elena Vance</p>
                <p className="font-body text-body-sm text-light-on-surface-variant">Platform Admin · e.vance@acme.io</p>
              </div>
              <Link to="/settings" onClick={close} className="block px-3 py-2 font-body text-body-md text-light-on-surface hover:bg-light-surface-container-low">
                Profile &amp; preferences
              </Link>
              <Link to="/audit-logs" onClick={close} className="block px-3 py-2 font-body text-body-md text-light-on-surface hover:bg-light-surface-container-low">
                API tokens
              </Link>
              <div className="border-t border-light-outline-variant my-1" />
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full text-left px-3 py-2 font-body text-body-md text-error hover:bg-error-container/40"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
