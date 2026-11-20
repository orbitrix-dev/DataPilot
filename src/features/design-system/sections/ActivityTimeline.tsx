import { timelineEvents } from '../data'

export function ActivityTimeline({ onRefresh }: { onRefresh: () => void }) {
  return (
    <article className="lg:col-span-4 bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-gutter-md">
      <header className="flex items-center justify-between border-b border-light-outline-variant pb-4">
        <h2 className="font-title text-title-lg text-light-on-surface">Activity timeline</h2>
        <button type="button" onClick={onRefresh} className="font-label text-label-md text-light-primary hover:text-light-secondary">
          Refresh
        </button>
      </header>
      <ol className="relative border-l border-light-outline-variant ml-2.5 flex flex-col gap-5">
        {timelineEvents.map((event) => (
          <li key={event.title} className="pl-5 relative">
            <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-light-surface ${event.dotClassName}`} />
            <p className="font-label text-label-md text-light-on-surface">{event.title}</p>
            <p className="font-body text-body-sm text-light-on-surface-variant">
              {event.actor} · <span className="tabular-nums">{event.time}</span>
            </p>
          </li>
        ))}
      </ol>
    </article>
  )
}
