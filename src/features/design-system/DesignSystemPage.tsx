import { useCallback, useState } from 'react'
import { usePageChrome } from '../../components/layout/ShellContext'
import { useToast } from '../../components/ui/Toast'
import { resources, syncCadences, type Resource, type StatusFilter, type SyncCadence } from './data'
import { ActivityTimeline } from './sections/ActivityTimeline'
import { KpiCards } from './sections/KpiCards'
import { PageIntro } from './sections/PageIntro'
import { PromotePolicyDialog } from './sections/PromotePolicyDialog'
import { ResourceInspector } from './sections/ResourceInspector'
import { ResourceTable } from './sections/ResourceTable'
import { SystemStates } from './sections/SystemStates'
import { ValidationChart } from './sections/ValidationChart'

export function DesignSystemPage() {
  usePageChrome([{ label: 'Workspace', to: '/command-center' }, { label: 'Design system & shell' }])
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('All')
  const [selectedId, setSelectedId] = useState<string>(resources[0].id)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cadences, setCadences] = useState<Record<string, SyncCadence>>({})

  const resetFilters = useCallback(() => {
    setQuery('')
    setStatus('All')
  }, [])
  const closeInspector = useCallback(() => setInspectorOpen(false), [])
  const closeConfirm = useCallback(() => setConfirmOpen(false), [])

  const openInspector = (r: Resource) => {
    setSelectedId(r.id)
    setInspectorOpen(true)
  }

  return (
    <>
      <PageIntro onOpenSidePanel={() => setInspectorOpen(true)} onConfirm={() => setConfirmOpen(true)} />

      <KpiCards />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter-md items-stretch">
        <ValidationChart />
        <ActivityTimeline onRefresh={() => toast('Audit feed refreshed')} />
      </section>

      <ResourceTable
        query={query}
        onQueryChange={setQuery}
        status={status}
        onStatusChange={setStatus}
        selectedId={inspectorOpen ? selectedId : null}
        onSelect={openInspector}
        onExport={() => toast('Export queued for CSV download')}
        onResetFilters={resetFilters}
      />

      <SystemStates onResetFilters={resetFilters} onRetry={() => toast('Retrying sync...')} />

      {inspectorOpen && (
        <ResourceInspector
          resourceId={selectedId}
          cadence={cadences[selectedId] ?? syncCadences[0]}
          onClose={closeInspector}
          onSave={(cadence) => {
            setCadences((prev) => ({ ...prev, [selectedId]: cadence }))
            setInspectorOpen(false)
            toast('Configuration saved')
          }}
        />
      )}

      <PromotePolicyDialog
        open={confirmOpen}
        onClose={closeConfirm}
        onConfirm={() => {
          setConfirmOpen(false)
          toast('Policy promoted to production')
        }}
      />
    </>
  )
}
