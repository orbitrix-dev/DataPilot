import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { categoryMeta, useActivity, type Activity, type ActivityCategory } from '../activity'
import { ActivityRow, CCHeader, CCTabs } from '../components/parts'

const categories = Object.keys(categoryMeta) as ActivityCategory[]

/** Recent activity (designed: command_center_recent_activity). The category filter was not designed. */
export function ActivityPage() {
  usePageChrome([{ label: 'Command Center', to: '/command-center' }, { label: 'Recent activity' }])
  const all = useActivity()
  const [params, setParams] = useSearchParams()
  const param = params.get('type')
  const active = categories.includes(param as ActivityCategory) ? (param as ActivityCategory) : null

  const items = active ? all.filter((i) => i.category === active) : all
  const groups = useMemo(() => {
    const out: { day: string; items: Activity[] }[] = []
    for (const item of items) {
      const last = out[out.length - 1]
      if (last && last.day === item.day) last.items.push(item)
      else out.push({ day: item.day, items: [item] })
    }
    return out
  }, [items])

  const select = (c: ActivityCategory | null) => setParams(c ? { type: c } : {}, { replace: true })
  const chip = (selected: boolean) =>
    cn(
      'px-3 py-1.5 rounded-full border font-label text-label-md tabular-nums transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
      selected ? 'bg-light-primary text-light-on-primary border-light-primary' : 'bg-light-surface border-light-outline text-light-on-surface hover:bg-light-surface-container',
    )

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader
        title="Recent activity"
        description="Chronological feed across data synchronization, report generation, AI recommendations, workflow approvals, and user actions."
      />
      <CCTabs />

      <div role="group" aria-label="Filter by activity type" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!active} className={chip(!active)} onClick={() => select(null)}>
          All ({all.length})
        </button>
        {categories.map((c) => {
          const n = all.filter((i) => i.category === c).length
          return (
            <button key={c} type="button" aria-pressed={active === c} className={chip(active === c)} onClick={() => select(c)}>
              {categoryMeta[c].label} ({n})
            </button>
          )
        })}
      </div>

      <div className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-5">
        {groups.length === 0 && <p className="font-body text-body-md text-light-on-surface-variant">No activity of this type.</p>}
        {groups.map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h2 className="font-label text-label-sm uppercase text-light-on-surface-variant pb-1 border-b border-light-outline-variant">{g.day}</h2>
            <div className="divide-y divide-light-outline-variant">
              {g.items.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
