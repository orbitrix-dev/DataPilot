import type { RouteObject } from 'react-router-dom'
import { AnswerPage } from './pages/AnswerPage'
import { AskPage } from './pages/AskPage'
import { EvidencePage } from './pages/EvidencePage'
import { ForecastPage } from './pages/ForecastPage'
import { HistoryPage } from './pages/HistoryPage'
import { IntelligenceHomePage } from './pages/IntelligenceHomePage'

/** Intelligence module routes — relative children of the "/" AppShell route. */
export const intelligenceRoutes: RouteObject[] = [
  { path: 'intelligence', element: <IntelligenceHomePage /> },
  { path: 'intelligence/ask', element: <AskPage /> },
  { path: 'intelligence/answers/:answerId', element: <AnswerPage /> },
  { path: 'intelligence/forecast', element: <ForecastPage /> },
  { path: 'intelligence/evidence/:answerId', element: <EvidencePage /> },
  { path: 'intelligence/history', element: <HistoryPage /> },
]
