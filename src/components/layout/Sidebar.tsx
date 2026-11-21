import { Link, NavLink } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { cn } from '../../lib/cn'
import { adminNav, platformNav, type NavItem } from './navigation'
import { useTrustState } from '../../features/trust/store'
import { useConnectState } from '../../features/connect/store'

/** Live status for the sidebar footer: open Trust incidents, then failing Connect sources (designed on command_center_overview). */
function useSystemStatus() {
  const { incidents } = useTrustState()
  const { connections } = useConnectState()
  const open = incidents.filter((i) => i.status !== 'resolved')
  const failing = connections.filter((c) => c.status === 'failed')
  if (open.length) {
    return {
      dot: open.some((i) => i.severity === 'critical') ? 'bg-error' : 'bg-warning',
      title: `${open.length} active ${open.length === 1 ? 'incident' : 'incidents'}`,
      detail: open[0].shortTitle,
    }
  }
  if (failing.length) {
    return { dot: 'bg-error', title: `${failing.length} ${failing.length === 1 ? 'source' : 'sources'} failing`, detail: failing[0].name }
  }
  return { dot: 'bg-success', title: 'US-East-1 Prod', detail: 'All systems operational' }
}

function NavGroup({ title, items, collapsed, onNavigate }: { title: string; items: NavItem[]; collapsed: boolean; onNavigate: () => void }) {
  return (
    <>
      {!collapsed && (
        <span className="px-2.5 py-1.5 font-label text-label-sm uppercase text-light-on-surface-variant">{title}</span>
      )}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-2.5 py-2 rounded font-label text-label-lg transition-colors duration-state-change',
              isActive
                ? 'bg-light-primary-container text-light-on-primary-container'
                : 'text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface',
            )
          }
        >
          <Icon name={item.icon} className="shrink-0" />
          {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
        </NavLink>
      ))}
    </>
  )
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: {
  collapsed: boolean
  mobileOpen: boolean
  onToggleCollapse: () => void
  onCloseMobile: () => void
}) {
  // On mobile the drawer always shows labels.
  const showCollapsed = collapsed && !mobileOpen
  const status = useSystemStatus()
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-light-on-surface/40 lg:hidden" onClick={onCloseMobile} />}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 lg:z-20 h-screen bg-light-surface border-r border-light-outline-variant flex flex-col justify-between',
          'transition-[width,transform] duration-state-change ease-state-change lg:translate-x-0 shrink-0 overflow-y-auto overflow-x-hidden',
          showCollapsed ? 'w-16' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex flex-col">
          <div className={cn('h-14 border-b border-light-outline-variant flex items-center gap-2', showCollapsed ? 'px-3 justify-center' : 'px-4 justify-between')}>
            {!showCollapsed && (
              <NavLink to="/command-center" className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded bg-light-primary text-light-on-primary flex items-center justify-center shrink-0">
                  <Icon name="analytics" size={18} />
                </div>
                <span className="font-title text-title-lg text-light-on-surface whitespace-nowrap">DataPilot</span>
              </NavLink>
            )}
            <button
              type="button"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={onToggleCollapse}
              className="hidden lg:inline-flex items-center justify-center w-7 h-7 rounded text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change"
            >
              <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={18} />
            </button>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={onCloseMobile}
              className="lg:hidden inline-flex items-center justify-center w-7 h-7 rounded text-light-on-surface-variant hover:bg-light-surface-container"
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <nav aria-label="Primary navigation" className="p-3 flex flex-col gap-1">
            <NavGroup title="Platform" items={platformNav} collapsed={showCollapsed} onNavigate={onCloseMobile} />
          </nav>
          <nav aria-label="Administration navigation" className="px-3 py-2 border-t border-light-outline-variant flex flex-col gap-1">
            <NavGroup title="Administration" items={adminNav} collapsed={showCollapsed} onNavigate={onCloseMobile} />
          </nav>
        </div>

        <div className="p-3 border-t border-light-outline-variant">
          <Link
            to="/command-center/alerts"
            onClick={onCloseMobile}
            title={showCollapsed ? `${status.title}: ${status.detail}` : undefined}
            className={cn(
              'flex items-center gap-2.5 py-2 rounded bg-light-surface-container-low hover:bg-light-surface-container transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
              showCollapsed ? 'justify-center' : 'px-2.5',
            )}
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', status.dot)} aria-hidden="true" />
            {showCollapsed ? (
              <span className="sr-only">{`${status.title}: ${status.detail}`}</span>
            ) : (
              <div className="overflow-hidden">
                <p className="font-label text-label-md text-light-on-surface">{status.title}</p>
                <p className="font-body text-body-sm text-light-on-surface-variant truncate">{status.detail}</p>
              </div>
            )}
          </Link>
        </div>
      </aside>
    </>
  )
}
