/** Router `state` passed from /signup to /verify-email. */
export type VerifyEmailState = { email: string }

export function readVerifyEmailState(state: unknown): VerifyEmailState | null {
  if (typeof state === 'object' && state !== null && 'email' in state && typeof state.email === 'string') {
    return { email: state.email }
  }
  return null
}
