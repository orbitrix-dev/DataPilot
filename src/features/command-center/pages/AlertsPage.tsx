import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { AlertCard, CCHeader, CCTabs } from '../components/parts'
import { useCommandCenter } from '../signals'

/** Alerts & notifications (designed: command_center_alerts_notifications). */
export function AlertsPage() {
  usePageChrome([{ label: 'Command Center', to: '/command-center' }, { label: 'Alerts & notifications' }])
  const { alerts } = useCommandCenter()

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader
        title="Alerts & notifications"
        description="Business risks are separated from technical data incidents, with direct links to each module."
      />
      <CCTabs />

      <section aria-labelledby="business-alerts" className="flex flex-col gap-3">
        <h2 id="business-alerts" className="font-title text-title-md text-light-on-surface">
          Business alerts ({alerts.business.length})
        </h2>
        {alerts.business.map((a) => (
          <AlertCard key={a.id} alert={a} />
        ))}
      </section>

      <section aria-labelledby="technical-alerts" className="flex flex-col gap-3">
        <h2 id="technical-alerts" className="font-title text-title-md text-light-on-surface">
          Technical data incidents ({alerts.technical.length})
        </h2>
        {alerts.technical.length ? (
          alerts.technical.map((a) => <AlertCard key={a.id} alert={a} />)
        ) : (
          <p className="p-4 rounded-md border border-light-outline-variant bg-light-surface font-body text-body-md text-success flex items-center gap-2">
            <Icon name="check_circle" size={18} /> No open Trust incidents, failing sources or failed automation runs.
          </p>
        )}
      </section>
    </div>
  )
}
