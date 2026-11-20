import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { EmptyState } from '../components/EmptyState'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { acceptedExtensions, initialUploads, maxUploadBytes, type UploadedFile } from '../data'
import { NOW_ISO, formatBytes, formatNumber, slugify } from '../format'
import { uploadStatusMeta } from '../status'
import { getConnection, upsertConnection } from '../store'
import { btnBack, btnPrimary } from '../styles'
import { useTimers } from '../useTimers'

const TICK_MS = 150
const VALIDATE_TICKS = 8
/** Simulated network throughput in bytes per tick. */
const BYTES_PER_TICK = 1.5 * 1024 * 1024

type UploadEntry = UploadedFile & { validateTicks: number }

const extOf = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase()

function iconFor(name: string) {
  const ext = extOf(name)
  if (ext === '.xlsx' || ext === '.xls') return 'table_view'
  if (ext === '.json') return 'data_object'
  return 'description'
}

function sourceTypeFor(name: string) {
  const ext = extOf(name)
  if (ext === '.xlsx' || ext === '.xls') return 'Excel File'
  if (ext === '.json') return 'JSON File'
  return 'CSV File'
}

let uploadSeq = 0

/** Mock profiling result for a freshly uploaded file (rows/columns/warnings derived from size + name). */
function profile(file: File): UploadEntry {
  uploadSeq += 1
  const ext = extOf(file.name)
  const isSheet = ext === '.xlsx' || ext === '.xls'
  const warnings = isSheet && file.name.length % 2 === 0 ? 1 + (file.name.length % 3) : 0
  return {
    id: `upload-${uploadSeq}`,
    name: file.name,
    sizeBytes: file.size,
    rows: Math.max(1, Math.round(file.size / 270)),
    columns: 6 + (file.name.length % 10),
    warnings,
    warningNote: warnings ? `${warnings} date format warning${warnings > 1 ? 's' : ''}` : undefined,
    status: 'uploading',
    progress: 0,
    validateTicks: 0,
  }
}

function advance(f: UploadEntry): UploadEntry {
  if (f.status === 'uploading') {
    const pct = f.progress + Math.max(4, (BYTES_PER_TICK / Math.max(f.sizeBytes, 1)) * 100)
    return pct >= 100 ? { ...f, progress: 100, status: 'validating' } : { ...f, progress: pct }
  }
  if (f.status === 'validating') {
    const ticks = f.validateTicks + 1
    if (ticks >= VALIDATE_TICKS) return { ...f, validateTicks: ticks, status: f.warnings ? 'warnings' : 'verified' }
    return { ...f, validateTicks: ticks }
  }
  return f
}

/** Upload files (designed: connect_upload_files). Uploads and validation are simulated. */
export function UploadFilesPage() {
  usePageChrome([{ label: 'Connect', to: '/connect' }, { label: 'Upload files' }])
  const toast = useToast()
  const navigate = useNavigate()
  const schedule = useTimers()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<UploadEntry[]>(() => initialUploads.map((f) => ({ ...f, validateTicks: 0 })))
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)

  const active = files.some((f) => f.status === 'uploading' || f.status === 'validating')
  const ready = files.filter((f) => f.status === 'verified' || f.status === 'warnings')
  const readyRows = ready.reduce((s, f) => s + f.rows, 0)

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setFiles((fs) => fs.map(advance)), TICK_MS)
    return () => window.clearInterval(id)
  }, [active])

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    const accepted: UploadEntry[] = []
    const rejected: string[] = []
    Array.from(list).forEach((file) => {
      const okType = (acceptedExtensions as readonly string[]).includes(extOf(file.name))
      if (!okType) rejected.push(`${file.name} (unsupported type)`)
      else if (file.size > maxUploadBytes) rejected.push(`${file.name} (over 250 MB)`)
      else accepted.push(profile(file))
    })
    if (accepted.length) {
      setFiles((fs) => [...fs, ...accepted])
      toast(`Uploading ${accepted.length} file${accepted.length > 1 ? 's' : ''}`, 'info')
    }
    if (rejected.length) toast(`Skipped ${rejected.join(', ')}`, 'error')
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const remove = (f: UploadEntry) => {
    setFiles((fs) => fs.filter((x) => x.id !== f.id))
    toast(`Removed ${f.name}`, 'info')
  }

  const runImport = () => {
    setImporting(true)
    schedule(() => {
      ready.forEach((f) => {
        const exists = getConnection(slugify(f.name)) || f.id.startsWith('seed-')
        if (exists) return
        upsertConnection({
          id: slugify(f.name),
          name: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
          endpoint: f.name,
          sourceType: sourceTypeFor(f.name),
          kind: 'file',
          status: 'verified',
          records: f.rows,
          recordsLabel: formatNumber(f.rows),
          lastSync: NOW_ISO,
          accessLevel: 'Read-only copy',
          credentials: [],
        })
      })
      toast(`Imported ${ready.length} file${ready.length === 1 ? '' : 's'} · ${formatNumber(readyRows)} rows`)
      navigate('/connect')
    }, 1600)
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">Upload business files</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-1">
          Upload CSV, Excel (.xlsx), or JSON files. DataPilot validates column types automatically and keeps a read-only copy.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={onDrop}
        className={cn(
          'border-2 border-dashed hover:border-light-primary rounded-md p-10 flex flex-col items-center justify-center text-center gap-3 transition-colors',
          dragging ? 'border-light-primary bg-light-primary-container/30' : 'bg-light-surface border-light-outline',
        )}
      >
        <div className="w-12 h-12 rounded-full bg-light-primary-container text-light-on-primary-container flex items-center justify-center">
          <Icon name="upload_file" size={24} />
        </div>
        <div>
          <p className="font-title text-title-md text-light-on-surface">
            {dragging ? 'Drop files to upload' : 'Drag and drop files here, or browse your computer'}
          </p>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Supports CSV, Excel (.xlsx, .xls), and JSON up to 250 MB per file
          </p>
        </div>
        <label className="mt-2 cursor-pointer px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg focus-within:ring-2 focus-within:ring-light-primary focus-within:ring-offset-1">
          <span>Select files</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptedExtensions.join(',')}
            className="sr-only"
            onChange={(e) => {
              addFiles(e.target.files)
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
        </label>
      </div>

      {/* Uploaded queue */}
      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <header className="px-5 py-4 border-b border-light-outline-variant flex items-center justify-between">
          <h2 className="font-title text-title-md text-light-on-surface">Validated files ready to import</h2>
          <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            {ready.length} file{ready.length === 1 ? '' : 's'} · {formatNumber(readyRows)} rows
          </span>
        </header>
        <ul className="divide-y divide-light-outline-variant">
          {files.map((f) => {
            const meta = uploadStatusMeta[f.status]
            return (
              <li key={f.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Icon name={iconFor(f.name)} size={22} className="text-light-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-mono-sm text-light-on-surface truncate">{f.name}</p>
                    {f.status === 'uploading' ? (
                      <div className="flex items-center gap-3 mt-1 max-w-sm">
                        <ProgressBar value={f.progress} label={`Uploading ${f.name}`} className="h-1.5" />
                        <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums whitespace-nowrap">
                          {formatBytes((f.sizeBytes * f.progress) / 100)} of {formatBytes(f.sizeBytes)}
                        </span>
                      </div>
                    ) : (
                      <p className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                        {f.status === 'validating'
                          ? `${formatBytes(f.sizeBytes)} · Validating column types…`
                          : `${formatBytes(f.sizeBytes)} · ${formatNumber(f.rows)} rows · ${f.warningNote ?? `${f.columns} columns`}`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge tone={meta.tone} dot>
                    {f.status === 'warnings'
                      ? `${f.warnings} warning${f.warnings === 1 ? '' : 's'}`
                      : f.status === 'uploading'
                        ? `${Math.floor(f.progress)}%`
                        : meta.label}
                  </StatusBadge>
                  <button
                    type="button"
                    onClick={() => remove(f)}
                    aria-label={`Remove ${f.name}`}
                    className="p-1 rounded text-light-on-surface-variant hover:bg-light-surface-container"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
              </li>
            )
          })}
          {files.length === 0 && (
            <li className="p-4">
              <EmptyState icon="upload_file" title="No files added yet">
                Drop CSV, Excel, or JSON files above to validate them before import.
              </EmptyState>
            </li>
          )}
        </ul>
        <footer className="px-5 py-4 bg-light-surface-container-low border-t border-light-outline-variant flex items-center justify-between">
          <Link to="/connect/marketplace" className={btnBack}>
            Back
          </Link>
          <button
            type="button"
            onClick={runImport}
            disabled={ready.length === 0 || active || importing}
            className={btnPrimary}
          >
            {importing ? 'Importing…' : 'Run initial import'}
          </button>
        </footer>
      </section>
    </div>
  )
}
