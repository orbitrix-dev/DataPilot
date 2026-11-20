import { useEffect } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { FollowUps, } from '../components/AnswerParts'
import { askPath, answerPath, exampleIds, findAnswer } from '../data'
import { matchQuestion } from '../match'
import { recordQuestion } from '../store'
import { reliabilityOf } from '../trust'
import { useInsightsTrust } from '../../insights/trustLink'

/** Location keys already written to history (guards against StrictMode double effects). */
const recorded = new Set<string>()

/**
 * `/intelligence/ask?q=…` — records the question in history, then opens the
 * matching grounded answer. Questions with no grounded answer get an explicit
 * "can't answer from authorized data" reply instead of a guess.
 */
export function AskPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const q = (params.get('q') ?? '').trim()
  const answer = q ? matchQuestion(q) : undefined
  const trust = useInsightsTrust()

  useEffect(() => {
    const key = `${location.key}|${q}`
    if (!q || recorded.has(key)) return
    recorded.add(key)
    if (!answer) {
      recordQuestion({ question: q, sources: [], status: 'unanswered' })
      return
    }
    const r = reliabilityOf(answer, trust)
    recordQuestion({ question: q, answerId: answer.id, sources: answer.sources, status: r.status, qualifiedBy: r.qualifiedBy })
  }, [q, answer, location.key, trust])

  if (!q) return <Navigate to="/intelligence" replace />
  if (answer) return <Navigate to={answerPath(answer)} replace />
  return <NoAnswer question={q} />
}

function NoAnswer({ question }: { question: string }) {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Conversation' }])
  const suggestions = exampleIds.map((id) => findAnswer(id)!).map((a) => ({ label: a.question, to: askPath(a.question) }))
  return (
    <div className="max-w-4xl w-full mx-auto flex flex-col gap-section">
      <div className="self-end bg-light-primary text-light-on-primary rounded-md px-4 py-3 max-w-xl">
        <h1 className="font-body text-body-md break-words">{question}</h1>
      </div>
      <article className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Icon name="info" className="text-info shrink-0 mt-0.5" />
          <div>
            <p className="font-label text-label-lg text-light-on-surface">No grounded answer for this question yet</p>
            <p className="font-body text-body-md text-light-on-surface-variant mt-1 text-pretty">
              DataPilot only answers from your authorized datasets and will not estimate figures it cannot cite. This
              workspace currently covers sales, top products, customer growth, overdue receivables, stock-out risk, revenue
              anomalies and the wholesale forecast. Try rephrasing, or pick one of these:
            </p>
          </div>
        </div>
        <FollowUps items={suggestions} title="Questions DataPilot can answer" />
      </article>
    </div>
  )
}
