import { useState, type FormEvent } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import { requestPasswordReset } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { BackToSignIn } from '../components/BackToSignIn'
import { SubmitButton } from '../components/SubmitButton'
import { TextField } from '../components/TextField'
import { isValidEmail } from '../validation'

const EMAIL_ID = 'reset-email'

function validate(email: string): string | undefined {
  if (!email.trim()) return 'Enter your work email.'
  if (!isValidEmail(email)) return 'Enter a valid work email address.'
  return undefined
}

export function ForgotPasswordPage() {
  useDocumentTitle('Forgot password')
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(email)
    setError(next)
    if (next) {
      document.getElementById(EMAIL_ID)?.focus()
      return
    }
    setLoading(true)
    try {
      await requestPasswordReset(email.trim())
      setSent(true)
    } catch {
      toast('We could not send the reset link. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout footer="Need help? Contact support@datapilot.io">
      <AuthHeading
        icon="lock_reset"
        title="Reset your password"
        description="Enter the work email tied to your account and we will send you a secure reset link."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-gutter-md">
        <TextField
          id={EMAIL_ID}
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (submitted) setError(validate(e.target.value))
          }}
          error={error}
        />

        <SubmitButton loading={loading} loadingLabel="Sending…">
          {sent ? 'Resend reset link' : 'Send reset link'}
        </SubmitButton>
      </form>

      {sent && (
        <div role="status" className="p-4 rounded bg-success-container text-on-success-container flex items-start gap-3">
          <Icon name="mark_email_read" size={20} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-label text-label-md">Reset link sent</p>
            <p className="font-body text-body-sm mt-0.5">Check your inbox for a link valid for 30 minutes.</p>
          </div>
        </div>
      )}

      <BackToSignIn />
    </AuthLayout>
  )
}
