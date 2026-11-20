import { Navigate, type RouteObject } from 'react-router-dom'
import { ConnectOverviewPage } from './pages/ConnectOverviewPage'
import { ConnectionDetailsPage } from './pages/ConnectionDetailsPage'
import { ConnectionHealthPage } from './pages/ConnectionHealthPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { SyncHistoryPage } from './pages/SyncHistoryPage'
import { UploadFilesPage } from './pages/UploadFilesPage'
import { AccessStep } from './wizard/AccessStep'
import { DatasetsStep } from './wizard/DatasetsStep'
import { DetailsStep } from './wizard/DetailsStep'
import { ResultsStep } from './wizard/ResultsStep'
import { SourceStep } from './wizard/SourceStep'
import { SyncStep } from './wizard/SyncStep'
import { TestStep } from './wizard/TestStep'
import { WizardLayout } from './wizard/WizardLayout'

/** Connect module routes — relative children of the "/" AppShell route. */
export const connectRoutes: RouteObject[] = [
  { path: 'connect', element: <ConnectOverviewPage /> },
  { path: 'connect/marketplace', element: <MarketplacePage /> },
  { path: 'connect/upload', element: <UploadFilesPage /> },
  { path: 'connect/health', element: <ConnectionHealthPage /> },
  { path: 'connect/history', element: <SyncHistoryPage /> },
  { path: 'connect/connections/:connectionId', element: <ConnectionDetailsPage /> },
  {
    path: 'connect/new',
    element: <WizardLayout />,
    children: [
      { index: true, element: <Navigate to="source" replace /> },
      { path: 'source', element: <SourceStep /> },
      { path: 'details', element: <DetailsStep /> },
      { path: 'access', element: <AccessStep /> },
      { path: 'test', element: <TestStep /> },
      { path: 'datasets', element: <DatasetsStep /> },
      { path: 'sync', element: <SyncStep /> },
      { path: 'results', element: <ResultsStep /> },
    ],
  },
]
