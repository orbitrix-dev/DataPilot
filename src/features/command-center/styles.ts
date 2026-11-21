import type { Tone } from './signals'

export const toneText: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-light-on-surface',
}

export const toneDot: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  neutral: 'bg-light-on-surface-variant',
}
