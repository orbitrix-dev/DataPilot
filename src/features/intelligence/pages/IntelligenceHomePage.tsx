import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { askPath, exampleIds, findAnswer } from '../data'
import { useIntelligenceState } from '../store'

const card =
  'bg-light-surface border border-light-outline-variant hover:border-light-primary rounded-md transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary'

/** Intelligence home (designed: intelligence_home). */
export function IntelligenceHomePage() {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Assistant home' }])
  const navigate = useNavigate()
  const { lastAnswerId } = useIntelligenceState()
  const [question, setQuestion] = useState('')
  const [error, setError] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q) {
      setError(true)
      return
    }
    navigate(askPath(q))
  }

  const examples = exampleIds.map((id) => findAnswer(id)!)

  return (
    <div className="max-w-4xl w-full mx-auto flex flex-col gap-section">
      <div className="flex justify-end -mb-4">
        <Link
          to="/intelligence/history"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-light-outline bg-light-surface hover:bg-light-surface-container font-label text-label-md text-light-on-surface"
        >
          <Icon name="history" size={16} />
          History
        </Link>
      </div>

      <div className="text-center flex flex-col items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-light-primary-container text-light-on-primary-container font-label text-label-sm">
          <Icon name="verified_user" size={15} />
          Grounded in your authorized Acme Global Corp datasets
        </span>
        <h1 className="font-headline text-headline-lg text-light-on-surface mt-1">Ask DataPilot Intelligence</h1>
        <p className="font-body text-body-md text-light-on-surface-variant max-w-xl text-pretty">
          Ask questions in plain English. Every answer cites its exact data source, freshness, Trust status, and calculation
          method.
        </p>
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col gap-1.5">
        <div
          className={cn(
            'bg-light-surface border rounded-md p-2 flex items-center gap-2 shadow-sm focus-within:border-light-primary',
            error ? 'border-error' : 'border-light-outline',
          )}
        >
          <Icon name="search" className="text-light-on-surface-variant pl-2 shrink-0" />
          <label htmlFor="ask-input" className="sr-only">
            Ask a business question
          </label>
          <input
            id="ask-input"
            type="text"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value)
              if (error) setError(false)
            }}
            aria-invalid={error}
            aria-describedby={error ? 'ask-error' : undefined}
            placeholder="Ask about sales, overdue invoices, inventory risk, or forecasts..."
            className="flex-1 min-w-0 border-0 bg-transparent font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-1"
          >
            Ask
          </button>
        </div>
        {error && (
          <p id="ask-error" role="alert" className="font-body text-body-sm text-error pl-1">
            Type a question first.
          </p>
        )}
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="font-title text-title-md text-light-on-surface">Example business questions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {examples.map((a) => (
            <Link key={a.id} to={askPath(a.question)} className={cn(card, 'p-4 flex items-center justify-between gap-3')}>
              <span className="font-body text-body-md text-light-on-surface">{a.question}</span>
              <Icon name="arrow_forward" size={18} className="text-light-primary shrink-0" />
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md pt-2">
        <Link to="/intelligence/forecast" className={cn(card, 'p-4')}>
          <span className="font-title text-title-md text-light-primary">Forecasting workspace →</span>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Projected demand &amp; revenue with explicit forecast labels.
          </p>
        </Link>
        <Link to={askPath(findAnswer('revenue-decline')!.question)} className={cn(card, 'p-4')}>
          <span className="font-title text-title-md text-light-primary">Anomaly explanations →</span>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Evidence-backed breakdowns of unexpected metric shifts.
          </p>
        </Link>
        <Link to={`/intelligence/evidence/${lastAnswerId ?? 'sales-comparison'}`} className={cn(card, 'p-4')}>
          <span className="font-title text-title-md text-light-primary">Evidence &amp; lineage →</span>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Inspect SQL, row counts, and missing-data disclosures.
          </p>
        </Link>
      </section>
    </div>
  )
}
