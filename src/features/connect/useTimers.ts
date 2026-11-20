import { useCallback, useEffect, useRef } from 'react'

/**
 * Returns `schedule(fn, ms)` for one-shot simulated actions (retry, rotate,
 * import). Every pending timer is cleared when the component unmounts.
 */
export function useTimers() {
  const timers = useRef(new Set<number>())

  useEffect(() => {
    const set = timers.current
    return () => {
      set.forEach((t) => window.clearTimeout(t))
      set.clear()
    }
  }, [])

  return useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }, [])
}
