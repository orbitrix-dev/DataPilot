import { Link } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { dataSources } from '../data'
import { btnBack, btnPrimary } from '../styles'
import { useWizard } from './context'

/** Step 1 — Choose source (extrapolated: marketplace database cards as a radio group). */
export function SourceStep() {
  const { preset, chooseSource, goTo } = useWizard()
  const sources = dataSources.filter((s) => s.category === 'database')

  return (
    <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-gutter-md">
      <div>
        <h1 className="font-headline text-headline-md text-light-on-surface">Choose a source to connect</h1>
        <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
          Databases and cloud platforms connect with encrypted, read-only credentials.
        </p>
      </div>

      <fieldset>
        <legend className="sr-only">Data source</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-md">
          {sources.map((s) => {
            const checked = s.id === preset.sourceId
            return (
              <label
                key={s.id}
                className={cn(
                  'cursor-pointer rounded-md p-5 flex items-start gap-4 border transition-colors',
                  checked
                    ? 'border-light-primary bg-light-primary-container/30'
                    : 'border-light-outline-variant bg-light-surface hover:border-light-primary',
                )}
              >
                <input
                  type="radio"
                  name="source"
                  checked={checked}
                  onChange={() => chooseSource(s.id)}
                  className="mt-1 text-light-primary focus:ring-light-primary"
                />
                <div className="w-10 h-10 rounded bg-light-primary-container text-light-on-primary-container flex items-center justify-center shrink-0">
                  <Icon name={s.icon ?? 'database'} size={22} />
                </div>
                <div>
                  <p className="font-title text-title-md text-light-on-surface">{s.name}</p>
                  <p className="font-body text-body-sm text-light-on-surface-variant mt-1">{s.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      </fieldset>

      <p className="font-body text-body-sm text-light-on-surface-variant">
        Working from spreadsheets or exports?{' '}
        <Link to="/connect/upload" className="font-label text-label-md text-light-primary hover:underline">
          Upload files instead
        </Link>
      </p>

      <div className="pt-4 border-t border-light-outline-variant flex items-center justify-between">
        <Link to="/connect/marketplace" className={btnBack}>
          Back
        </Link>
        <button type="button" onClick={() => goTo('details')} className={btnPrimary}>
          Continue to Connection details
        </button>
      </div>
    </section>
  )
}
