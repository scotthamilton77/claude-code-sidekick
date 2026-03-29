export function formatTime(ts: number): string {
  const d = new Date(ts)
  const hms = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hms}.${ms}`
}
