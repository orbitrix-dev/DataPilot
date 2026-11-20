import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import { resetPassword } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { BackToSignIn } from '../components/BackToSignIn'
import { PasswordField } from '../components/PasswordField'
import { SubmitButton } from '../components/SubmitButton'
import { focusFirstError, meetsPasswordRules, type FieldErrors } from '../validation'

type Field = 'password' | 'confirm'
const ids: Record<Field, string> = { password: 'new-pw', confirm: 'confirm-pw' }

function validate(password: string, confirm: string): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {}
  if (!meetsPasswordRules(password)) errors.password = 'Password must be at least 12 characters and include a number.'
  if (!confirm || confirm !== password) errors.confirm = 'Passwords do not match. Check both fields and try again.'
  return errors
}

export function ResetPasswordPage() {
  useDocumentTitle('Set a new password')
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const rulesMet = meetsPasswordRules(password)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(password, confirm)
    setErrors(next)
    if (Object.keys(next).length) {
      focusFirstError(next, ids)
      return
    }
    setLoading(true)
    try {
      await resetPassword({ token: params.get('token'), password })
      toast('Password updated. Sign in with your new password.')
      navigate('/login')
    } catch {
      toast('This reset link is invalid or has expired. Request a new one.', 'error')
      setLoading(false)
    }
  }

  return (
    <AuthLayout footer="All active sessions will require sign-in after reset">
      <AuthHeading
        title="Set a new password"
        description="Choose a strong password you have not used on other accounts."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-gutter-md">
        <PasswordField
          id={ids.password}
          label="New password"
          autoComplete="new-password"
          placeholder="At least 12 characters"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (submitted) setErrors(validate(e.target.value, confirm))
          }}
          error={errors.password}
          aria-describedby={errors.password ? `${ids.password}-error reset-pw-rules` : 'reset-pw-rules'}
        />

        <PasswordField
          id={ids.confirm}
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          required
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            if (submitted) setErrors(validate(password, e.target.value))
          }}
          error={errors.confirm}
        />

        <div
          id="reset-pw-rules"
          className="p-3 rounded bg-light-surface-container-low border border-light-outline-variant flex flex-col gap-1.5"
        >
          <span className="font-label text-label-sm uppercase text-light-on-surface-variant">Password requirements</span>
          <p className="font-body text-body-sm text-light-on-surface-variant flex items-center gap-1.5">
            <Icon
              name={rulesMet ? 'check_circle' : 'radio_button_unchecked'}
              size={15}
              className={cn(rulesMet ? 'text-success' : 'text-light-on-surface-variant')}
            />
            Minimum 12 characters with one number
            <span className="sr-only">{rulesMet ? '(met)' : '(not met)'}</span>
          </p>
        </div>

        <SubmitButton loading={loading} loadingLabel="Updating password…">
          Update password
        </SubmitButton>
      </form>

      <BackToSignIn />
    </AuthLayout>
  )
}
