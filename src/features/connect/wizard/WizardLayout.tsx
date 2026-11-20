import { useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { WizardStepper } from '../components/WizardStepper'
import { lookbackOptions, sourcePresets, syncScheduleOptions, wizardSteps, type SourcePreset } from '../data'
import { NOW_ISO, formatNumber, slugify } from '../format'
import { upsertConnection } from '../store'
import type { SyncMode, WizardContextValue, WizardForm } from './context'

function presetFor(sourceId: string | null): SourcePreset {
  return sourcePresets.find((p) => p.sourceId === sourceId) ?? sourcePresets[0]
}

function formFor(p: SourcePreset): WizardForm {
  return {
    name: p.connectionName,
    host: p.host,
    port: p.port,
    database: p.database,
    username: p.username,
    secret: 'stored-secret',
    schedule: syncScheduleOptions[0],
    lookback: lookbackOptions[0],
  }
}

function defaultSelection(p: SourcePreset) {
  return p.datasets.filter((d) => d.defaultSelected).map((d) => d.name)
}

/**
 * Route element for `connect/new/*`. Holds the wizard state shared by all 7
 * steps (via Outlet context) and renders the workflow bar above each step.
 */
export function WizardLayout() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [preset, setPreset] = useState(() => presetFor(params.get('source')))
  const [form, setForm] = useState(() => formFor(preset))
  const [selected, setSelected] = useState(() => defaultSelection(preset))
  const [modes, setModes] = useState<Record<string, SyncMode>>({})
  const [syncElapsed, setSyncElapsed] = useState<number | null>(null)

  const stepIndex = Math.max(
    0,
    wizardSteps.findIndex((s) => pathname.endsWith(`/${s.path}`)),
  )

  usePageChrome([
    { label: 'Connect', to: '/connect' },
    { label: `New connection — Step ${stepIndex + 1} of ${wizardSteps.length}` },
  ])

  const setField = useCallback((field: keyof WizardForm, value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
  }, [])

  const chooseSource = useCallback(
    (sourceId: string) => {
      if (sourceId === preset.sourceId) return
      const next = presetFor(sourceId)
      setPreset(next)
      setForm(formFor(next))
      setSelected(defaultSelection(next))
      setModes({})
      setSyncElapsed(null)
    },
    [preset.sourceId],
  )

  const value = useMemo<WizardContextValue>(() => {
    const selectedDatasets = preset.datasets.filter((d) => selected.includes(d.name))
    const connectionId = slugify(form.name) || slugify(preset.connectionName)
    return {
      preset,
      form,
      setField,
      chooseSource,
      selected,
      selectedDatasets,
      toggleDataset: (name) =>
        setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name])),
      setAllDatasets: (on) => setSelected(on ? preset.datasets.map((d) => d.name) : []),
      modes,
      setMode: (name, mode) => setModes((m) => ({ ...m, [name]: mode })),
      syncElapsed,
      setSyncElapsed,
      connectionId,
      commitConnection: () => {
        const records = selectedDatasets.reduce((sum, d) => sum + d.rows, 0)
        upsertConnection({
          id: connectionId,
          name: form.name,
          endpoint: form.host,
          sourceType: preset.label,
          kind: preset.sourceId === 'postgresql' || preset.sourceId === 'mysql' ? 'database' : 'cloud',
          status: 'healthy',
          records,
          recordsLabel: formatNumber(records),
          lastSync: NOW_ISO,
          accessLevel: 'Read-only (TLS 1.3)',
          credentials: [
            { label: preset.usernameLabel.replace(/^Read-only /, '').replace(/^u/, 'U'), value: form.username },
            { label: 'Password / Secret', value: '••••••••••••••••', secret: true },
          ],
          issue: undefined,
        })
      },
      goTo: (stepPath) => navigate(`/connect/new/${stepPath}`),
    }
  }, [preset, form, setField, chooseSource, selected, modes, syncElapsed, navigate])

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <WizardStepper current={stepIndex} />
      <Outlet context={value} />
    </div>
  )
}
