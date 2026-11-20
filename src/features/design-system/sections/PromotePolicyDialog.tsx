import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'

export function PromotePolicyDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirm policy promotion"
      description="Applies validation rules to production."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Promote policy</Button>
        </>
      }
    >
      <p className="font-body text-body-md text-light-on-surface-variant">
        This action enforces strict schema checks across <span className="tabular-nums">42</span> active data connectors.
      </p>
    </Modal>
  )
}
