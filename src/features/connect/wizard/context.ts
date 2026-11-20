import { useOutletContext } from 'react-router-dom'
import type { SourceDataset, SourcePreset } from '../data'

export type SyncMode = 'incremental' | 'full'

export type WizardForm = {
  name: string
  host: string
  port: string
  database: string
  username: string
  secret: string
  schedule: string
  lookback: string
}

export type WizardContextValue = {
  preset: SourcePreset
  form: WizardForm
  setField: (field: keyof WizardForm, value: string) => void
  chooseSource: (sourceId: string) => void
  selected: string[]
  selectedDatasets: SourceDataset[]
  toggleDataset: (name: string) => void
  setAllDatasets: (on: boolean) => void
  modes: Record<string, SyncMode>
  setMode: (name: string, mode: SyncMode) => void
  syncElapsed: number | null
  setSyncElapsed: (s: number) => void
  /** Store id the new connection is saved under (derived from its name). */
  connectionId: string
  /** Writes the new connection into the Connect store. */
  commitConnection: () => void
  goTo: (stepPath: string) => void
}

export function useWizard() {
  return useOutletContext<WizardContextValue>()
}
