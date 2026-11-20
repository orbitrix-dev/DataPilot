import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { OptionCard } from '../components/OptionCard'
import { StepPanel } from '../components/StepPanel'
import { industries } from '../options'
import { useWizard } from '../wizardState'

export function IndustryStep() {
  const { answers, update } = useWizard()
  return (
    <StepPanel
      title="What industry are you in?"
      description="We tailor your starting metrics and reliability checks to match how your business operates."
    >
      <div role="radiogroup" aria-label="Industry" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {industries.map((ind) => {
          const checked = answers.industry === ind.value
          return (
            <OptionCard
              key={ind.value}
              type="radio"
              name="industry"
              value={ind.value}
              checked={checked}
              onChange={() => update({ industry: ind.value })}
              className="p-4 flex items-center gap-3"
            >
              <Icon
                name={ind.icon}
                size={20}
                className={cn(checked ? 'text-light-primary' : 'text-light-on-surface-variant')}
              />
              <span className="font-label text-label-lg text-light-on-surface">{ind.value}</span>
            </OptionCard>
          )
        })}
      </div>
    </StepPanel>
  )
}
