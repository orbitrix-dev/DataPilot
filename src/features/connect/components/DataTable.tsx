import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'
import { thClass } from '../styles'

export type Column<T> = {
  key: string
  header: ReactNode
  align?: 'left' | 'right'
  /** Extra classes for both <th> and <td>. */
  className?: string
  /** Classes for the <td> (defaults to `px-4 py-3`). */
  cellClassName?: string
  cell: (row: T) => ReactNode
}

/** Stitch `table-interactive`: surface-container header, divided rows, hover tint. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  hover = true,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  hover?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead className="bg-light-surface-container border-b border-light-outline-variant">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn(thClass, c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-light-outline-variant">
          {rows.map((row) => (
            <tr key={rowKey(row)} className={cn(hover && 'hover:bg-light-surface-container-low')}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-4 py-3', c.align === 'right' && 'text-right', c.className, c.cellClassName)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
