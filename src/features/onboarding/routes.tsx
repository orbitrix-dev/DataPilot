import { Navigate, type RouteObject } from 'react-router-dom'
import { WizardLayout } from './WizardLayout'
import { WizardScreen } from './WizardScreen'
import { firstStepSlug, stepPath } from './steps'

/** Full-screen onboarding wizard; each step is deep-linkable at /onboarding/:step. */
export const onboardingRoutes: RouteObject[] = [
  {
    path: '/onboarding',
    element: <WizardLayout />,
    children: [
      { index: true, element: <Navigate to={stepPath(firstStepSlug)} replace /> },
      { path: ':step', element: <WizardScreen /> },
    ],
  },
]
