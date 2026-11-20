import { useMemo, useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'

type Dir = 'asc' | 'desc'

/** Client-side table sorting. Numbers sort high-to-low first; text sorts A–Z first. */
export function useSort<T, A extends Record<string, (row: T) => number | string>>(
  rows: T[],
  accessors: A,
  initial: { key: keyof A & string; dir: Dir },
) {
  type K = keyof A & string
  const [sort, setSort] = useState<{ key: K; dir: Dir }>(initial)

  const sorted = useMemo(() => {
    const get = accessors[sort.key]
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    // accessors are module-level or stable per render; sort only depends on rows + sort state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])

  function header(key: K, label: string, align: 'left' | 'right' = 'left') {
    const active = sort.key === key
    const toggle = () => {
      if (active) setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
      else setSort({ key, dir: typeof accessors[key](rows[0]) === 'number' ? 'desc' : 'asc' })
    }
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={`Sort by ${label}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm hover:text-light-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
          align === 'right' && 'flex-row-reverse',
          active && 'text-light-on-surface',
        )}
      >
        {label}
        <Icon
          name={active ? (sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
          size={16}
          className={active ? '' : 'opacity-50'}
        />
      </button>
    )
  }

  /** Value for the <th aria-sort> attribute. */
  const ariaSort = (key: K): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'

  return { sorted, header, ariaSort }
}
