import { useRef, useState, type FormEvent } from 'react'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Drawer } from '../../../components/ui/Drawer'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { EmptyState } from '../../connect/components/EmptyState'
import { SearchInput } from '../../connect/components/SearchInput'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { btnPrimary, btnSecondary } from '../../connect/styles'
import { ruleTypes, type QualityRule, type RuleType } from '../data'
import { ruleStatusTone } from '../status'
import { addRule, useTrustState } from '../store'

const fieldClass =
  'w-full px-3 py-2 rounded border bg-light-surface text-body-md text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary'

type Draft = { type: RuleType; target: string; explanation: string }
const emptyDraft: Draft = { type: 'Null check', target: '', explanation: '' }

let ruleSeq = 5

/** Quality rules (designed: trust_quality_rules). The create-rule panel is not designed; built in the same style. */
export function QualityRulesPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Quality rules' }])
  const { rules } = useTrustState()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const targetRef = useRef<HTMLInputElement>(null)
  const explanationRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const rows = q
    ? rules.filter((r) => [r.type, r.target, r.explanation, r.statusLabel].some((v) => v.toLowerCase().includes(q)))
    : rules

  const close = () => {
    setOpen(false)
    setDraft(emptyDraft)
    setErrors({})
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const next: typeof errors = {}
    if (!draft.target.trim()) next.target = 'Enter the dataset or column this rule checks.'
    if (!draft.explanation.trim()) next.explanation = 'Explain in business terms why this rule matters.'
    setErrors(next)
    if (next.target) return targetRef.current?.focus()
    if (next.explanation) return explanationRef.current?.focus()

    ruleSeq += 1
    addRule({
      id: `rule-${ruleSeq}`,
      type: draft.type,
      target: draft.target.trim(),
      explanation: draft.explanation.trim(),
      status: 'pending',
      statusLabel: 'Runs on next sync',
      lastEvaluated: 'Not yet run',
    })
    toast(`${draft.type} created for ${draft.target.trim()}`)
    close()
  }

  const columns: Column<QualityRule>[] = [
    { key: 'type', header: 'Rule type', cellClassName: 'font-title text-title-md text-light-on-surface', cell: (r) => r.type },
    { key: 'target', header: 'Target dataset & column', cellClassName: 'font-mono text-mono-sm', cell: (r) => r.target },
    {
      key: 'explanation',
      header: 'Business explanation',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant',
      cell: (r) => r.explanation,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge tone={ruleStatusTone[r.status]}>{r.statusLabel}</StatusBadge>,
    },
    {
      key: 'last',
      header: 'Last evaluated',
      align: 'right',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant tabular-nums whitespace-nowrap',
      cell: (r) => r.lastEvaluated,
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Quality rules</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Automated checks for nulls, duplicates, schema drift, record counts, and financial reconciliation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg"
        >
          <Icon name="add" size={18} />
          <span>Create rule</span>
        </button>
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="p-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-4">
          <SearchInput value={query} onChange={setQuery} placeholder="Filter rules..." label="Filter rules" />
          <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            {q ? `Showing ${rows.length} of ${rules.length} rules` : `${rules.length} rules`}
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState title="No rules match your filter">
              <button type="button" onClick={() => setQuery('')} className="font-label text-label-md text-light-primary hover:underline">
                Clear filter
              </button>
            </EmptyState>
          }
        />
      </section>

      <Drawer
        open={open}
        onClose={close}
        title="Create quality rule"
        footer={
          <>
            <button type="button" onClick={close} className={btnSecondary}>
              Cancel
            </button>
            <button type="submit" form="create-rule-form" className={btnPrimary}>
              Create rule
            </button>
          </>
        }
      >
        <form id="create-rule-form" onSubmit={submit} noValidate className="flex flex-col gap-gutter-md">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-type" className="font-label text-label-md text-light-on-surface">
              Rule type
            </label>
            <select
              id="rule-type"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as RuleType })}
              className={cn(fieldClass, 'border-light-outline')}
            >
              {ruleTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-target" className="font-label text-label-md text-light-on-surface">
              Target dataset and column
            </label>
            <input
              id="rule-target"
              ref={targetRef}
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              placeholder="public.orders.customer_id"
              aria-invalid={!!errors.target}
              aria-describedby={errors.target ? 'rule-target-error' : 'rule-target-hint'}
              className={cn(fieldClass, 'font-mono', errors.target ? 'border-error' : 'border-light-outline')}
            />
            {errors.target ? (
              <p id="rule-target-error" role="alert" className="font-body text-body-sm text-error">
                {errors.target}
              </p>
            ) : (
              <p id="rule-target-hint" className="font-body text-body-sm text-light-on-surface-variant">
                Use schema.table or schema.table.column.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-explanation" className="font-label text-label-md text-light-on-surface">
              Business explanation
            </label>
            <input
              id="rule-explanation"
              ref={explanationRef}
              value={draft.explanation}
              onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
              placeholder="Every order must belong to a valid customer"
              aria-invalid={!!errors.explanation}
              aria-describedby={errors.explanation ? 'rule-explanation-error' : undefined}
              className={cn(fieldClass, errors.explanation ? 'border-error' : 'border-light-outline')}
            />
            {errors.explanation && (
              <p id="rule-explanation-error" role="alert" className="font-body text-body-sm text-error">
                {errors.explanation}
              </p>
            )}
          </div>
          <p className="font-body text-body-sm text-light-on-surface-variant">
            New rules are evaluated on the next sync cycle of the target dataset.
          </p>
        </form>
      </Drawer>
    </>
  )
}
