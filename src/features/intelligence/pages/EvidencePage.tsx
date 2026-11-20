import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { useTrustState } from '../../trust/store'
import { ReliabilityPill, TextLink } from '../components/AnswerParts'
import { answerPath, answers, findAnswer } from '../data'
import { useReliability } from '../trust'

const freshnessTone = {
  'on-time': { label: 'On time', className: 'text-success' },
  stale: { label: 'Stale', className: 'text-warning' },
  breached: { label: 'SLA breached', className: 'text-error' },
} as const

/** Explanation & evidence for one answer (designed: intelligence_explanation_evidence_panel). */
export function EvidencePage() {
  const { answerId } = useParams()
  const answer = findAnswer(answerId) ?? findAnswer('sales-comparison')!
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Explanation & evidence' }])
  const reliability = useReliability(answer)
  const { freshness } = useTrustState()
  const unknown = answerId !== undefined && !findAnswer(answerId)

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Explanation &amp; evidence</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Full auditability of how DataPilot Intelligence computed the answer—including what data is missing.
          </p>
        </div>
        <label className="flex flex-col gap-1 shrink-0">
          <span className="font-label text-label-sm text-light-on-surface-variant">Answer</span>
          <AnswerPicker current={answer.id} />
        </label>
      </div>

      {unknown && (
        <p role="status" className="font-body text-body-sm text-light-on-surface-variant">
          That answer link is not available, so the sales comparison evidence is shown instead.
        </p>
      )}

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-label text-label-sm uppercase text-light-on-surface-variant">Question</span>
          <p className="font-title text-title-lg text-light-on-surface mt-0.5">{answer.question}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ReliabilityPill reliability={reliability} />
          <TextLink to={answerPath(answer)}>Back to answer →</TextLink>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter-md">
        <article className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-3">
          <h2 className="font-title text-title-md text-light-on-surface">Executed query (read-only)</h2>
          <pre className="p-3.5 rounded bg-light-surface-container font-mono text-mono-sm text-light-on-surface overflow-x-auto whitespace-pre">
            {answer.evidence.sql}
          </pre>
          <p className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            Evaluated {answer.evidence.rows.toLocaleString('en-US')} rows · Execution time: {answer.evidence.ms} ms
          </p>
          <p className="font-body text-body-sm text-light-on-surface-variant">
            <strong className="text-light-on-surface">Calculation:</strong> {answer.calculation}
          </p>
        </article>

        <article className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-3">
          <h2 className="font-title text-title-md text-light-on-surface">Missing data disclosure</h2>
          {answer.evidence.missing.length === 0 ? (
            <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex items-start gap-3">
              <Icon name="check_circle" className="text-success shrink-0" />
              <p className="font-body text-body-sm text-light-on-surface-variant">
                Every field this answer needs is available in the cited datasets.
              </p>
            </div>
          ) : (
            answer.evidence.missing.map((m) => (
              <div key={m.title} className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex items-start gap-3">
                <Icon name="info" className="text-info shrink-0" />
                <div>
                  <p className="font-label text-label-md text-light-on-surface">{m.title}</p>
                  <p className="font-body text-body-sm text-light-on-surface-variant mt-1">{m.detail}</p>
                </div>
              </div>
            ))
          )}
        </article>
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <header className="px-5 py-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-title text-title-md text-light-on-surface">Sources &amp; lineage</h2>
          <Link to="/trust/lineage" className="font-label text-label-md text-light-primary hover:underline">
            Open lineage explorer →
          </Link>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
                {['Dataset', 'Freshness', 'Trust status'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-label text-label-sm uppercase text-light-on-surface-variant">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-light-outline-variant">
              {answer.sources.map((s) => {
                const f = freshness.find((r) => r.dataset === s)
                const issue =
                  (s === 'public.invoices' && reliability.qualifiedBy?.startsWith('INC')) ||
                  (s === 'warehouse.stock_levels' && f && f.status !== 'on-time')
                return (
                  <tr key={s}>
                    <td className="px-4 py-3 font-mono text-mono-sm text-light-on-surface">{s}</td>
                    <td className="px-4 py-3 font-body text-body-sm">
                      {f ? (
                        <span className={freshnessTone[f.status].className}>
                          {freshnessTone[f.status].label} · {f.lastUpdated}
                        </span>
                      ) : (
                        <span className="text-light-on-surface-variant">Not monitored</span>
                      )}
                    </td>
                    <td className={cn('px-4 py-3 font-label text-label-md', issue ? 'text-warning' : 'text-success')}>
                      {issue ? (
                        <Link to={reliability.to ?? '/trust'} className="hover:underline">
                          {s === 'public.invoices' ? `Under review (${reliability.qualifiedBy})` : 'Stale feed'}
                        </Link>
                      ) : (
                        'Passing checks'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function AnswerPicker({ current }: { current: string }) {
  const navigate = useNavigate()
  return (
    <select
      value={current}
      onChange={(e) => navigate(`/intelligence/evidence/${e.target.value}`, { replace: true })}
      className="w-full sm:w-80 px-3 py-1.5 rounded border border-light-outline bg-light-surface font-body text-body-sm text-light-on-surface focus:border-light-primary focus:ring-0"
    >
      {answers.map((a) => (
        <option key={a.id} value={a.id}>
          {a.question}
        </option>
      ))}
    </select>
  )
}
