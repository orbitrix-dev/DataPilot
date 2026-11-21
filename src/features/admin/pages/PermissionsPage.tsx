import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { AdminHeader, AdminPage, SavedNotice, UsersTabs } from '../components/parts'
import { panelClass, thClass } from '../styles'
import { capabilities, roles, seedMatrix, type Matrix } from '../data'
import { saveMatrix, useAdminState } from '../store'

/** Permission Configuration (designed: admin_permission_configuration). The Owner column is fixed. */
export function PermissionsPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Permission Configuration' }])
  const { matrix } = useAdminState()
  const [draft, setDraft] = useState<Matrix>(matrix)
  const [saved, setSaved] = useState<number | null>(null)
  const toast = useToast()
  const highlight = useLocation().hash.replace('#role-', '')

  const changed = capabilities.reduce((n, c) => n + roles.filter((r) => draft[c.id][r.id] !== matrix[c.id][r.id]).length, 0)
  const isDefault = capabilities.every((c) => roles.every((r) => draft[c.id][r.id] === seedMatrix[c.id][r.id]))

  const save = () => {
    const n = saveMatrix(draft)
    setSaved(n)
    toast(`${n} permission ${n === 1 ? 'change' : 'changes'} saved`)
  }

  return (
    <AdminPage>
      <UsersTabs />
      <AdminHeader
        title="Permission Matrix"
        description="Every permission change is logged to Audit Logs with actor and timestamp."
        actions={
          <>
            {!isDefault && (
              <Button variant="ghost" onClick={() => setDraft(seedMatrix)}>
                Reset to defaults
              </Button>
            )}
            {changed > 0 && (
              <Button variant="secondary" onClick={() => setDraft(matrix)}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={changed === 0}>
              Save Changes{changed > 0 ? ` (${changed})` : ''}
            </Button>
          </>
        }
      />
      {saved !== null && changed === 0 && <SavedNotice>Permission matrix updated and recorded in Audit Logs.</SavedNotice>}

      <div className={cn(panelClass, 'overflow-x-auto')}>
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={thClass}>Capability</th>
              {roles.map((r) => (
                <th key={r.id} id={`role-${r.id}`} className={cn(thClass, highlight === r.id && 'bg-light-primary-container text-light-on-primary-container')}>
                  {r.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {capabilities.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="px-4 py-3 font-label text-label-md text-light-on-surface">
                  {c.label}
                </th>
                {roles.map((r) => {
                  const value = draft[c.id][r.id]
                  const dirty = value !== matrix[c.id][r.id]
                  return (
                    <td key={r.id} className={cn('px-4 py-2.5', highlight === r.id && 'bg-light-primary-container/40')}>
                      {r.id === 'owner' ? (
                        <span className="font-body text-body-sm text-light-on-surface" title="The Organization Owner always has full access">
                          {value}
                        </span>
                      ) : (
                        <select
                          aria-label={`${r.label}: ${c.label}`}
                          value={value}
                          onChange={(e) => setDraft({ ...draft, [c.id]: { ...draft[c.id], [r.id]: e.target.value } })}
                          className={cn(
                            'w-full min-w-[7.5rem] rounded border py-1 pl-2 pr-7 font-body text-body-sm focus:border-light-primary focus:ring-1 focus:ring-light-primary',
                            dirty ? 'border-light-primary bg-light-primary-container text-light-on-primary-container' : 'border-light-outline-variant bg-light-surface',
                            value === 'None' && !dirty && 'text-light-on-surface-variant',
                          )}
                        >
                          {c.levels.map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-body text-body-sm text-light-on-surface-variant">
        The Owner column cannot be changed. Changes apply to everyone with that role. Automate shows approver roles but does not enforce them yet in this preview.
      </p>
    </AdminPage>
  )
}
