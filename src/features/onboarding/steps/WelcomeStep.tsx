import { Icon } from '../../../components/ui/Icon'
import { StepPanel } from '../components/StepPanel'

const highlights = [
  { icon: 'hub', title: '1. Connect tools', body: 'Link your accounting or store software safely in read-only mode.' },
  { icon: 'verified_user', title: '2. Check accuracy', body: 'DataPilot spots missing fields or duplicates automatically.' },
  { icon: 'insights', title: '3. Track daily KPIs', body: 'See clear answers in your Command Center every morning.' },
]

export function WelcomeStep() {
  return (
    <StepPanel
      eyebrow="Takes about 3 minutes"
      lead
      title="Welcome to DataPilot"
      description="Bring your sales, inventory, and finance data into one trusted view—without spreadsheets or engineering work."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        {highlights.map((h) => (
          <div
            key={h.title}
            className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex flex-col gap-1.5"
          >
            <Icon name={h.icon} size={20} className="text-light-primary" />
            <h2 className="font-title text-title-md text-light-on-surface">{h.title}</h2>
            <p className="font-body text-body-sm text-light-on-surface-variant">{h.body}</p>
          </div>
        ))}
      </div>
    </StepPanel>
  )
}
