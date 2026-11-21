import { usePageChrome } from '../../../components/layout/ShellContext'
import { ActionCard, CCHeader, CCTabs } from '../components/parts'
import { useCommandCenter } from '../signals'

/** Recommended actions (designed: command_center_recommended_actions). */
export function ActionsPage() {
  usePageChrome([{ label: 'Command Center', to: '/command-center' }, { label: 'Recommended actions' }])
  const { actions, openActions } = useCommandCenter()

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader
        title="Recommended actions"
        description="Evidence-backed operational recommendations. Every action routes to human review before execution."
      />
      <CCTabs />
      <p className="font-body text-body-sm text-light-on-surface-variant -mt-2" role="status">
        {openActions.length} open · {actions.length - openActions.length} done this session. Nothing is executed from this page.
      </p>
      <div className="flex flex-col gap-4">
        {actions.map((a) => (
          <ActionCard key={a.id} action={a} />
        ))}
      </div>
    </div>
  )
}
