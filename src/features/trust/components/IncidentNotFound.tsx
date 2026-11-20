import { Link } from 'react-router-dom'
import { EmptyState } from '../../connect/components/EmptyState'

export function IncidentNotFound({ id }: { id?: string }) {
  return (
    <section className="bg-light-surface border border-light-outline-variant rounded-md px-6 py-10">
      <EmptyState icon="search_off" title={`Incident ${id ?? ''} was not found`}>
        <Link to="/trust/incidents" className="font-label text-label-md text-light-primary hover:underline">
          Back to all incidents
        </Link>
      </EmptyState>
    </section>
  )
}
