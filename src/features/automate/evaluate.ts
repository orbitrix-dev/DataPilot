import type { SyncRun } from '../connect/data'
import {
  actionTypeById,
  approverById,
  cadenceById,
  datasetById,
  invoiceRows,
  stockRows,
  type Dataset,
  type DatasetId,
  type Row,
  type Rule,
  type Workflow,
} from './data'

/** Rows the workflow's dataset currently holds. Sync runs come live from Connect. */
export function rowsFor(dataset: DatasetId | '', syncRuns: SyncRun[]): Row[] {
  if (dataset === 'public.invoices') return invoiceRows
  if (dataset === 'warehouse.stock_levels') return stockRows
  if (dataset === 'connect.sync_runs') {
    return syncRuns.map((r) => ({ id: r.id, name: r.source, status: r.status, duration_seconds: r.durationSeconds }))
  }
  return []
}

const isNumber = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v))

/**
 * Why a rule can't be saved, or undefined when it is valid. Numeric fields
 * compare against a number or another numeric field of the same dataset
 * (e.g. days_of_cover < lead_time_days); text fields only support "equals".
 */
export function ruleIssue(rule: Rule, dataset: Dataset | undefined): string | undefined {
  if (!dataset) return 'Choose a dataset on the trigger step first.'
  const field = dataset.fields.find((f) => f.name === rule.field)
  if (!field) return 'Choose a field.'
  const value = rule.value.trim()
  if (!value) return 'Enter a value to compare against.'
  if (field.type === 'text') {
    if (rule.op !== '==') return `${field.name} is text, so it can only use “equals”.`
    return undefined
  }
  const other = dataset.fields.find((f) => f.name === value)
  if (isNumber(value) || (other && other.type === 'number' && other.name !== field.name)) return undefined
  return `Enter a number or another numeric field (${dataset.fields
    .filter((f) => f.type === 'number' && f.name !== field.name)
    .map((f) => f.name)
    .join(', ') || 'none available'}).`
}

function test(row: Row, rule: Rule): boolean {
  const left = row[rule.field]
  const raw = rule.value.trim()
  const right = raw in row && !isNumber(raw) ? row[raw] : raw
  if (typeof left === 'number') {
    const r = Number(right)
    switch (rule.op) {
      case '>': return left > r
      case '>=': return left >= r
      case '<': return left < r
      case '<=': return left <= r
      case '==': return left === r
    }
  }
  return String(left).toLowerCase() === String(right).toLowerCase()
}

/** Rows that satisfy the workflow's conditions. Invalid rules are ignored. */
export function matchRows(workflow: Workflow, rows: Row[]): Row[] {
  const dataset = datasetById(workflow.trigger.dataset)
  const rules = workflow.conditions.rules.filter((r) => !ruleIssue(r, dataset))
  if (rules.length === 0) return rows
  return rows.filter((row) =>
    workflow.conditions.match === 'all' ? rules.every((r) => test(row, r)) : rules.some((r) => test(row, r)),
  )
}

export const usd = (n: number) => `$${n.toLocaleString('en-US')}`

/**
 * "2 past-due invoices ($18,400)" or, with `of`, "2 of 14 past-due invoices ($18,400)";
 * other datasets list the first ids: "2 of 6 SKUs (SKU-4410, SKU-2108)".
 */
export function describeMatches(dataset: Dataset | undefined, rows: Row[], of?: number): string {
  const count = of === undefined ? `${rows.length}` : `${rows.length} of ${of}`
  if (!dataset) return `${count} rows`
  const noun = (of ?? rows.length) === 1 ? dataset.noun[0] : dataset.noun[1]
  if (rows.length === 0) return `${count} ${noun}`
  if (dataset.id === 'public.invoices') {
    return `${count} ${noun} (${usd(rows.reduce((s, r) => s + Number(r.balance_due), 0))})`
  }
  const ids = rows.slice(0, 3).map((r) => r.id).join(', ')
  return `${count} ${noun} (${ids}${rows.length > 3 ? ', …' : ''})`
}

export const ruleText = (r: Rule) => `${r.field} ${r.op} ${r.value.trim() || '…'}`

export function conditionsText(w: Workflow): string {
  const rules = w.conditions.rules
  if (rules.length === 0) return w.trigger.kind === 'schedule' ? 'No conditions: runs at every scheduled time.' : 'No conditions: every row matches.'
  return rules.map(ruleText).join(w.conditions.match === 'all' ? ' AND ' : ' OR ')
}

/** One-line trigger description for tables: "Trigger: days_overdue > 15 · Action: Email owner". */
export function workflowSubtitle(w: Workflow): string {
  const action = actionTypeById(w.action.type)
  const cadence = cadenceById(w.trigger.cadence)
  const left =
    w.trigger.kind === 'schedule'
      ? `Schedule: ${cadence?.short ?? 'not set'}`
      : `Trigger: ${w.conditions.rules[0] ? ruleText(w.conditions.rules[0]) : (w.trigger.dataset || 'not set')}`
  return `${left} · Action: ${action?.short ?? 'not set'}`
}

/** Permission scopes the workflow is granted: a read scope per dataset plus the action's scopes. */
export function scopesOf(w: Workflow): { read: string[]; action: string[] } {
  const action = actionTypeById(w.action.type)
  const read = w.trigger.dataset ? [`${w.trigger.dataset}:read`] : w.action.type === 'sales-report' ? ['public.orders:read'] : []
  return { read, action: action?.scopes ?? [] }
}

export function requiresApproval(w: Workflow): boolean {
  return !actionTypeById(w.action.type)?.preApproved
}

export function approvalLabel(w: Workflow): string {
  if (!w.action.type) return 'Not set'
  if (!requiresApproval(w)) return 'Pre-approved (read-only)'
  return `Required (${approverById(w.action.approver)?.short})`
}

/** Stages still missing before the workflow can be published. */
export function missingStages(w: Workflow): string[] {
  const missing: string[] = []
  if (!w.configured.trigger || !w.trigger.cadence || (w.trigger.kind === 'threshold' && !w.trigger.dataset)) missing.push('trigger')
  const dataset = datasetById(w.trigger.dataset)
  if (w.trigger.kind === 'threshold' && (!w.configured.conditions || w.conditions.rules.some((r) => ruleIssue(r, dataset)))) {
    missing.push('conditions')
  }
  if (!w.configured.action || !w.action.type || !w.action.target.trim()) missing.push('action')
  return missing
}
