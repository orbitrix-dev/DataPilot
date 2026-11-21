import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { formatNumber } from '../../connect/format'
import { AdminHeader, AdminPage, BillingTabs, Meter } from '../components/parts'
import { linkClass } from '../styles'
import { formatRows, useUsage } from '../usage'

/** Usage Overview (designed: admin_usage_overview). Sources and rows come from Connect, seats from Users. */
export function UsagePage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Usage Overview' }])
  const { sources, rows, storageGb, seats, plan } = useUsage()

  return (
    <AdminPage>
      <BillingTabs />
      <AdminHeader title="Usage Overview" description={`Current billing cycle consumption (Nov 1 – Nov 30) on ${plan.name} plan.`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Meter label="Connected Sources" value={`${sources} / ${plan.sources}`} used={sources} limit={plan.sources} note="file uploads not counted" />
        <Meter label="Rows Processed" value={`${formatRows(rows)} / ${formatRows(plan.rows)}`} used={rows} limit={plan.rows} note={`${formatNumber(rows)} rows`} />
        <Meter label="Storage Used" value={`${storageGb} / ${plan.storageGb} GB`} used={storageGb} limit={plan.storageGb} />
        <Meter label="User Seats" value={`${seats} / ${plan.seats}`} used={seats} limit={plan.seats} note="includes pending invites" />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Link to="/connect" className={linkClass}>
          Manage sources in Connect →
        </Link>
        <Link to="/users-permissions" className={linkClass}>
          Manage users →
        </Link>
        <Link to="/billing" className={linkClass}>
          Change plan →
        </Link>
      </div>
    </AdminPage>
  )
}
