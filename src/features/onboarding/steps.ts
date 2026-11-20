import type { ComponentType } from 'react'
import type { StepProps, WizardAnswers } from './wizardState'
import { WelcomeStep } from './steps/WelcomeStep'
import { OrganizationStep } from './steps/OrganizationStep'
import { IndustryStep } from './steps/IndustryStep'
import { BusinessSizeStep } from './steps/BusinessSizeStep'
import { ObjectivesStep } from './steps/ObjectivesStep'
import { DataSourceStep } from './steps/DataSourceStep'
import { DataScanStep } from './steps/DataScanStep'
import { CompletionStep } from './steps/CompletionStep'

export type WizardStep = {
  slug: string
  /** Shown beside the step counter and used for the document title. */
  name: string
  /** Short name used in the stepper segment's accessible label. */
  shortName: string
  Component: ComponentType<StepProps>
  /** Returns an error message when the step's required input is missing. */
  validate?: (answers: WizardAnswers) => string | null
  continueLabel?: string
  /** The final step renders its own call to action instead of Back / Continue. */
  hideFooter?: boolean
}

export const wizardSteps: WizardStep[] = [
  { slug: 'welcome', name: 'Welcome to DataPilot', shortName: 'Welcome', Component: WelcomeStep },
  {
    slug: 'organization',
    name: 'Organization details',
    shortName: 'Organization details',
    Component: OrganizationStep,
    validate: (a) => (a.companyName.trim() ? null : 'Please enter your company name to continue.'),
  },
  { slug: 'industry', name: 'Industry selection', shortName: 'Industry selection', Component: IndustryStep },
  { slug: 'business-size', name: 'Business size', shortName: 'Business size', Component: BusinessSizeStep },
  {
    slug: 'objectives',
    name: 'Business objectives',
    shortName: 'Business objectives',
    Component: ObjectivesStep,
    validate: (a) => (a.objectives.length > 0 ? null : 'Select at least one goal to continue.'),
  },
  { slug: 'data-source', name: 'Connect first data source', shortName: 'Connect first data source', Component: DataSourceStep },
  {
    slug: 'data-scan',
    name: 'Initial data scan',
    shortName: 'Initial data scan',
    Component: DataScanStep,
    continueLabel: 'Finish setup',
  },
  { slug: 'complete', name: 'Setup complete', shortName: 'Completion', Component: CompletionStep, hideFooter: true },
]

export const firstStepSlug = wizardSteps[0].slug

export function stepPath(slug: string) {
  return `/onboarding/${slug}`
}

/** Index of the first step before `target` whose required input is missing, or -1. */
export function firstBlockedStepBefore(target: number, answers: WizardAnswers): number {
  return wizardSteps.slice(0, target).findIndex((s) => s.validate?.(answers))
}
