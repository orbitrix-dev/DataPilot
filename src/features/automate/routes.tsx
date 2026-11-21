import type { RouteObject } from 'react-router-dom'
import { ActionPage } from './pages/ActionPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { BuilderPage } from './pages/BuilderPage'
import { ConditionsPage } from './pages/ConditionsPage'
import { DetailsPage } from './pages/DetailsPage'
import { HistoryPage } from './pages/HistoryPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { OverviewPage } from './pages/OverviewPage'
import { RunLogPage } from './pages/RunLogPage'
import { ScheduledPage } from './pages/ScheduledPage'
import { TriggerPage } from './pages/TriggerPage'

/** Automate module routes — relative children of the "/" AppShell route. */
export const automateRoutes: RouteObject[] = [
  { path: 'automate', element: <OverviewPage /> },
  { path: 'automate/marketplace', element: <MarketplacePage /> },
  { path: 'automate/approvals', element: <ApprovalsPage /> },
  { path: 'automate/scheduled', element: <ScheduledPage /> },
  { path: 'automate/history', element: <HistoryPage /> },
  { path: 'automate/runs/:runId', element: <RunLogPage /> },
  { path: 'automate/workflows/:workflowId', element: <DetailsPage /> },
  { path: 'automate/workflows/:workflowId/builder', element: <BuilderPage /> },
  { path: 'automate/workflows/:workflowId/trigger', element: <TriggerPage /> },
  { path: 'automate/workflows/:workflowId/conditions', element: <ConditionsPage /> },
  { path: 'automate/workflows/:workflowId/action', element: <ActionPage /> },
]
