import { cn } from '../../../lib/cn'
import { wizardSteps } from '../steps'

type StepProgressProps = {
  current: number
  onSelect: (index: number) => void
}

/** "Step N of 8" counter plus 8 clickable segments (completed / current / upcoming). */
export function StepProgress({ current, onSelect }: StepProgressProps) {
  const total = wizardSteps.length
  return (
    <div className="bg-light-surface border-b border-light-outline-variant px-4 lg:px-8 py-4">
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-label text-label-md text-light-primary tabular-nums">
            Step {current + 1} of {total}
          </span>
          <span className="font-body text-body-sm text-light-on-surface-variant">{wizardSteps[current].name}</span>
        </div>
        <nav aria-label="Onboarding steps">
          <ol className="grid grid-cols-8 gap-1.5">
            {wizardSteps.map((step, i) => {
              const state = i < current ? 'completed' : i === current ? 'current' : 'upcoming'
              return (
                <li key={step.slug} className="flex">
                  <button
                    type="button"
                    onClick={() => onSelect(i)}
                    aria-current={state === 'current' ? 'step' : undefined}
                    aria-label={`Step ${i + 1}: ${step.shortName}${state === 'completed' ? ' (completed)' : ''}`}
                    className={cn(
                      'h-2 w-full rounded-full transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2',
                      state === 'upcoming' ? 'bg-light-surface-container-high hover:bg-light-outline' : 'bg-light-primary',
                      state === 'completed' && 'opacity-60 hover:opacity-100',
                    )}
                  />
                </li>
              )
            })}
          </ol>
        </nav>
      </div>
    </div>
  )
}
