import { OptionCard } from '../components/OptionCard'
import { StepPanel } from '../components/StepPanel'
import { businessSizes } from '../options'
import { useWizard } from '../wizardState'

export function BusinessSizeStep() {
  const { answers, update } = useWizard()
  return (
    <StepPanel
      title="How large is your team?"
      description="Helps us recommend the right workspace permissions and sync schedule."
    >
      <div role="radiogroup" aria-label="Team size" className="flex flex-col gap-2.5">
        {businessSizes.map((size) => (
          <OptionCard
            key={size.value}
            type="radio"
            name="size"
            value={size.value}
            checked={answers.businessSize === size.value}
            onChange={() => update({ businessSize: size.value })}
            className="p-3.5 flex items-center gap-3"
          >
            <span className="flex-1 font-label text-label-lg text-light-on-surface tabular-nums">{size.label}</span>
            <span className="font-body text-body-sm text-light-on-surface-variant">{size.tier}</span>
          </OptionCard>
        ))}
      </div>
    </StepPanel>
  )
}
