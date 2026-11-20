import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { askPath, answerPath, findAnswer, type HistoryEntry, type HistoryStatus } from '../data'
import { useIntelligenceState } from '../store'

type Filter = 'all' | HistoryStatus

const statusMeta: Record<HistoryStatus, { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'bg-success-container text-on-success-container' },
  qualified: { label: 'Qualified', className: 'bg-warning-container text-on-warning-container' },
  forecast: { label: 'Forecast', className: 'bg-info-container text-on-info-container' },
  unanswered: { label: 'No answer', className: 'bg-light-surface-container text-light-on-surface-variant' },
}

/** Conversation history (designed: intelligence_conversation_history). */
export function HistoryPage() {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Conversation history' }])
  const { history } = useIntelligenceState()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const count = (f: Filter) => (f === 'all' ? history.length : history.filter((h) => h.status === f).length)
  const filters: Filter[] = ['all', 'verified', 'qualified', 'forecast', ...(count('unanswered') ? (['unanswered'] as const) : [])]

  const q = query.trim().toLowerCase()
  const rows = history.filter(
    (h) =>
      (filter === 'all' || h.status === filter) &&
      (!q || h.question.toLowerCase().includes(q) || h.sources.some((s) => s.toLowerCase().includes(q))),
  )

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-headline text-headline-md text-light-on-surface">Conversation history</h1>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
            Auditable log of natural-language queries, cited sources, and Trust reliability status at query time.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Icon name="search" size={18} className="text-light-on-surface-variant absolute left-3 top-2" />
          <label htmlFor="history-search" className="sr-only">
            Search questions or datasets
          </label>
          <input
            id="history-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions or datasets..."
            className="w-full pl-9 pr-3 py-1.5 rounded border border-light-outline bg-light-surface font-body text-body-sm text-light-on-surface placeholder:text-light-on-surface-variant focus:border-light-primary focus:ring-0"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by Trust status">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1 rounded-full font-label text-label-md transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
              filter === f
                ? 'bg-light-primary text-light-on-primary'
                : 'bg-light-surface border border-light-outline-variant text-light-on-surface-variant hover:bg-light-surface-container',
            )}
          >
            {f === 'all' ? 'All' : statusMeta[f].label} ({count(f)})
          </button>
        ))}
      </div>

      <div className="bg-light-surface border border-light-outline-variant rounded-md overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              {['Question', 'Sources cited', 'Trust status', 'Asked'].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant">
                  {h}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {rows.map((h) => (
              <HistoryRow key={h.id} entry={h} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-body text-body-sm text-light-on-surface-variant">
                  No questions match{q ? ` “${query.trim()}”` : ''}.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setFilter('all')
                    }}
                    className="font-label text-light-primary hover:underline"
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const answer = findAnswer(entry.answerId)
  const meta = statusMeta[entry.status]
  return (
    <tr>
      <td className="px-4 py-3.5 font-label text-label-md text-light-on-surface">{entry.question}</td>
      <td className="px-4 py-3.5 font-mono text-mono-sm text-light-on-surface-variant">
        {entry.sources.length ? entry.sources.join(', ') : '—'}
      </td>
      <td className="px-4 py-3.5">
        <span className={cn('px-2 py-0.5 rounded font-label text-label-sm whitespace-nowrap', meta.className)}>
          {meta.label}
          {entry.qualifiedBy ? ` · ${entry.qualifiedBy}` : ''}
        </span>
      </td>
      <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface-variant whitespace-nowrap">{entry.asked}</td>
      <td className="px-4 py-3.5 text-right whitespace-nowrap">
        <Link
          to={answer ? answerPath(answer) : askPath(entry.question)}
          className="font-label text-label-md text-light-primary hover:underline"
          aria-label={`${answer ? 'Reopen' : 'Ask again'}: ${entry.question}`}
        >
          {answer ? 'Reopen' : 'Ask again'} →
        </Link>
      </td>
    </tr>
  )
}
