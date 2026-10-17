import { describeDue, parseDay, todayISO } from './dates'
import { demoData, slugify } from './demo'
import type { ChangeKind, DayISO, Flash, PendingChange, SyncState, Todo, TodoList } from './types'

const STORAGE_KEY = 'gh-todo:v1'
/** A `#tag` word: letters in any script, digits, `_` and `-`. */
export const TAG_WORD = /^#[\p{L}\p{M}\p{N}_-]+$/u
const FLASH_MS = 1600
const SYNC_DEBOUNCE_MS = 1500

interface Saved {
  lists: TodoList[]
  todos: Todo[]
  lastSavedAt: string | null
}

/** What a row looked like just before an action, kept for one beat so the mark can be seen. */
interface Hold {
  group: 'late' | 'today' | null
  due: DayISO | null
}

export interface Parsed {
  title: string
  tags: string[]
  listId: string | null
  due: DayISO | null | undefined
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

function writeSaved(data: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage can be full or blocked; the screen keeps working from memory.
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function forcedSync(): SyncState | null {
  // Review aid: `?sync=failed|conflict|offline` pins the indicator in that state.
  const value = new URLSearchParams(location.search).get('sync')
  if (value === 'failed') return { kind: 'failed', message: 'GitHub did not answer. Your changes are kept on this device.' }
  if (value === 'conflict') return { kind: 'conflict', path: 'home/fix-dripping-kitchen-tap.md' }
  if (value === 'offline') return { kind: 'offline' }
  return null
}

class Store {
  lists = $state<TodoList[]>([])
  todos = $state<Todo[]>([])
  today = $state<DayISO>(todayISO())
  tagFilter = $state<string | null>(null)
  flashes = $state<Record<string, Flash>>({})
  holds = $state<Record<string, Hold>>({})
  pending = $state<PendingChange[]>([])
  sync = $state<SyncState>({ kind: 'saved', at: null })
  lastSavedAt = $state<string | null>(null)
  /** Polite live-region text for screen readers. */
  announcement = $state('')
  toast = $state<{ id: number; message: string; undo?: () => string | null } | null>(null)
  #toastPaused = false
  /** Lists folded in the main column, by id. */
  openDone = $state<Record<string, boolean>>({})

  #forced: SyncState | null = null
  #syncTimer: ReturnType<typeof setTimeout> | undefined
  #persistTimer: ReturnType<typeof setTimeout> | undefined
  #toastTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    const saved = readSaved()
    const seed = saved ?? { ...demoData(this.today), lastSavedAt: null }
    this.lists = seed.lists
    this.todos = seed.todos
    this.lastSavedAt = seed.lastSavedAt
    this.sync = { kind: 'saved', at: seed.lastSavedAt }
    if (!saved) this.#persistNow()

    this.#forced = forcedSync()
    if (this.#forced) {
      this.sync = this.#forced
      if (this.#forced.kind !== 'conflict') {
        const sample = this.todos.filter((t) => !t.done).slice(1, 3)
        this.pending = sample.map((t) => this.#change('edited', t))
      }
    }

    window.addEventListener('online', () => this.#scheduleSync())
    window.addEventListener('offline', () => {
      clearTimeout(this.#syncTimer)
      if (!this.#forced) this.sync = { kind: 'offline' }
    })
    const tick = () => {
      const now = todayISO()
      if (now !== this.today) this.today = now
    }
    setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
  }

  // ---- reading -------------------------------------------------------------

  listById = $derived(new Map(this.lists.map((l) => [l.id, l])))

  listsInOrder = $derived([...this.lists].sort((a, b) => a.index - b.index))

  #visible(t: Todo): boolean {
    return !this.tagFilter || t.tags.includes(this.tagFilter)
  }

  /** Overdue, then due today, across every list. Rows acted on stay one beat longer. */
  todayRows = $derived.by(() => {
    const late: Todo[] = []
    const due: Todo[] = []
    for (const t of this.todos) {
      if (!this.#visible(t)) continue
      const hold = this.holds[t.id]
      if (hold) {
        if (hold.group === 'late') late.push(t)
        else if (hold.group === 'today') due.push(t)
        continue
      }
      if (t.done || !t.due) continue
      if (t.due < this.today) late.push(t)
      else if (t.due === this.today) due.push(t)
    }
    const dueOf = (t: Todo) => this.holds[t.id]?.due ?? t.due ?? ''
    const listIndex = (t: Todo) => this.listById.get(t.listId)?.index ?? 0
    late.sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || listIndex(a) - listIndex(b) || a.order - b.order)
    due.sort((a, b) => listIndex(a) - listIndex(b) || a.order - b.order)
    return { late, due }
  })

  openCount = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const t of this.todos) if (!t.done) counts.set(t.listId, (counts.get(t.listId) ?? 0) + 1)
    return counts
  })

  totalOpen = $derived(this.todos.filter((t) => !t.done).length)

  allTags = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const t of this.todos) if (!t.done) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })

  /** Open rows of a list in manual order, including rows held for their mark. */
  openIn(listId: string): Todo[] {
    return this.todos
      .filter((t) => t.listId === listId && (!t.done || this.holds[t.id]) && this.#visible(t))
      .sort((a, b) => a.order - b.order)
  }

  doneIn(listId: string): Todo[] {
    return this.todos
      .filter((t) => t.listId === listId && t.done && !this.holds[t.id] && this.#visible(t))
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  }

  find(id: string): Todo | undefined {
    return this.todos.find((t) => t.id === id)
  }

  listOf(t: Todo): TodoList | undefined {
    return this.listById.get(t.listId)
  }

  inbox(): TodoList {
    return this.listsInOrder[0]
  }

  /** `>07`, `>home`: a list by index or by the start of its name. */
  resolveList(ref: string): TodoList | undefined {
    const r = ref.trim().toLowerCase()
    if (!r) return undefined
    if (/^\d{1,2}$/.test(r)) return this.lists.find((l) => l.index === Number(r))
    return (
      this.listsInOrder.find((l) => l.name.toLowerCase().startsWith(r)) ??
      this.listsInOrder.find((l) => l.slug.startsWith(slugify(r)))
    )
  }

  /** Capture syntax: `Buy stamps #errands >03 <fri`. */
  parse(text: string): Parsed {
    const tags: string[] = []
    let listId: string | null = null
    let due: DayISO | null | undefined
    const words: string[] = []
    for (const word of text.trim().split(/\s+/)) {
      if (TAG_WORD.test(word)) {
        const tag = word.slice(1).normalize('NFC').toLowerCase()
        if (!tags.includes(tag)) tags.push(tag)
      } else if (word.startsWith('>') && word.length > 1 && this.resolveList(word.slice(1))) {
        listId = this.resolveList(word.slice(1))!.id
      } else if (word.startsWith('<') && word.length > 1 && parseDay(word.slice(1), this.today) !== undefined) {
        due = parseDay(word.slice(1), this.today)
      } else if (word) {
        words.push(word)
      }
    }
    return { title: words.join(' '), tags, listId, due }
  }

  search(query: string): { lists: TodoList[]; todos: Todo[] } {
    const q = query.trim().toLowerCase()
    if (!q) return { lists: this.listsInOrder, todos: [] }
    const lists = this.listsInOrder.filter(
      (l) => l.name.toLowerCase().includes(q) || String(l.index).padStart(2, '0') === q.padStart(2, '0'),
    )
    const todos = this.todos
      .filter((t) => this.#visible(t))
      .filter((t) => t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.startsWith(q.replace(/^#/, ''))))
      .sort((a, b) => Number(a.done) - Number(b.done))
      .slice(0, 12)
    return { lists, todos }
  }

  // ---- changing ------------------------------------------------------------

  add(text: string, fallbackListId?: string): Todo | null {
    const parsed = this.parse(text)
    if (!parsed.title) return null
    const listId = parsed.listId ?? fallbackListId ?? this.inbox().id
    const stamp = new Date().toISOString()
    const todo: Todo = {
      id: `t-${uid()}`,
      listId,
      title: parsed.title,
      note: '',
      tags: parsed.tags,
      due: parsed.due ?? null,
      done: false,
      doneAt: null,
      order: this.#nextOrder(listId),
      createdAt: stamp,
      updatedAt: stamp,
    }
    this.todos.push(todo)
    const list = this.listById.get(listId)
    this.#record('added', todo)
    this.#announce(`Logged in ${list ? label(list) : 'Inbox'}: ${todo.title}`)
    return todo
  }

  toggle(id: string) {
    const t = this.find(id)
    if (!t) return
    this.#hold(t)
    t.done = !t.done
    t.doneAt = t.done ? new Date().toISOString() : null
    t.updatedAt = new Date().toISOString()
    this.#record(t.done ? 'done' : 'reopened', t)
    this.#announce(t.done ? `Done: ${t.title}` : `Reopened: ${t.title}`)
  }

  move(id: string, listId: string) {
    const t = this.find(id)
    const list = this.listById.get(listId)
    if (!t || !list || t.listId === listId) return
    this.#hold(t)
    t.listId = listId
    t.order = this.#nextOrder(listId)
    t.updatedAt = new Date().toISOString()
    this.#flash(t.id, '>')
    this.#record('moved', t)
    this.#announce(`Moved to ${label(list)}: ${t.title}`)
  }

  reschedule(id: string, due: DayISO | null) {
    const t = this.find(id)
    if (!t) return
    this.#hold(t)
    t.due = due
    t.updatedAt = new Date().toISOString()
    this.#flash(t.id, '<')
    this.#record('rescheduled', t)
    this.#announce(due ? `Rescheduled to ${describeDue(due, this.today).spoken.replace(/^due /, '')}: ${t.title}` : `Date cleared: ${t.title}`)
  }

  update(id: string, patch: Partial<Pick<Todo, 'title' | 'note' | 'tags'>>) {
    const t = this.find(id)
    if (!t) return
    const next = { ...patch }
    if (next.title !== undefined) next.title = next.title.trim() || t.title
    const changed = Object.entries(next).some(([k, v]) => JSON.stringify(t[k as keyof Todo]) !== JSON.stringify(v))
    if (!changed) return
    Object.assign(t, next, { updatedAt: new Date().toISOString() })
    this.#record('edited', t)
  }

  remove(id: string) {
    const at = this.todos.findIndex((t) => t.id === id)
    if (at < 0) return
    const [t] = this.todos.splice(at, 1)
    this.#record('removed', t)
    this.#announce(`Deleted ${t.title}. Press U to undo.`)
    this.#showToast(`Deleted “${t.title}”`, () => {
      this.todos.splice(Math.min(at, this.todos.length), 0, t)
      this.#record('added', t)
      this.#announce(`Restored ${t.title}`)
      return t.id
    })
  }

  /** Swap a row with its open neighbour in the same list. */
  reorder(id: string, direction: -1 | 1) {
    const t = this.find(id)
    if (!t || t.done) return
    const rows = this.openIn(t.listId).filter((r) => !r.done)
    const i = rows.findIndex((r) => r.id === id)
    const other = rows[i + direction]
    if (!other) return
    ;[t.order, other.order] = [other.order, t.order]
    this.#record('edited', t)
    this.#announce(`Moved ${direction < 0 ? 'up' : 'down'}: ${t.title}, ${i + direction + 1} of ${rows.length}`)
  }

  clearDone(listId: string) {
    const gone = this.todos.filter((t) => t.listId === listId && t.done)
    if (!gone.length) return
    this.todos = this.todos.filter((t) => !(t.listId === listId && t.done))
    for (const t of gone) this.#record('removed', t)
    const list = this.listById.get(listId)
    this.#announce(`Cleared ${gone.length} done in ${list?.name ?? 'list'}. Press U to undo.`)
    this.#showToast(`Cleared ${gone.length} done in ${list?.name ?? 'list'}`, () => {
      this.todos.push(...gone)
      for (const t of gone) this.#record('added', t)
      this.#announce(`Restored ${gone.length} done in ${list?.name ?? 'list'}`)
      return null
    })
  }

  addList(name: string): TodoList | null {
    const clean = name.trim()
    if (!clean) return null
    const index = Math.max(0, ...this.lists.map((l) => l.index)) + 1
    const list: TodoList = { id: `l-${uid()}`, slug: slugify(clean), index, name: clean, ink: ((index - 1) % 12) + 1 }
    this.lists.push(list)
    this.#persist()
    this.#announce(`New list ${label(list)}`)
    return list
  }

  setTagFilter(tag: string | null) {
    this.tagFilter = tag
    this.#announce(tag ? `Showing #${tag} only` : 'Showing everything')
  }

  /** The latest edit was already kept; acknowledging the conflict only clears the banner. */
  dismissConflict() {
    this.#forced = null
    this.sync = { kind: 'saved', at: this.lastSavedAt }
  }

  retrySync() {
    this.#forced = null
    if (this.pending.length) this.#scheduleSync()
    else this.sync = { kind: 'saved', at: this.lastSavedAt }
  }

  dismissToast() {
    clearTimeout(this.#toastTimer)
    this.#toastPaused = false
    this.toast = null
  }

  /** Runs the toast's undo; returns the restored to-do id, if any. */
  undo(): string | null {
    const undo = this.toast?.undo
    if (!undo) return null
    this.dismissToast()
    return undo()
  }

  pauseToast(paused: boolean) {
    this.#toastPaused = paused
    clearTimeout(this.#toastTimer)
    if (!paused && this.toast) this.#toastTimer = setTimeout(() => (this.toast = null), 4000)
  }

  // ---- internals -----------------------------------------------------------

  #nextOrder(listId: string): number {
    return Math.max(0, ...this.todos.filter((t) => t.listId === listId).map((t) => t.order)) + 1
  }

  #hold(t: Todo) {
    if (this.holds[t.id]) return
    const group = t.done || !t.due ? null : t.due < this.today ? 'late' : t.due === this.today ? 'today' : null
    this.holds[t.id] = { group, due: t.due }
    setTimeout(() => delete this.holds[t.id], FLASH_MS)
  }

  #flash(id: string, mark: Flash) {
    this.flashes[id] = mark
    setTimeout(() => {
      if (this.flashes[id] === mark) delete this.flashes[id]
    }, FLASH_MS)
  }

  #change(kind: ChangeKind, t: Todo): PendingChange {
    const list = this.listById.get(t.listId)
    return { kind, path: `${list?.slug ?? 'inbox'}/${slugify(t.title)}.md`, title: t.title, at: new Date().toISOString() }
  }

  #record(kind: ChangeKind, t: Todo) {
    this.pending.push(this.#change(kind, t))
    this.#persist()
    this.#scheduleSync()
  }

  #scheduleSync() {
    if (this.#forced) return
    clearTimeout(this.#syncTimer)
    if (!navigator.onLine) {
      this.sync = { kind: 'offline' }
      return
    }
    this.sync = { kind: 'saving' }
    this.#syncTimer = setTimeout(() => {
      if (!navigator.onLine) {
        this.sync = { kind: 'offline' }
        return
      }
      // GitHub sync is not connected yet: changes settle on this device.
      this.pending = []
      this.lastSavedAt = new Date().toISOString()
      this.sync = { kind: 'saved', at: this.lastSavedAt }
      this.#persistNow()
    }, SYNC_DEBOUNCE_MS)
  }

  #persist() {
    clearTimeout(this.#persistTimer)
    this.#persistTimer = setTimeout(() => this.#persistNow(), 300)
  }

  #persistNow() {
    writeSaved({ lists: $state.snapshot(this.lists), todos: $state.snapshot(this.todos), lastSavedAt: this.lastSavedAt })
  }

  #announce(text: string) {
    this.announcement = ''
    queueMicrotask(() => (this.announcement = text))
  }

  #showToast(message: string, undo?: () => string | null) {
    clearTimeout(this.#toastTimer)
    this.toast = { id: Date.now(), message, undo }
    if (!this.#toastPaused) this.#toastTimer = setTimeout(() => (this.toast = null), 8000)
  }
}

export function label(list: TodoList): string {
  return `${String(list.index).padStart(2, '0')} ${list.name}`
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export const store = new Store()
