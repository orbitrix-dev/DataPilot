import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { WizardContext, loadAnswers, saveAnswers, type WizardAnswers } from './wizardState'

/** Layout route: owns the wizard answers so they survive step (route) changes. */
export function WizardLayout() {
  const [answers, setAnswers] = useState<WizardAnswers>(loadAnswers)

  useEffect(() => {
    saveAnswers(answers)
  }, [answers])

  const update = useCallback((patch: Partial<WizardAnswers>) => setAnswers((a) => ({ ...a, ...patch })), [])
  // Only clears storage: the layout unmounts as the wizard exits, so in-memory answers go with it.
  const clearSavedProgress = useCallback(() => saveAnswers(null), [])

  const value = useMemo(() => ({ answers, update, clearSavedProgress }), [answers, update, clearSavedProgress])

  return (
    <WizardContext.Provider value={value}>
      <Outlet />
    </WizardContext.Provider>
  )
}
