import type { DayISO } from './types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MINUS = '−'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function toISO(d: Date): DayISO {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromISO(iso: DayISO): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(now = new Date()): DayISO {
  return toISO(now)
}

export function addDays(iso: DayISO, n: number): DayISO {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: DayISO, b: DayISO): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000)
}

/** `Fri 16.10` */
export function formatDay(iso: DayISO): string {
  const d = fromISO(iso)
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
}

/** `16.10` */
export function formatShort(iso: DayISO): string {
  const d = fromISO(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
}

export function formatTime(stamp: string): string {
  const d = new Date(stamp)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type DueKind = 'late' | 'today' | 'soon' | 'later'

export interface DueLabel {
  kind: DueKind
  /** What the margin shows: `−2d`, `today`, `Tue 20.10`, `31.10`. */
  label: string
  /** What a screen reader hears. */
  spoken: string
}

export function describeDue(due: DayISO, today: DayISO): DueLabel {
  const delta = diffDays(today, due)
  if (delta < 0) {
    const days = -delta
    return { kind: 'late', label: `${MINUS}${days}d`, spoken: `${days} ${days === 1 ? 'day' : 'days'} late, was due ${formatDay(due)}` }
  }
  if (delta === 0) return { kind: 'today', label: 'today', spoken: 'due today' }
  if (delta === 1) return { kind: 'soon', label: 'tomorrow', spoken: 'due tomorrow' }
  if (delta <= 6) return { kind: 'soon', label: formatDay(due), spoken: `due ${formatDay(due)}` }
  return { kind: 'later', label: formatShort(due), spoken: `due ${formatDay(due)}` }
}

const DAY_WORDS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/**
 * Reads the date words people type after `<`: `today`, `tomorrow`, a weekday
 * (`fri`), `24.10`, `+3`, `next week`, or `none`. Returns `undefined` when the
 * text is not a date, `null` for "no date".
 */
export function parseDay(input: string, today: DayISO): DayISO | null | undefined {
  const s = input.trim().toLowerCase()
  if (!s) return undefined
  if (s === 'none' || s === 'no date' || s === 'clear') return null
  if (s === 'today' || s === 'tod' || s === 'tdy') return today
  if (s === 'tomorrow' || s === 'tom' || s === 'tmr') return addDays(today, 1)
  if (s === 'next week' || s === 'nw') {
    const dow = fromISO(today).getDay()
    return addDays(today, ((8 - dow) % 7) || 7)
  }
  const plus = s.match(/^\+?(\d{1,3})\s*(d|days?)?$/)
  if (plus && (s.startsWith('+') || plus[2])) return addDays(today, Number(plus[1]))
  const plusWeeks = s.match(/^\+?(\d{1,2})\s*w(eeks?)?$/)
  if (plusWeeks) return addDays(today, Number(plusWeeks[1]) * 7)
  const word = s.slice(0, 3)
  if (word in DAY_WORDS && /^[a-z]+$/.test(s)) {
    const dow = fromISO(today).getDay()
    return addDays(today, ((DAY_WORDS[word] - dow + 7) % 7) || 7)
  }
  const dm = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/)
  if (dm) {
    const day = Number(dm[1])
    const month = Number(dm[2]) - 1
    const build = (y: number) => {
      const c = new Date(y, month, day)
      return c.getMonth() === month && c.getDate() === day ? c : null
    }
    if (dm[3]) {
      const c = build(Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]))
      return c ? toISO(c) : undefined
    }
    // No year: the next time that day comes round (a leap day is at most eight years away).
    const year = fromISO(today).getFullYear()
    for (let y = year; y <= year + 8; y++) {
      const c = build(y)
      if (c && toISO(c) >= today) return toISO(c)
    }
    return undefined
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const y = Number(iso[1])
    if (y < 1970 || y > 2999) return undefined
    const c = new Date(y, Number(iso[2]) - 1, Number(iso[3]))
    return toISO(c) === s ? s : undefined
  }
  return undefined
}
