import type { RouteObject } from 'react-router-dom'
import { ActionsPage } from './pages/ActionsPage'
import { ActivityPage } from './pages/ActivityPage'
import { AlertsPage } from './pages/AlertsPage'
import { HealthPage } from './pages/HealthPage'
import { OverviewPage } from './pages/OverviewPage'
import { PerformancePage } from './pages/PerformancePage'
import { RiskPage } from './pages/RiskPage'

/** Command Center routes — relative children of the "/" AppShell route. */
export const commandCenterRoutes: RouteObject[] = [
  { path: 'command-center', element: <OverviewPage /> },
  { path: 'command-center/performance', element: <PerformancePage /> },
  { path: 'command-center/health', element: <HealthPage /> },
  { path: 'command-center/risks', element: <RiskPage /> },
  { path: 'command-center/alerts', element: <AlertsPage /> },
  { path: 'command-center/actions', element: <ActionsPage /> },
  { path: 'command-center/activity', element: <ActivityPage /> },
]
