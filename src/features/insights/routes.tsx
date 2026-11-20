import type { RouteObject } from 'react-router-dom'
import { CustomerAnalyticsPage } from './pages/CustomerAnalyticsPage'
import { ExecutiveDashboardPage } from './pages/ExecutiveDashboardPage'
import { InventoryAnalyticsPage } from './pages/InventoryAnalyticsPage'
import { MetricExplorerPage } from './pages/MetricExplorerPage'
import { ProductAnalyticsPage } from './pages/ProductAnalyticsPage'
import { PurchaseAnalyticsPage } from './pages/PurchaseAnalyticsPage'
import { ReceivablesAnalyticsPage } from './pages/ReceivablesAnalyticsPage'
import { ReportDetailsPage } from './pages/ReportDetailsPage'
import { ReportsLibraryPage } from './pages/ReportsLibraryPage'
import { SalesAnalyticsPage } from './pages/SalesAnalyticsPage'

/** Insights module routes — relative children of the "/" AppShell route. */
export const insightsRoutes: RouteObject[] = [
  { path: 'insights', element: <ExecutiveDashboardPage /> },
  { path: 'insights/sales', element: <SalesAnalyticsPage /> },
  { path: 'insights/customers', element: <CustomerAnalyticsPage /> },
  { path: 'insights/products', element: <ProductAnalyticsPage /> },
  { path: 'insights/inventory', element: <InventoryAnalyticsPage /> },
  { path: 'insights/purchases', element: <PurchaseAnalyticsPage /> },
  { path: 'insights/receivables', element: <ReceivablesAnalyticsPage /> },
  { path: 'insights/metrics', element: <MetricExplorerPage /> },
  { path: 'insights/reports', element: <ReportsLibraryPage /> },
  { path: 'insights/reports/:reportId', element: <ReportDetailsPage /> },
]
