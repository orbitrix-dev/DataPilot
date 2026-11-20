import { createContext, useContext, useEffect } from 'react'

export type Crumb = { label: string; to?: string }

export const ShellContext = createContext<{ setCrumbs: (c: Crumb[]) => void }>({ setCrumbs: () => {} })

/**
 * Call from any page rendered inside <AppShell> to set the topbar breadcrumb
 * and document title. The last crumb is the current page.
 *
 *   usePageChrome([{ label: 'Connect', to: '/connect' }, { label: 'Sync history' }])
 */
export function usePageChrome(crumbs: Crumb[]) {
  const { setCrumbs } = useContext(ShellContext)
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    const parsed: Crumb[] = JSON.parse(key)
    setCrumbs(parsed)
    const last = parsed[parsed.length - 1]
    if (last) document.title = `${last.label} — DataPilot`
  }, [key, setCrumbs])
}
