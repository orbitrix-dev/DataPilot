import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { EmptyState } from '../../connect/components/EmptyState'
import { slugify } from '../../connect/format'
import { thClass } from '../../connect/styles'
import { TrustChip } from '../components/TrustChip'
import { findReport, reportCsv, type ReportCell } from '../reports'
import { useInsightsTrust } from '../trustLink'

const toneClass: Record<NonNullable<ReportCell['tone']>, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
}

/** Report details (designed: insights_report_details, for the gross margin report; the others use the same layout). */
export function ReportDetailsPage() {
  const { reportId } = useParams()
  const report = findReport(reportId)
  usePageChrome([
    { label: 'Insights', to: '/insights' },
    { label: 'Reports library', to: '/insights/reports' },
    { label: report ? 'Report details' : 'Report not found' },
  ])
  const toast = useToast()
  const trust = useInsightsTrust()

  if (!report) {
    return (
      <div className="bg-light-surface border border-light-outline-variant rounded-md">
        <EmptyState icon="description" title="Report not found">
          <Link to="/insights/reports" className="text-light-primary hover:underline">
            Back to the reports library
          </Link>
        </EmptyState>
      </div>
    )
  }

  const flagged =
    (report.dependsOn === 'invoices' && trust.invoicesUnderReview) || (report.dependsOn === 'stock' && trust.stockStale)
  const status = flagged ? 'Under review in Trust' : 'Verified 4m ago'

  function exportCsv() {
    const blob = new Blob([reportCsv(report!)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(report!.title)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast(`Exported ${report!.rows.length} rows to CSV`)
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-headline text-headline-lg text-light-on-surface">{report.title}</h1>
            <TrustChip dependsOn={report.dependsOn} link />
          </div>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Source: {report.sourceSystem} (
            {report.tables.map((t, i) => (
              <span key={t}>
                {i > 0 && ', '}
                <code className="font-mono text-mono-sm">{t}</code>
              </span>
            ))}
            ) · {status} · {report.schedule}
          </p>
        </div>
        <Button icon="download" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden font-body text-body-md text-light-on-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">{report.title}</caption>
            <thead className="bg-light-surface-container border-b border-light-outline-variant">
              <tr>
                {report.columns.map((c) => (
                  <th key={c.header} scope="col" className={cn(thClass, c.align === 'right' && 'text-right')}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-light-outline-variant">
              {report.rows.map((row) => (
                <tr key={row[0].text} className="hover:bg-light-surface-container-low">
                  {row.map((cell, i) => (
                    <td
                      key={report.columns[i].header}
                      className={cn(
                        'px-4 py-3',
                        report.columns[i].align === 'right' && 'text-right tabular-nums',
                        report.columns[i].mono && 'font-mono text-mono-sm',
                        cell.tone && toneClass[cell.tone],
                      )}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {report.total && (
              <tfoot className="border-t border-light-outline bg-light-surface-container-low">
                <tr>
                  {report.total.map((cell, i) => (
                    <td
                      key={report.columns[i].header}
                      className={cn('px-4 py-3 font-label text-label-lg', report.columns[i].align === 'right' && 'text-right tabular-nums')}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  )
}
