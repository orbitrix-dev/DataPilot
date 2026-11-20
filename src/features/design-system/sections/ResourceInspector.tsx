import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Drawer } from '../../../components/ui/Drawer'
import { syncCadences, type SyncCadence } from '../data'

/**
 * Slide-over "Resource Inspector" form. Mount it only while open so the draft
 * cadence re-initialises from `cadence` every time the panel opens.
 */
export function ResourceInspector({
  resourceId,
  cadence,
  onClose,
  onSave,
}: {
  resourceId: string
  cadence: SyncCadence
  onClose: () => void
  onSave: (cadence: SyncCadence) => void
}) {
  const [draft, setDraft] = useState<SyncCadence>(cadence)

  return (
    <Drawer
      open
      onClose={onClose}
      title="Resource Inspector"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="resource-inspector-form">
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="resource-inspector-form"
        className="flex flex-col gap-gutter-md"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(draft)
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-label text-label-md text-light-on-surface">Resource identifier</span>
          <input
            type="text"
            value={resourceId}
            readOnly
            className="px-3 py-2 rounded border border-light-outline bg-light-surface-container-low font-mono text-mono-sm text-light-on-surface"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-label text-label-md text-light-on-surface">Sync cadence</span>
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value as SyncCadence)}
            className="px-3 py-2 rounded border border-light-outline bg-light-surface text-body-md text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary"
          >
            {syncCadences.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </form>
    </Drawer>
  )
}
