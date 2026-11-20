import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '../../../components/ui/Toast'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import { signUp } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { FieldError } from '../components/FieldMessage'
import { PasswordField } from '../components/PasswordField'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { SubmitButton } from '../components/SubmitButton'
import { TextField } from '../components/TextField'
import type { VerifyEmailState } from '../routeState'
import { focusFirstError, isValidEmail, meetsPasswordRules, type FieldErrors } from '../validation'

type Field = 'name' | 'email' | 'password' | 'terms'
const ids: Record<Field, string> = {
  name: 'signup-name',
  email: 'signup-email',
  password: 'signup-pw',
  terms: 'signup-terms',
}

type Values = { name: string; email: string; password: string; terms: boolean }

function validate(v: Values): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {}
  if (v.name.trim().length < 2) errors.name = 'Please enter your full name.'
  if (!isValidEmail(v.email)) errors.email = 'Enter a valid business email address.'
  if (!meetsPasswordRules(v.password))
    errors.password = 'Use at least 12 characters with a mix of letters and numbers.'
  if (!v.terms) errors.terms = 'You must accept the Terms of Service and Privacy Policy.'
  return errors
}

export function SignupPage() {
  useDocumentTitle('Create account')
  const navigate = useNavigate()
  const toast = useToast()
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '', terms: false })
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const update = <K extends keyof Values>(key: K, value: Values[K]) => {
    const next = { ...values, [key]: value }
    setValues(next)
    if (submitted) setErrors(validate(next))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(values)
    setErrors(next)
    if (Object.keys(next).length) {
      focusFirstError(next, ids)
      return
    }
    setLoading(true)
    try {
      const email = values.email.trim()
      await signUp({ fullName: values.name.trim(), email, password: values.password })
      const state: VerifyEmailState = { email }
      navigate('/verify-email', { state })
    } catch {
      toast('We could not create your account. Please try again.', 'error')
      setLoading(false)
    }
  }

  const termsErrorId = `${ids.terms}-error`

  return (
    <AuthLayout footer="14-day full-access trial · No credit card required">
      <AuthHeading
        title="Create your account"
        description="Start connecting your business tools in minutes. No engineering setup required."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-gutter-md">
        <TextField
          id={ids.name}
          label="Full name"
          type="text"
          autoComplete="name"
          placeholder="Elena Vance"
          required
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          error={errors.name}
        />

        <TextField
          id={ids.email}
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
          error={errors.email}
        />

        <PasswordField
          id={ids.password}
          label="Password"
          autoComplete="new-password"
          placeholder="Create a strong password"
          required
          value={values.password}
          onChange={(e) => update('password', e.target.value)}
          error={errors.password}
          hint={errors.password ? undefined : 'Use at least 12 characters with a mix of letters and numbers.'}
        >
          <PasswordStrengthMeter value={values.password} />
        </PasswordField>

        <div className="flex flex-col gap-1.5 pt-1">
          <div className="inline-flex items-start gap-2.5">
            <input
              id={ids.terms}
              type="checkbox"
              checked={values.terms}
              onChange={(e) => update('terms', e.target.checked)}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? termsErrorId : undefined}
              className="mt-0.5 rounded-sm border-light-outline text-light-primary focus:ring-light-primary cursor-pointer"
            />
            <label htmlFor={ids.terms} className="font-body text-body-sm text-light-on-surface-variant cursor-pointer">
              I agree to the{' '}
              <a href="#terms" className="text-light-primary underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="#privacy" className="text-light-primary underline">
                Privacy Policy
              </a>
              .
            </label>
          </div>
          <FieldError id={termsErrorId} message={errors.terms} />
        </div>

        <SubmitButton loading={loading} loadingLabel="Creating account…" className="mt-1">
          Create account
        </SubmitButton>
      </form>

      <p className="text-center font-body text-body-sm text-light-on-surface-variant">
        Already have an account?{' '}
        <Link to="/login" className="font-label text-label-md text-light-primary hover:text-light-secondary">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
