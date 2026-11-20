/** Static option lists rendered by the onboarding steps. */

export const roles = [
  'Founder / Business Owner',
  'Operations Manager',
  'Finance / Controller',
  'IT / Systems Lead',
] as const

export const currencies = ['USD ($)', 'EUR (€)', 'GBP (£)', 'CAD ($)'] as const

export const industries = [
  { value: 'Distribution', icon: 'local_shipping' },
  { value: 'Wholesale', icon: 'inventory_2' },
  { value: 'Manufacturing', icon: 'precision_manufacturing' },
  { value: 'Retail', icon: 'storefront' },
  { value: 'Logistics', icon: 'route' },
  { value: 'Other', icon: 'category' },
] as const

export const businessSizes = [
  { value: '1-10', label: '1 – 10 employees', tier: 'Small business' },
  { value: '11-50', label: '11 – 50 employees', tier: 'Growing team' },
  { value: '51-200', label: '51 – 200 employees', tier: 'Mid-market' },
  { value: '201+', label: '201+ employees', tier: 'Enterprise' },
] as const

export const objectives = [
  'Understand sales performance',
  'Monitor inventory',
  'Manage receivables',
  'Improve purchasing',
  'Improve operational efficiency',
] as const

export const dataSources = [
  { value: 'QuickBooks Online', label: 'QuickBooks Online', scanName: 'QuickBooks Online', popular: true },
  { value: 'Shopify', label: 'Shopify', scanName: 'Shopify', popular: false },
  { value: 'NetSuite', label: 'Oracle NetSuite', scanName: 'Oracle NetSuite', popular: false },
  { value: 'Spreadsheet', label: 'Upload Excel / CSV', scanName: 'uploaded spreadsheet', popular: false },
] as const

export type Role = (typeof roles)[number]
export type Currency = (typeof currencies)[number]
export type Industry = (typeof industries)[number]['value']
export type BusinessSize = (typeof businessSizes)[number]['value']
export type Objective = (typeof objectives)[number]
export type DataSource = (typeof dataSources)[number]['value']

export function dataSourceOption(value: DataSource) {
  return dataSources.find((s) => s.value === value) ?? dataSources[0]
}
