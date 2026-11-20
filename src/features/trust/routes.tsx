import type { RouteObject } from 'react-router-dom'
import { FreshnessPage } from './pages/FreshnessPage'
import { ImpactPage } from './pages/ImpactPage'
import { IncidentDetailsPage } from './pages/IncidentDetailsPage'
import { IncidentListPage } from './pages/IncidentListPage'
import { LineagePage } from './pages/LineagePage'
import { QualityDashboardPage } from './pages/QualityDashboardPage'
import { QualityRulesPage } from './pages/QualityRulesPage'
import { RootCausePage } from './pages/RootCausePage'
import { SchemaChangesPage } from './pages/SchemaChangesPage'
import { TrustOverviewPage } from './pages/TrustOverviewPage'

/** Trust module routes — relative children of the "/" AppShell route. */
export const trustRoutes: RouteObject[] = [
  { path: 'trust', element: <TrustOverviewPage /> },
  { path: 'trust/quality', element: <QualityDashboardPage /> },
  { path: 'trust/rules', element: <QualityRulesPage /> },
  { path: 'trust/freshness', element: <FreshnessPage /> },
  { path: 'trust/schema', element: <SchemaChangesPage /> },
  { path: 'trust/lineage', element: <LineagePage /> },
  { path: 'trust/incidents', element: <IncidentListPage /> },
  { path: 'trust/incidents/:incidentId', element: <IncidentDetailsPage /> },
  { path: 'trust/incidents/:incidentId/root-cause', element: <RootCausePage /> },
  { path: 'trust/impact', element: <ImpactPage /> },
]
