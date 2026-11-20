import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { adminNav, platformNav } from '../components/layout/navigation'
import { ModulePlaceholder } from '../pages/ModulePlaceholder'
import { NotFound } from '../pages/NotFound'
import { designSystemRoutes } from '../features/design-system/routes'
import { authRoutes } from '../features/auth/routes'
import { onboardingRoutes } from '../features/onboarding/routes'

/**
 * Feature modules register their routes here.
 * - `shellRoutes` render inside <AppShell> (sidebar + topbar).
 * - `publicRoutes` render full-screen (auth, onboarding).
 * A feature route with the same path as a placeholder replaces it.
 */
const shellRoutes: RouteObject[] = [
  // feature:shell-routes
  ...designSystemRoutes,
]

const publicRoutes: RouteObject[] = [
  // feature:public-routes
  ...authRoutes,
  ...onboardingRoutes,
]

const featurePaths = new Set(shellRoutes.map((r) => r.path?.split('/')[0]))
const placeholders: RouteObject[] = [...platformNav, ...adminNav]
  .filter((n) => !featurePaths.has(n.to.slice(1)))
  .map((n) => ({ path: n.to.slice(1), element: <ModulePlaceholder title={n.label} icon={n.icon} /> }))

export const router = createBrowserRouter([
  ...publicRoutes,
  {
    path: '/',
    element: <AppShell />,
    children: [{ index: true, element: <Navigate to="/command-center" replace /> }, ...placeholders, ...shellRoutes],
  },
  { path: '*', element: <NotFound /> },
])
