const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** Signup / reset rule from the designs: at least 12 characters including a number (and a letter). */
export const MIN_PASSWORD_LENGTH = 12

export function meetsPasswordRules(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH && /\d/.test(value) && /[a-z]/i.test(value)
}

/** 0–3 bars, mirroring the Stitch `updateStrength` script. */
export function passwordStrength(value: string): 0 | 1 | 2 | 3 {
  if (value.length >= 12 && /\d/.test(value)) return 3
  if (value.length >= 8) return 2
  if (value.length >= 4) return 1
  return 0
}

/** Lowercase, hyphen-separated workspace slug (same algorithm as the Stitch script). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type FieldErrors<K extends string> = Partial<Record<K, string>>

/** Focus the first field (by element id) that has an error. */
export function focusFirstError<K extends string>(errors: FieldErrors<K>, ids: Record<K, string>) {
  const first = (Object.keys(ids) as K[]).find((k) => errors[k])
  if (first) document.getElementById(ids[first])?.focus()
}
