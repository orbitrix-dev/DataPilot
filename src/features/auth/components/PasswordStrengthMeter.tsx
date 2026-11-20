import { cn } from '../../../lib/cn'
import { passwordStrength } from '../validation'

const labels = ['Not set', 'Weak', 'Fair', 'Strong'] as const

/** Three-bar strength meter from the Create Account screen. */
export function PasswordStrengthMeter({ value }: { value: string }) {
  const strength = passwordStrength(value)
  const barColor = (index: number) => {
    if (strength === 3) return 'bg-success'
    if (strength === 2 && index < 2) return 'bg-light-primary'
    if (strength === 1 && index === 0) return 'bg-warning'
    return 'bg-light-surface-container-high'
  }
  return (
    <div className="grid grid-cols-3 gap-1.5 pt-1" role="img" aria-label={`Password strength: ${labels[strength]}`}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn('h-1 rounded-full', barColor(i))} />
      ))}
    </div>
  )
}
