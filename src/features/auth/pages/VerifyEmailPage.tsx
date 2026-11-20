import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useToast } from '../../../components/ui/Toast'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import { resendVerificationCode, verifyEmail } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { SubmitButton } from '../components/SubmitButton'
import { TextField } from '../components/TextField'
import { readVerifyEmailState } from '../routeState'

const CODE_ID = 'otp-input'
const CODE_LENGTH = 6

function validate(code: string): string | undefined {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code) ? undefined : 'Enter the 6-digit code from your email.'
}

export function VerifyEmailPage() {
  useDocumentTitle('Verify your email')
  const navigate = useNavigate()
  const toast = useToast()
  const email = readVerifyEmailState(useLocation().state)?.email ?? null
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(code)
    setError(next)
    if (next) {
      document.getElementById(CODE_ID)?.focus()
      return
    }
    setLoading(true)
    try {
      await verifyEmail({ email, code })
      navigate('/create-organization')
    } catch {
      setError('That code is invalid or has expired. Request a new one.')
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setResent(false)
    try {
      await resendVerificationCode(email)
      setResent(true)
    } catch {
      toast('We could not resend the code. Please try again.', 'error')
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout footer="Did not receive it? Check your spam or junk folder">
      <AuthHeading
        icon="mail"
        title="Check your email"
        description={
          <>
            We sent a 6-digit verification code to{' '}
            <strong className="font-label text-light-on-surface">{email ?? 'your work email address'}</strong>.
          </>
        }
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-gutter-md">
        <TextField
          id={CODE_ID}
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          placeholder="482910"
          required
          value={code}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
            setCode(digits)
            if (submitted) setError(validate(digits))
          }}
          error={error}
          inputClassName="px-3 py-2.5 font-mono text-title-lg text-center tracking-widest tabular-nums"
        />

        <SubmitButton loading={loading} loadingLabel="Verifying…">
          Verify email
        </SubmitButton>
      </form>

      <div className="flex flex-col items-center gap-2 pt-2 border-t border-light-outline-variant">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="font-label text-label-md text-light-primary hover:text-light-secondary disabled:opacity-60"
        >
          {resending ? 'Sending new code…' : 'Resend verification code'}
        </button>
        <span role="status" className="font-body text-body-sm text-success">
          {resent ? 'A new code has been sent to your inbox.' : ''}
        </span>
        <Link to="/signup" className="font-body text-body-sm text-light-on-surface-variant hover:text-light-on-surface">
          Use a different email address
        </Link>
      </div>
    </AuthLayout>
  )
}
