import { useAutomateState } from '../automate/store'
import { useConnectState } from '../connect/store'
import { formatNumber } from '../connect/format'
import { answerPath, findAnswer } from '../intelligence/data'
import { useIntelligenceState } from '../intelligence/store'
import { useTrustState } from '../trust/store'
import type { Tone } from './signals'

export type ActivityCategory = 'sync' | 'quality' | 'ai' | 'workflow' | 'report' | 'user'

export const categoryMeta: Record<ActivityCategory, { label: string; icon: string }> = {
  sync: { label: 'Data synchronization', icon: 'sync' },
  quality: { label: 'Data quality', icon: 'verified_user' },
  ai: { label: 'Intelligence', icon: 'psychology' },
  workflow: { label: 'Workflow approval', icon: 'bolt' },
  report: { label: 'Report generation', icon: 'description' },
  user: { label: 'User activity', icon: 'person' },
}

export type Activity = {
  id: string
  category: ActivityCategory
  text: string
  actor?: string
  /** "Today, 14:28", "Nov 18, 07:48". */
  time: string
  /** Day heading: "This session", "Today", "Yesterday", "Nov 18". */
  day: string
  sort: number
  to?: string
  tone?: Tone
}

/* -------------------------------------------------------------- timestamps */

/** Every seeded screen is rendered as of Friday Nov 20, 2026 (UTC). */
const TODAY = Date.UTC(2026, 10, 20)
const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n: number) => String(n).padStart(2, '0')

/** Parses the time labels used across the mock data into UTC milliseconds. */
export function parseWhen(label: string): number {
  if (/^\d{4}-\d{2}-\d{2}T/.test(label)) return Date.parse(label)
  let m = label.match(/^(Today|Yesterday), (\d{1,2}):(\d{2})/)
  if (m) return TODAY - (m[1] === 'Yesterday' ? DAY : 0) + (+m[2] * 60 + +m[3]) * 60_000
  m = label.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}):(\d{2})/)
  if (m && MONTHS.includes(m[1])) return Date.UTC(2026, MONTHS.indexOf(m[1]), +m[2], +m[3], +m[4])
  m = label.match(/^(\d{1,2}):(\d{2}) UTC$/)
  if (m) return TODAY + (+m[1] * 60 + +m[2]) * 60_000
  return Number.NaN
}

function dayOf(ms: number): string {
  const start = Math.floor(ms / DAY) * DAY
  if (start === TODAY) return 'Today'
  if (start === TODAY - DAY) return 'Yesterday'
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** Builds the time fields. Items created during the session sort first and show the local clock, like the stores that created them. */
function when(label: string, at?: number): Pick<Activity, 'time' | 'day' | 'sort'> {
  if (at) {
    const d = new Date(at)
    return { time: `Today, ${p2(d.getHours())}:${p2(d.getMinutes())}`, day: 'This session', sort: 1e15 + at }
  }
  const ms = parseWhen(label)
  if (Number.isNaN(ms)) return { time: label, day: 'Earlier', sort: 0 }
  const d = new Date(ms)
  return { time: `${dayOf(ms)}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`, day: dayOf(ms), sort: ms }
}

/** Audit entries that duplicate a run already in the feed. */
const RUN_AUDIT = /^(Approved run|Rejected REQ|Ran dry-run|Retried|Paged)/

/* -------------------------------------------------------------------- feed */

/** Chronological feed across Connect, Trust, Intelligence and Automate, newest first. */
export function useActivity(): Activity[] {
  const { runs: syncRuns, connections } = useConnectState()
  const { incidents, freshness } = useTrustState()
  const { history, poDrafts, poDraftAt } = useIntelligenceState()
  const { runs, requests, workflows } = useAutomateState()

  const items: Activity[] = []

  for (const r of syncRuns) {
    const name = connections.find((c) => c.id === r.connectionId)?.name ?? r.source
    items.push({
      id: r.id,
      category: 'sync',
      text:
        r.status === 'succeeded'
          ? `${name} synced ${formatNumber(r.records)} records`
          : r.status === 'failed'
            ? `${name} sync failed (${r.statusLabel?.replace(/^Failed \(|\)$/g, '') ?? 'error'})`
            : `${name} synced ${formatNumber(r.records)} records slowly (${r.statusLabel?.replace(/^Slow \(|\)$/g, '') ?? 'slow'})`,
      actor: r.trigger === 'Manual' ? 'Manual sync' : 'Scheduled sync',
      tone: r.status === 'failed' ? 'error' : r.status === 'partial' ? 'warning' : undefined,
      to: `/connect/connections/${r.connectionId}`,
      ...when(r.timestamp, r.at),
    })
  }

  for (const f of freshness) {
    if (!f.refreshedAt) continue
    items.push({ id: `fresh-${f.dataset}`, category: 'sync', text: `${f.dataset} refreshed from Freshness monitoring`, actor: 'Elena Vance', to: '/trust/freshness', ...when('', f.refreshedAt) })
  }

  for (const i of incidents) {
    i.history.forEach((h, n) => {
      items.push({
        id: `${i.id}-${n}`,
        category: 'quality',
        text: `${i.id}: ${h.text}`,
        tone: /failed|missed/i.test(h.text) ? (i.severity === 'critical' ? 'error' : 'warning') : /resolved|verified fixed/i.test(h.text) ? 'success' : undefined,
        to: `/trust/incidents/${i.id}`,
        ...when(h.time, h.at),
      })
    })
  }

  for (const h of history) {
    const answer = findAnswer(h.answerId)
    items.push({
      id: `ask-${h.id}`,
      category: 'ai',
      text: `Asked Intelligence: “${h.question}”${h.status === 'qualified' ? ` (qualified: ${h.qualifiedBy})` : h.status === 'unanswered' ? ' (no grounded answer)' : ''}`,
      tone: h.status === 'qualified' ? 'warning' : undefined,
      to: answer ? answerPath(answer) : '/intelligence/history',
      ...when(h.asked, h.at),
    })
  }

  if (poDrafts.length && poDraftAt) {
    items.push({
      id: 'po-draft',
      category: 'ai',
      text: `PO draft created for ${poDrafts.join(', ')} from the stock-out recommendation (not sent to suppliers)`,
      actor: 'Elena Vance',
      to: '/intelligence/answers/stockout-risk',
      ...when('', poDraftAt),
    })
  }

  for (const r of runs) {
    const report = r.workflowId === 'WF-106'
    const text = {
      executed: report ? `Report sent: ${r.summary}` : `Workflow executed: ${r.summary}`,
      failed: `Delivery failed: ${r.summary}`,
      running: `Executing: ${r.summary}`,
      test: `Dry run: ${r.summary}`,
      rejected: `Rejected: ${r.summary}`,
    }[r.outcome]
    items.push({
      id: r.id,
      category: report ? 'report' : 'workflow',
      text: `${text} (${r.id})`,
      actor:
        r.outcome === 'test'
          ? undefined
          : r.outcome === 'rejected'
            ? `Rejected by ${r.approvedBy}`
            : r.approvedBy === 'Pre-approved alert'
              ? r.approvedBy
              : `Approved by ${r.approvedBy}`,
      tone: r.outcome === 'failed' ? 'error' : r.outcome === 'executed' ? 'success' : undefined,
      to: `/automate/runs/${r.id}`,
      ...when(r.time, r.at),
    })
  }

  for (const q of requests) {
    items.push({
      id: q.id,
      category: q.workflowId === 'WF-106' ? 'report' : 'workflow',
      text: `${q.id} queued for approval: ${q.title}`,
      to: '/automate/approvals',
      ...when(q.queued),
    })
  }

  for (const w of workflows) {
    w.audit.forEach((e, n) => {
      if (RUN_AUDIT.test(e.text)) return
      items.push({
        id: `${w.id}-audit-${n}`,
        category: 'user',
        text: `${e.text} (${w.id}: ${w.name})`,
        actor: e.actor,
        to: `/automate/workflows/${w.id}`,
        ...when(e.time, e.at),
      })
    })
  }

  return items.sort((a, b) => b.sort - a.sort)
}
