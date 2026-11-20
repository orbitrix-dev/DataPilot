import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ShellContext, type Crumb } from './ShellContext'

/**
 * Authenticated application shell: collapsible sidebar, sticky topbar
 * (org switcher, breadcrumb, search, notifications, profile) and the
 * content column. Pages render into <Outlet/> and set their breadcrumb with
 * `usePageChrome`.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const ctx = useMemo(() => ({ setCrumbs }), [])

  return (
    <ShellContext.Provider value={ctx}>
      <div className="min-h-screen flex bg-light-surface-variant">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <Topbar crumbs={crumbs} onOpenMobileNav={() => setMobileOpen(true)} />
          <main className="flex-1 p-4 md:p-6 max-w-[1440px] w-full mx-auto flex flex-col gap-section">
            <Outlet />
          </main>
        </div>
      </div>
    </ShellContext.Provider>
  )
}
