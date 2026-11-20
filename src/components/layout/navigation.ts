export type NavItem = { label: string; icon: string; to: string }

export const platformNav: NavItem[] = [
  { label: 'Command Center', icon: 'dashboard', to: '/command-center' },
  { label: 'Connect', icon: 'hub', to: '/connect' },
  { label: 'Trust', icon: 'verified_user', to: '/trust' },
  { label: 'Insights', icon: 'insights', to: '/insights' },
  { label: 'Intelligence', icon: 'psychology', to: '/intelligence' },
  { label: 'Automate', icon: 'bolt', to: '/automate' },
]

export const adminNav: NavItem[] = [
  { label: 'Users and Permissions', icon: 'group', to: '/users-permissions' },
  { label: 'Audit Logs', icon: 'history', to: '/audit-logs' },
  { label: 'Settings', icon: 'settings', to: '/settings' },
  { label: 'Billing', icon: 'credit_card', to: '/billing' },
]

export const organizations = [
  { name: 'Acme Global Corp', initials: 'AC' },
  { name: 'Acme EMEA Staging', initials: 'AE' },
]
