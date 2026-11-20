import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { TrustChip } from '../components/TrustChip'
import { reports } from '../reports'

/** Reports library (designed: insights_reports_library). */
export function ReportsLibraryPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Reports library' }])
  return (
    <>
      <PageHeader title="Reports library" description="Standardized wholesale & distribution reports with verified Trust lineage." />
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-gutter-md">
        {reports.map((r) => (
          <li key={r.id}>
            <Link
              to={`/insights/reports/${r.id}`}
              className="h-full bg-light-surface border border-light-outline-variant hover:border-light-primary rounded-md p-5 flex flex-col gap-2 transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary"
            >
              <div className="flex justify-between items-start gap-3">
                <h2 className="font-title text-title-md text-light-primary">{r.title}</h2>
                <TrustChip dependsOn={r.dependsOn} />
              </div>
              <p className="font-body text-body-sm text-light-on-surface-variant">
                {r.schedule} · Source: {r.sourceSystem}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
