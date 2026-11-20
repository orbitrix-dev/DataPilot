import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { OnboardingTopbar } from './components/OnboardingTopbar'
import { StepProgress } from './components/StepProgress'
import { WizardFooter } from './components/WizardFooter'
import { firstBlockedStepBefore, firstStepSlug, stepPath, wizardSteps } from './steps'
import { useWizard } from './wizardState'

/** Route element for /onboarding/:step — topbar, progress stepper, wizard card and footer. */
export function WizardScreen() {
  const { step: slug } = useParams()
  const navigate = useNavigate()
  const { answers } = useWizard()
  // Slug of the step whose validation errors are visible (set after a blocked Continue).
  const [errorSlug, setErrorSlug] = useState<string | null>(null)

  const index = wizardSteps.findIndex((s) => s.slug === slug)
  const step = wizardSteps[index] ?? wizardSteps[0]
  useDocumentTitle(`${step.name} · Guided Onboarding`)

  if (index === -1) return <Navigate to={stepPath(firstStepSlug)} replace />

  // Deep links can't skip past a step whose required input is still missing.
  const blocked = firstBlockedStepBefore(index, answers)
  if (blocked !== -1) return <Navigate to={stepPath(wizardSteps[blocked].slug)} replace />

  const goTo = (target: number) => {
    if (target === index) return
    if (target > index) {
      const firstBlocked = firstBlockedStepBefore(target, answers)
      if (firstBlocked !== -1) {
        setErrorSlug(wizardSteps[firstBlocked].slug)
        if (firstBlocked !== index) navigate(stepPath(wizardSteps[firstBlocked].slug))
        return
      }
    }
    setErrorSlug(null)
    navigate(stepPath(wizardSteps[target].slug))
  }

  const error = errorSlug === step.slug ? (step.validate?.(answers) ?? null) : null
  const { Component } = step

  return (
    <div className="min-h-screen flex flex-col bg-light-surface-variant text-light-on-surface font-body antialiased">
      <OnboardingTopbar />
      <StepProgress current={index} onSelect={goTo} />

      <main className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-2xl bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
          <Component error={error} />
          {!step.hideFooter && (
            <WizardFooter
              canGoBack={index > 0}
              continueLabel={step.continueLabel ?? 'Continue'}
              onBack={() => goTo(index - 1)}
              onContinue={() => goTo(index + 1)}
            />
          )}
        </div>
      </main>
    </div>
  )
}
