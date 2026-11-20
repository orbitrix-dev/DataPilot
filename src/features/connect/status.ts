import type { ConnectionStatus, SyncRunStatus, UploadStatus } from './data'

export type StatusTone = 'success' | 'warning' | 'error' | 'primary' | 'neutral'

export const connectionStatusMeta: Record<ConnectionStatus, { tone: StatusTone; label: string }> = {
  healthy: { tone: 'success', label: 'Healthy' },
  verified: { tone: 'success', label: 'Verified' },
  latency: { tone: 'warning', label: 'High latency' },
  failed: { tone: 'error', label: 'Failed' },
}

export const runStatusMeta: Record<SyncRunStatus, { tone: StatusTone; label: string }> = {
  succeeded: { tone: 'success', label: 'Succeeded' },
  partial: { tone: 'warning', label: 'Slow' },
  failed: { tone: 'error', label: 'Failed' },
}

export const uploadStatusMeta: Record<UploadStatus, { tone: StatusTone; label: string }> = {
  uploading: { tone: 'primary', label: 'Uploading' },
  validating: { tone: 'primary', label: 'Validating' },
  verified: { tone: 'success', label: 'Verified' },
  warnings: { tone: 'warning', label: 'Warnings' },
}
