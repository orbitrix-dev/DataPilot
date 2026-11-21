import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { AdminHeader, AdminPage, UsersTabs } from '../components/parts'
import { linkClass, panelClass } from '../styles'
import { roles } from '../data'
import { useAdminState } from '../store'

/** Role Management (designed: admin_role_management). Counts follow the Users page. */
export function RolesPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Role Management' }])
  const { members } = useAdminState()

  return (
    <AdminPage>
      <UsersTabs />
      <AdminHeader
        title="Role Definitions"
        description="Standardized organizational roles with clear boundaries between business decisions and technical administration."
      />
      <div className={cn(panelClass, 'divide-y divide-light-outline-variant')}>
        {roles.map((r) => {
          const n = members.filter((m) => m.role === r.id).length
          return (
            <div key={r.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-title text-title-md text-light-on-surface">{r.label}</h2>
                <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">{r.description}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <Link
                  to={`/users-permissions?role=${r.id}`}
                  className="px-2 py-0.5 rounded bg-light-surface-container text-light-on-surface font-label text-label-sm tabular-nums hover:bg-light-surface-container-high"
                >
                  {n} {n === 1 ? 'user' : 'users'}
                </Link>
                <Link to={`/users-permissions/permissions#role-${r.id}`} className={linkClass}>
                  View matrix →
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </AdminPage>
  )
}
