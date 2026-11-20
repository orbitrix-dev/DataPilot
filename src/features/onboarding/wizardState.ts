import { createContext, useContext } from 'react'
import type { BusinessSize, Currency, DataSource, Industry, Objective, Role } from './options'

export type WizardAnswers = {
  companyName: string
  role: Role
  currency: Currency
  industry: Industry
  businessSize: BusinessSize
  objectives: Objective[]
  dataSource: DataSource
  /** Set once the initial data scan has run to 100%, so revisiting step 7 doesn't restart it. */
  scanComplete: boolean
}

export const defaultAnswers: WizardAnswers = {
  companyName: '',
  role: 'Founder / Business Owner',
  currency: 'USD ($)',
  industry: 'Distribution',
  businessSize: '11-50',
  objectives: ['Understand sales performance', 'Monitor inventory'],
  dataSource: 'QuickBooks Online',
  scanComplete: false,
}

export type WizardContextValue = {
  answers: WizardAnswers
  update: (patch: Partial<WizardAnswers>) => void
  /** Forget saved progress (called when the wizard is finished). */
  clearSavedProgress: () => void
}

export const WizardContext = createContext<WizardContextValue | null>(null)

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizard must be used inside the onboarding layout route')
  return ctx
}

/** Props every step component receives. `error` is set only after a blocked Continue. */
export type StepProps = { error: string | null }

const STORAGE_KEY = 'datapilot.onboarding'

/** Restores saved progress; falls back to defaults when storage is unavailable or stale. */
export function loadAnswers(): WizardAnswers {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultAnswers
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultAnswers
    return { ...defaultAnswers, ...(parsed as Partial<WizardAnswers>) }
  } catch {
    return defaultAnswers
  }
}

export function saveAnswers(answers: WizardAnswers | null) {
  try {
    if (answers) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode etc.) — progress simply isn't persisted.
  }
}
