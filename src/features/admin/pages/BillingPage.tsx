import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { AdminPage, BillingTabs } from '../components/parts'
import { panelClass, thClass } from '../styles'
import { invoices, planById, plans, roleById, type Plan } from '../data'
import { canManageBilling, changePlan, me, owner, requestPlan, useAdminState } from '../store'
import { formatRows, overLimits, useUsage } from '../usage'

const money = (n: number) => `$${n.toLocaleString('en-US')}`

/** Subscription & Billing (designed: admin_subscription_billing). Plan changes follow the permission matrix. */
export function BillingPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Subscription & Billing' }])
  const s = useAdminState()
  const usage = useUsage()
  const { plan } = usage
  const [target, setTarget] = useState<Plan | null>(null)
  const toast = useToast()
  const allowed = canManageBilling(s)
  const idx = plans.findIndex((p) => p.id === plan.id)
  const lower = plans[idx - 1]
  const higher = plans[idx + 1]

  return (
    <AdminPage>
      <BillingTabs />

      <section className={cn(panelClass, 'p-6 flex flex-col md:flex-row md:items-center justify-between gap-4')}>
        <div className="min-w-0">
          <span className="font-label text-label-sm uppercase text-light-on-surface-variant">Current Plan</span>
          <h1 className="font-headline text-headline-md text-light-on-surface mt-1">
            {plan.name} — {money(plan.price)} / month
          </h1>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Includes {plan.seats} user seats, {plan.sources} data sources, {formatRows(plan.rows)} monthly rows, and {plan.retention} audit logs. Card ending •••• 4242. Next
            invoice Dec 01, 2026.
          </p>
          {s.planRequest && (
            <p className="font-body text-body-sm text-light-primary mt-2">
              Requested from {owner(s).name}: move to {planById(s.planRequest).name}. Waiting for the Owner.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {lower && (
            <Button variant="secondary" onClick={() => setTarget(lower)}>
              Downgrade
            </Button>
          )}
          {higher && <Button onClick={() => setTarget(higher)}>Upgrade to {higher.name.replace('Enterprise ', '')}</Button>}
        </div>
      </section>
      {!allowed && (
        <p className="font-body text-body-sm text-light-on-surface-variant -mt-3">
          Plan changes need the {roleById('owner').label}. As {roleById(me(s).role).label} you can send {owner(s).name} a request (
          <Link to="/users-permissions/permissions" className="text-light-primary hover:underline">
            permission matrix
          </Link>
          ).
        </p>
      )}

      <section className={cn(panelClass, 'overflow-x-auto')}>
        <div className="px-5 py-4 border-b border-light-outline-variant">
          <h2 className="font-title text-title-md text-light-on-surface">Billing History</h2>
        </div>
        <table className="w-full text-left border-collapse min-w-[520px]">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={thClass}>Invoice</th>
              <th className={thClass}>Date</th>
              <th className={cn(thClass, 'text-right')}>Amount</th>
              <th className={thClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3.5 font-mono text-mono-sm text-light-on-surface">{inv.id}</td>
                <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface-variant">{inv.date}</td>
                <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface text-right tabular-nums">{money(inv.amount)}.00</td>
                <td className="px-4 py-3.5">
                  <span className="px-2 py-0.5 rounded bg-success-container text-on-success-container font-label text-label-sm">{inv.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {target && (
        <PlanModal
          target={target}
          current={plan}
          allowed={allowed}
          blockers={target.price < plan.price ? overLimits(usage, target) : []}
          onClose={() => setTarget(null)}
          onConfirm={() => {
            if (allowed) {
              changePlan(target.id)
              toast(`Plan changed to ${target.name}`)
            } else {
              requestPlan(target.id)
              toast(`Request sent to ${owner(s).name}`)
            }
            setTarget(null)
          }}
        />
      )}
    </AdminPage>
  )
}

function PlanModal({
  target,
  current,
  allowed,
  blockers,
  onClose,
  onConfirm,
}: {
  target: Plan
  current: Plan
  allowed: boolean
  blockers: string[]
  onClose: () => void
  onConfirm: () => void
}) {
  const up = target.price > current.price
  const rows: [string, string, string][] = [
    ['Price', `${money(current.price)} / mo`, `${money(target.price)} / mo`],
    ['User seats', String(current.seats), String(target.seats)],
    ['Data sources', String(current.sources), String(target.sources)],
    ['Monthly rows', formatRows(current.rows), formatRows(target.rows)],
    ['Storage', `${current.storageGb} GB`, `${target.storageGb} GB`],
    ['Audit log retention', current.retention, target.retention],
  ]
  return (
    <Modal
      open
      onClose={onClose}
      title={`${up ? 'Upgrade' : 'Downgrade'} to ${target.name}?`}
      description={
        allowed
          ? `The change is prorated from today and appears on the Dec 01 invoice.`
          : `Only the Organization Owner can change the plan. This sends them a request and logs it.`
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={blockers.length > 0}>
            {allowed ? `Confirm ${up ? 'upgrade' : 'downgrade'}` : 'Send request to Owner'}
          </Button>
        </>
      }
    >
      <table className="w-full text-left font-body text-body-sm">
        <thead>
          <tr className="text-light-on-surface-variant">
            <th className="py-1 font-label text-label-sm uppercase" />
            <th className="py-1 font-label text-label-sm uppercase">Now</th>
            <th className="py-1 font-label text-label-sm uppercase">{target.name.replace('Enterprise ', '')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-light-outline-variant">
          {rows.map(([k, a, b]) => (
            <tr key={k}>
              <td className="py-1.5 text-light-on-surface-variant">{k}</td>
              <td className="py-1.5 tabular-nums">{a}</td>
              <td className="py-1.5 tabular-nums font-label text-light-on-surface">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {blockers.length > 0 && (
        <div role="alert" className="mt-3 bg-error-container text-on-error-container rounded p-3 font-body text-body-sm">
          Current usage doesn’t fit this plan:
          <ul className="list-disc pl-5 mt-1">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
