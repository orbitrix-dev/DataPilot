import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { usd } from '../../insights/format'
import { Code, Eyebrow, FollowUps, MetaItem, StatTile, TextLink } from '../components/AnswerParts'
import { askPath, AS_OF, findAnswer, overdue, type Answer } from '../data'
import { useFreshness, useReliability } from '../trust'

/** Evidence-backed chat answer (designed: intelligence_ai_assistant_conversation, for overdue payments). */
export function ConversationAnswer({ answer }: { answer: Answer }) {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Conversation' }])
  const reliability = useReliability(answer)
  const freshness = useFreshness(answer.sources[0])
  const qualified = reliability.status === 'qualified'
  const apexShare = Math.round((overdue.largest.amount / overdue.total) * 100)
  const stock = findAnswer('stockout-risk')!

  return (
    <div className="max-w-4xl w-full mx-auto flex flex-col gap-section">
      <div className="self-end bg-light-primary text-light-on-primary rounded-md px-4 py-3 max-w-xl">
        <h1 className="font-body text-body-md">{answer.question}</h1>
      </div>

      <article className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-5">
        {qualified && (
          <div role="status" className="p-3.5 rounded bg-warning-container/40 border border-warning flex items-start gap-3">
            <Icon name="warning" className="text-warning shrink-0" />
            <p className="font-body text-body-sm text-light-on-surface">
              <strong>Data reliability qualification (Trust {reliability.qualifiedBy}):</strong> 14 duplicate invoice rows are
              under review in <Code>public.invoices</Code>. Totals below reflect verified unique invoice IDs only.{' '}
              <TextLink to={reliability.to!}>View incident →</TextLink>
            </p>
          </div>
        )}

        <div>
          <Eyebrow>Direct answer</Eyebrow>
          <p className="font-body text-body-lg text-light-on-surface mt-1 text-pretty">
            <strong>{overdue.accounts} wholesale accounts</strong> have overdue balances totaling{' '}
            <strong className="tabular-nums">{usd(overdue.total)}</strong> past 60 days as of {AS_OF}.{' '}
            {overdue.largest.customer} accounts for {apexShare}% of that balance, all of it more than 90 days overdue.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile size="sm" label="Overdue (61+ days)" value={usd(overdue.total)} valueClass="text-error" />
          <StatTile size="sm" label="Accounts affected" value={String(overdue.accounts)} />
          <StatTile size="sm" label="Largest balance" value={usd(overdue.largest.amount)} caption={overdue.largest.customer} />
        </div>

        <div className="overflow-x-auto border border-light-outline-variant rounded-md">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Largest overdue accounts</caption>
            <thead>
              <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
                {['Account', 'Overdue', 'Oldest invoice'].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn('px-4 py-2.5 font-label text-label-sm uppercase text-light-on-surface-variant', i > 0 && 'text-right')}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-light-outline-variant">
              {overdue.rows.map((r) => (
                <tr key={r.customer}>
                  <td className="px-4 py-3 font-label text-label-md text-light-on-surface">{r.customer}</td>
                  <td className={cn('px-4 py-3 text-right font-mono text-mono-sm', r.oldestDays > 90 ? 'text-error' : 'text-warning')}>
                    {usd(r.overdue)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-mono-sm text-light-on-surface">{r.oldestDays} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-y border-light-outline-variant">
          <MetaItem label="Date range">As of {AS_OF}</MetaItem>
          <MetaItem label="Data source">
            <Code>{answer.sources[0]}</Code>
          </MetaItem>
          <MetaItem label="Freshness">{freshness}</MetaItem>
          <MetaItem label="Reliability">
            <span className={cn('font-label', qualified ? 'text-warning' : 'text-success')}>{reliability.label}</span>
          </MetaItem>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-body text-body-sm text-light-on-surface-variant">
            <strong>Calculation:</strong> Sum of <Code>balance_due</Code> where <Code>due_date &lt; CURRENT_DATE - 60</Code>,
            deduplicated by <Code>invoice_no</Code>.
          </p>
          <TextLink to={`/intelligence/evidence/${answer.id}`}>Inspect SQL &amp; evidence →</TextLink>
        </div>

        <FollowUps
          inline
          items={[
            { label: 'Show Apex Hardware aging breakdown', to: '/insights/receivables' },
            { label: 'Open the receivables aging report', to: '/insights/reports/receivables-aging' },
            { label: stock.question, to: askPath(stock.question) },
          ]}
        />
      </article>
    </div>
  )
}
