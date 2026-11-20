import { SelectField, TextField } from '../components/FormFields'
import { StepPanel } from '../components/StepPanel'
import { currencies, roles } from '../options'
import { useWizard, type StepProps } from '../wizardState'

export function OrganizationStep({ error }: StepProps) {
  const { answers, update } = useWizard()
  return (
    <StepPanel
      title="Tell us about your company"
      description="This helps us format currencies, fiscal calendars, and workspace defaults."
    >
      <div className="flex flex-col gap-gutter-md">
        <TextField
          label="Company name"
          name="companyName"
          autoComplete="organization"
          placeholder="Acme Global Corp"
          required
          value={answers.companyName}
          onChange={(e) => update({ companyName: e.target.value })}
          error={error}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-md">
          <SelectField label="Your role" value={answers.role} options={roles} onChange={(role) => update({ role })} />
          <SelectField
            label="Reporting currency"
            value={answers.currency}
            options={currencies}
            onChange={(currency) => update({ currency })}
          />
        </div>
      </div>
    </StepPanel>
  )
}
