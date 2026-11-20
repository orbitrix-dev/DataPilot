import { OptionCard } from '../components/OptionCard'
import { StepPanel } from '../components/StepPanel'
import { objectives, type Objective } from '../options'
import { useWizard, type StepProps } from '../wizardState'

export function ObjectivesStep({ error }: StepProps) {
  const { answers, update } = useWizard()

  const toggle = (goal: Objective) => {
    const selected = answers.objectives.includes(goal)
      ? answers.objectives.filter((g) => g !== goal)
      : objectives.filter((g) => g === goal || answers.objectives.includes(g))
    update({ objectives: selected })
  }

  return (
    <StepPanel
      title="What are your top goals?"
      description="Select one or more priorities. We will highlight these first in your Command Center."
    >
      <fieldset className="flex flex-col gap-2.5" aria-describedby={error ? 'objectives-error' : undefined}>
        <legend className="sr-only">Business objectives</legend>
        {objectives.map((goal) => (
          <OptionCard
            key={goal}
            type="checkbox"
            name="objectives"
            value={goal}
            checked={answers.objectives.includes(goal)}
            onChange={() => toggle(goal)}
            className="p-3.5 flex items-center gap-3"
          >
            <span className="font-label text-label-lg text-light-on-surface">{goal}</span>
          </OptionCard>
        ))}
        {error && (
          <span id="objectives-error" role="alert" className="font-body text-body-sm text-error">
            {error}
          </span>
        )}
      </fieldset>
    </StepPanel>
  )
}
