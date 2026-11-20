import { Link } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'

export function BackToSignIn() {
  return (
    <Link
      to="/login"
      className="inline-flex items-center justify-center gap-1.5 font-label text-label-md text-light-on-surface-variant hover:text-light-on-surface"
    >
      <Icon name="arrow_back" size={16} />
      <span>Back to sign in</span>
    </Link>
  )
}
