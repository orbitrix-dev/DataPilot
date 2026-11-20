/** "$2,841,920" */
export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** "24.8%" */
export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`
}

/** "+11.4%" / "-3.0%" */
export function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

export function growthPct(current: number, prior: number): number {
  return ((current - prior) / prior) * 100
}

export function marginPct(revenue: number, cogs: number): number {
  return ((revenue - cogs) / revenue) * 100
}
