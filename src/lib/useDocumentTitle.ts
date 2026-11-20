import { useEffect } from 'react'

/** Sets `<title>` to "<title> — DataPilot". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — DataPilot`
  }, [title])
}
