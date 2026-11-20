import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { StepPanel } from '../components/StepPanel'
import { dataSourceOption } from '../options'
import { useWizard } from '../wizardState'

export function CompletionStep() {
  const { answers, clearSavedProgress } = useWizard()
  const navigate = useNavigate()
  const toast = useToast()
  const source = dataSourceOption(answers.dataSource)
  const company = answers.companyName.trim()

  const finish = () => {
    toast(`Setup complete — ${company} workspace is ready.`)
    clearSavedProgress()
    navigate('/connect')
  }

  return (
    <StepPanel
      title="Your workspace is ready"
      description={`${company} is connected and verified. Your initial sales and inventory metrics are waiting in the Command Center.`}
      centered={
        <div className="w-12 h-12 rounded-full bg-success-container text-on-success-container flex items-center justify-center">
          <Icon name="check_circle" size={24} />
        </div>
      }
    >
      <dl className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant grid grid-cols-2 gap-4">
        <SummaryItem label="Industry" value={answers.industry} />
        <SummaryItem label="Connected source" value={source.label} />
      </dl>
      <button
        type="button"
        onClick={finish}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-1"
      >
        <span className="font-label text-label-lg">Finish and review connections</span>
        <Icon name="arrow_forward" size={18} />
      </button>
    </StepPanel>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-label text-label-sm uppercase text-light-on-surface-variant">{label}</dt>
      <dd className="font-label text-label-lg text-light-on-surface mt-0.5">{value}</dd>
    </div>
  )
}
