import { Badge } from '../../../components/ui/Badge'
import { OptionCard } from '../components/OptionCard'
import { StepPanel } from '../components/StepPanel'
import { dataSources } from '../options'
import { useWizard } from '../wizardState'

export function DataSourceStep() {
  const { answers, update } = useWizard()
  return (
    <StepPanel
      title="Connect your first data source"
      description="Pick the main system where your sales or accounting records live. DataPilot uses read-only access and never changes your original records."
    >
      <div role="radiogroup" aria-label="Data source" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {dataSources.map((src) => (
          <OptionCard
            key={src.value}
            type="radio"
            name="source"
            value={src.value}
            checked={answers.dataSource === src.value}
            onChange={() => update({ dataSource: src.value, scanComplete: false })}
            className="p-4 flex items-center gap-3"
          >
            <span className="flex-1 font-label text-label-lg text-light-on-surface">{src.label}</span>
            {src.popular && <Badge tone="success">Popular</Badge>}
          </OptionCard>
        ))}
      </div>
    </StepPanel>
  )
}
