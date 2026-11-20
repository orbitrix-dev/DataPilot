import { Link, Navigate, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { findAnswer } from '../data'
import { AnomalyAnswer } from './AnomalyAnswer'
import { ComparisonAnswer } from './ComparisonAnswer'
import { ConversationAnswer } from './ConversationAnswer'
import { RecommendationAnswer } from './RecommendationAnswer'

/** `/intelligence/answers/:answerId` — picks the layout designed for the answer's kind. */
export function AnswerPage() {
  const { answerId } = useParams()
  const answer = findAnswer(answerId)
  if (!answer) return <AnswerNotFound />
  switch (answer.kind) {
    case 'conversation':
      return <ConversationAnswer answer={answer} />
    case 'comparison':
      return <ComparisonAnswer answer={answer} />
    case 'anomaly':
      return <AnomalyAnswer answer={answer} />
    case 'recommendation':
      return <RecommendationAnswer answer={answer} />
    case 'forecast':
      return <Navigate to="/intelligence/forecast" replace />
  }
}

function AnswerNotFound() {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Answer not found' }])
  return (
    <section className="max-w-4xl w-full mx-auto bg-light-surface border border-light-outline-variant rounded-md p-8 text-center flex flex-col items-center gap-2">
      <h1 className="font-headline text-headline-md text-light-on-surface">Answer not found</h1>
      <p className="font-body text-body-md text-light-on-surface-variant">This answer link is no longer available.</p>
      <Link to="/intelligence" className="font-label text-label-md text-light-primary hover:underline">
        Ask a new question →
      </Link>
    </section>
  )
}
