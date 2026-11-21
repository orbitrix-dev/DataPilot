import { useNavigate } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { actionTypeById, templates } from '../data'
import { AutomateHeader } from '../components/parts'
import { createWorkflow } from '../store'

/** Workflow marketplace (designed: automate_workflow_marketplace). */
export function MarketplacePage() {
  usePageChrome([{ label: 'Automate', to: '/automate' }, { label: 'Workflow marketplace' }])
  const navigate = useNavigate()
  const toast = useToast()

  const use = (templateId?: string) => {
    const id = createWorkflow(templateId)
    if (templateId) toast(`Draft ${id} created. Review each step, then test and publish.`, 'info')
    navigate(`/automate/workflows/${id}/builder`)
  }

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        title="Workflow marketplace"
        description="Start from vetted distributor and wholesale templates. Every template opens in Draft mode with explicit permission scopes."
        actions={
          <Button variant="secondary" onClick={() => use()}>
            Build blank workflow
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((t) => {
          const action = actionTypeById(t.action.type)
          const read = t.trigger.dataset ? `${t.trigger.dataset}:read` : 'public.orders:read'
          return (
            <article key={t.id} className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded-sm bg-light-primary-container text-light-on-primary-container font-label text-label-sm">
                    {t.category}
                  </span>
                  <span className="font-label text-label-sm text-light-on-surface-variant">
                    {action?.preApproved ? 'Pre-approved alert' : 'Approval required'}
                  </span>
                </div>
                <h2 className="font-title text-title-md text-light-on-surface">{t.name}</h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">{t.description}</p>
                <p className="font-mono text-mono-sm text-light-on-surface-variant pt-1 break-words">
                  Scope: {[read, ...(action?.scopes ?? [])].join(' · ')}
                </p>
              </div>
              <Button size="sm" className="w-full" onClick={() => use(t.id)} aria-label={`Use template: ${t.name}`}>
                Use template
              </Button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
