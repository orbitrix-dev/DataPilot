import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { TrustChip } from '../../insights/components/TrustChip'
import { usd } from '../../insights/format'
import type { TrustDependency } from '../../insights/reports'
import { CCHeader, CCTabs, Section, linkClass } from '../components/parts'
import { belowLeadDetail, figures, useCommandCenter, type Alert } from '../signals'

type Risk = { id: string; title: string; detail: string; to: string; linkLabel: string; tone: 'error' | 'warning'; dependsOn?: TrustDependency }

const commercial: Risk[] = [
  {
    id: 'credit',
    title: `Credit exposure: ${usd(figures.overdue60)} over 60 days past due`,
    detail: `${figures.largestOverdue.customer} accounts for ${usd(figures.largestOverdue.amount)} (oldest invoice ${figures.largestOverdueDays} days). ${usd(figures.outstanding)} is outstanding in total.`,
    to: '/insights/receivables',
    linkLabel: 'Receivables',
    tone: 'warning',
    dependsOn: 'invoices',
  },
  {
    id: 'stock-out',
    title: `Stock-out risk: ${figures.belowLead.length} core SKUs`,
    detail: `${belowLeadDetail}.`,
    to: '/intelligence/answers/stockout-risk',
    linkLabel: 'Reorder',
    tone: 'error',
    dependsOn: 'stock',
  },
  {
    id: 'fulfillment',
    title: `Fulfillment hold: -${usd(figures.held.amount)} of this week’s revenue`,
    detail: `${figures.held.orders} Midwest orders are awaiting carrier dispatch.`,
    to: '/intelligence/answers/revenue-decline',
    linkLabel: 'Details',
    tone: 'warning',
    dependsOn: 'stock',
  },
]

function RiskRow({ risk }: { risk: Risk | Alert }) {
  return (
    <div className={cn('p-4 rounded border border-light-outline-variant border-l-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3', risk.tone === 'error' ? 'border-l-error' : 'border-l-warning')}>
      <div className="min-w-0">
        <p className="font-label text-label-lg text-light-on-surface">{risk.title}</p>
        <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">{risk.detail}</p>
        {risk.dependsOn && (
          <div className="mt-1.5">
            <TrustChip dependsOn={risk.dependsOn} link />
          </div>
        )}
      </div>
      <Link to={risk.to} className={cn(linkClass, 'shrink-0')}>
        {risk.linkLabel} →
      </Link>
    </div>
  )
}

/** Business risk overview (designed: command_center_business_risk_overview). */
export function RiskPage() {
  usePageChrome([{ label: 'Command Center', to: '/command-center' }, { label: 'Risk overview' }])
  const { alerts } = useCommandCenter()

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader title="Business risk overview" description="Clear separation between commercial exposure (cash, stock, revenue) and technical data incidents." />
      <CCTabs />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Section title="Commercial & operational risks">
          <div className="flex flex-col gap-3">
            {commercial.map((r) => (
              <RiskRow key={r.id} risk={r} />
            ))}
          </div>
        </Section>

        <Section title="Technical data risks">
          {alerts.technical.length ? (
            <div className="flex flex-col gap-3">
              {alerts.technical.map((a) => (
                <RiskRow key={a.id} risk={a} />
              ))}
            </div>
          ) : (
            <p className="font-body text-body-md text-success flex items-center gap-2">
              <Icon name="check_circle" size={18} /> No open incidents, failing sources or failed automation runs.
            </p>
          )}
        </Section>
      </div>
    </div>
  )
}
