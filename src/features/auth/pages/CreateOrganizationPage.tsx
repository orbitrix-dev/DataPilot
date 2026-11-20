import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import { createOrganization } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { FieldError, FieldHint } from '../components/FieldMessage'
import { describedBy, inputClassName } from '../components/fieldStyles'
import { SubmitButton } from '../components/SubmitButton'
import { TextField } from '../components/TextField'
import { focusFirstError, SLUG_RE, slugify, type FieldErrors } from '../validation'

type Field = 'name' | 'slug'
const ids: Record<Field, string> = { name: 'org-name', slug: 'org-slug' }
const REGION_ID = 'org-region'

const regions = [
  { value: 'us-east', label: 'United States (US-East · Virginia)' },
  { value: 'eu-west', label: 'Europe (EU-West · Frankfurt)' },
  { value: 'ap-southeast', label: 'Asia-Pacific (Singapore)' },
] as const

function validate(name: string, slug: string): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {}
  if (name.trim().length < 2) errors.name = 'Enter your organization name.'
  if (slug.length < 3) errors.slug = 'Workspace URL must be at least 3 characters.'
  else if (!SLUG_RE.test(slug)) errors.slug = 'Use lowercase letters, numbers, and single hyphens only.'
  return errors
}

export function CreateOrganizationPage() {
  useDocumentTitle('Create organization')
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [region, setRegion] = useState<string>(regions[0].value)
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleNameChange = (value: string) => {
    setName(value)
    const nextSlug = slugEdited ? slug : slugify(value)
    if (!slugEdited) setSlug(nextSlug)
    if (submitted) setErrors(validate(value, nextSlug))
  }

  const handleSlugChange = (value: string) => {
    const nextSlug = value.toLowerCase().replace(/\s+/g, '-')
    setSlug(nextSlug)
    setSlugEdited(nextSlug.length > 0)
    if (submitted) setErrors(validate(name, nextSlug))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(name, slug)
    setErrors(next)
    if (Object.keys(next).length) {
      focusFirstError(next, ids)
      return
    }
    setLoading(true)
    try {
      await createOrganization({ name: name.trim(), slug, region })
      navigate('/onboarding')
    } catch {
      toast('We could not create your organization. Please try again.', 'error')
      setLoading(false)
    }
  }

  const slugErrorId = `${ids.slug}-error`
  const regionHintId = `${REGION_ID}-hint`

  return (
    <AuthLayout width="lg" footer="You can invite team members and adjust settings anytime later">
      <AuthHeading
        align="start"
        title="Create your organization"
        description="Your organization is your private workspace where your team, data connections, and reports live."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-gutter-md">
        <TextField
          id={ids.name}
          label="Organization name"
          type="text"
          autoComplete="organization"
          placeholder="Acme Global Corp"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          error={errors.name}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.slug} className="font-label text-label-md text-light-on-surface">
            Workspace URL
          </label>
          <div
            className={cn(
              'flex items-center rounded border bg-light-surface-container-low overflow-hidden focus-within:ring-1',
              errors.slug
                ? 'border-error focus-within:ring-error'
                : 'border-light-outline focus-within:border-light-primary focus-within:ring-light-primary',
            )}
          >
            <span
              aria-hidden="true"
              className="px-3 py-2 font-mono text-mono-sm text-light-on-surface-variant border-r border-light-outline"
            >
              app.datapilot.io/
            </span>
            <input
              id={ids.slug}
              type="text"
              placeholder="acme-global-corp"
              required
              spellCheck={false}
              autoCapitalize="none"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              aria-invalid={errors.slug ? true : undefined}
              aria-describedby={describedBy(errors.slug && slugErrorId)}
              className="flex-1 min-w-0 px-3 py-2 bg-light-surface font-mono text-mono-sm text-light-on-surface border-0 focus:ring-0"
            />
          </div>
          <FieldError id={slugErrorId} message={errors.slug} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={REGION_ID} className="font-label text-label-md text-light-on-surface">
            Data hosting region
          </label>
          <select
            id={REGION_ID}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            aria-describedby={regionHintId}
            className={inputClassName(false, 'px-3 py-2')}
          >
            {regions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <FieldHint id={regionHintId}>
            Choose the region closest to your business for faster syncs and compliance.
          </FieldHint>
        </div>

        <SubmitButton loading={loading} loadingLabel="Creating organization…" trailingIcon="arrow_forward" className="mt-2">
          Create organization
        </SubmitButton>
      </form>
    </AuthLayout>
  )
}
