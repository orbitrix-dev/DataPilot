/**
 * Fake auth API. Every call resolves after a short delay so the UI can show
 * loading states. Replace the bodies with real HTTP calls when a backend exists.
 */

const LATENCY_MS = 600

function delay(ms = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export type SsoProvider = 'microsoft' | 'google'

export type SignInInput = { email: string; password: string; remember: boolean }
export type SignUpInput = { fullName: string; email: string; password: string }
export type ResetPasswordInput = { token: string | null; password: string }
export type VerifyEmailInput = { email: string | null; code: string }
export type CreateOrganizationInput = { name: string; slug: string; region: string }

export async function signIn(input: SignInInput): Promise<void> {
  void input
  await delay()
}

export async function signInWithSso(provider: SsoProvider): Promise<void> {
  void provider
  await delay()
}

export async function signUp(input: SignUpInput): Promise<void> {
  void input
  await delay()
}

export async function requestPasswordReset(email: string): Promise<void> {
  void email
  await delay()
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  void input
  await delay()
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  void input
  await delay()
}

export async function resendVerificationCode(email: string | null): Promise<void> {
  void email
  await delay()
}

export async function createOrganization(input: CreateOrganizationInput): Promise<void> {
  void input
  await delay()
}
