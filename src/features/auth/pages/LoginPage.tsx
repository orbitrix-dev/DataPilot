import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '../../../components/ui/Toast'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import { signIn, signInWithSso, type SsoProvider } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { PasswordField } from '../components/PasswordField'
import { SsoButton } from '../components/SsoButton'
import { SubmitButton } from '../components/SubmitButton'
import { TextField } from '../components/TextField'
import { focusFirstError, isValidEmail, type FieldErrors } from '../validation'

type Field = 'email' | 'password'
const ids: Record<Field, string> = { email: 'login-email', password: 'login-password' }

function validate(email: string, password: string): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {}
  if (!isValidEmail(email)) errors.email = 'Enter a valid work email address.'
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.'
  return errors
}

export function LoginPage() {
  useDocumentTitle('Sign in')
  const navigate = useNavigate()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState<SsoProvider | null>(null)
  const busy = loading || ssoLoading !== null

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(email, password)
    setErrors(next)
    if (Object.keys(next).length) {
      focusFirstError(next, ids)
      return
    }
    setLoading(true)
    try {
      await signIn({ email: email.trim(), password, remember })
      navigate('/command-center')
    } catch {
      toast('Sign in failed. Check your credentials and try again.', 'error')
      setLoading(false)
    }
  }

  const handleSso = async (provider: SsoProvider) => {
    setSsoLoading(provider)
    try {
      await signInWithSso(provider)
      navigate('/command-center')
    } catch {
      toast('Single sign-on failed. Try again or use your email.', 'error')
      setSsoLoading(null)
    }
  }

  return (
    <AuthLayout footer="SOC 2 Type II certified · 256-bit TLS encryption">
      <AuthHeading
        title="Sign in to your workspace"
        description="Access your company metrics, data health checks, and automated reports."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-sm">
        <SsoButton
          icon="domain"
          label="Microsoft SSO"
          loading={ssoLoading === 'microsoft'}
          disabled={busy}
          onClick={() => handleSso('microsoft')}
        />
        <SsoButton
          icon="shield_person"
          label="Google Workspace"
          loading={ssoLoading === 'google'}
          disabled={busy}
          onClick={() => handleSso('google')}
        />
      </div>

      <div className="relative flex items-center justify-center">
        <div className="absolute inset-x-0 top-1/2 border-t border-light-outline-variant" aria-hidden="true" />
        <span className="relative px-3 bg-light-surface font-body text-body-sm text-light-on-surface-variant">or</span>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-gutter-md">
        <TextField
          id={ids.email}
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (submitted) setErrors(validate(e.target.value, password))
          }}
          error={errors.email}
        />

        <PasswordField
          id={ids.password}
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (submitted) setErrors(validate(email, e.target.value))
          }}
          error={errors.password}
          labelAction={
            <Link to="/forgot-password" className="font-label text-label-md text-light-primary hover:text-light-secondary">
              Forgot password?
            </Link>
          }
        />

        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded-sm border-light-outline text-light-primary focus:ring-light-primary"
          />
          <span className="font-body text-body-sm text-light-on-surface-variant">Keep me signed in for 30 days</span>
        </label>

        <SubmitButton loading={loading} disabled={busy} loadingLabel="Signing in…" className="mt-1">
          Sign in
        </SubmitButton>
      </form>

      <p className="text-center font-body text-body-sm text-light-on-surface-variant">
        New to DataPilot?{' '}
        <Link to="/signup" className="font-label text-label-md text-light-primary hover:text-light-secondary">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}
