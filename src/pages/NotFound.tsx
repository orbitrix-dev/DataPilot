import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export function NotFound() {
  useDocumentTitle('Page not found')
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-mono text-mono-sm text-light-on-surface-variant">404</p>
      <h1 className="font-headline text-headline-lg text-light-on-surface">Page not found</h1>
      <p className="font-body text-body-md text-light-on-surface-variant">The page you requested does not exist or was moved.</p>
      <Link to="/" className="mt-2 px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg">
        Go to workspace
      </Link>
    </div>
  )
}
