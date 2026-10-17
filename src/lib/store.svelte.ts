import { describeDue, parseDay, todayISO } from './dates'
import { demoData } from './demo'
import type { Connection } from './github'
import type { Merged } from './merge'
import { modelOf, openRepo, Remote, type Base, type Host } from './remote.svelte'
import { inkFor, LIST_FILE, slugify, todoNames } from './repo'
import type { ChangeKind, DayISO, Flash, PendingChange, SyncState, Todo, TodoList, UndoTarget } from './types'

/** Demo lists, on a device that chose to look around before connecting. */
const DEMO_KEY = 'gh-todo:v1'
const DEMO_CHOSEN_KEY = 'gh-todo:demo'
/** This device's token and data repo. Never leaves the device except to api.github.com. */
const CONNECTION_KEY = 'gh-todo:github'
/** The connected repo's lists, pending changes and last-read commit, so work survives reloads offline. */
const REPO_KEY = 'gh-todo:repo:v1'
/** A `#tag` word: letters in any script, digits, `_` and `-`. */
export const TAG_WORD = /^#[\p{L}\p{M}\p{N}_-]+$/u
const FLASH_MS = 1600
const SYNC_DEBOUNCE_MS = 1500
/** A list delete's commit waits at most this long for its undo. */
const DELETE_HOLD_MS = 30_000

interface Saved {
  lists: TodoList[]
  todos: Todo[]
  lastSavedAt: string | null
}

interface SavedRepo extends Saved {
  repo: string
  pending: PendingChange[]
  base: Base
}

/** `setup`: the first-run screen; `demo`: demo data, nothing synced; `connected`: synced with a repo. */
export type Mode = 'setup' | 'demo' | 'connected'

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

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, data: unknown) {
  try {
    localStorage.setItem(key, typeof data === 'string' ? data : JSON.stringify(data))
  } catch {
    // Storage can be full or blocked; the screen keeps working from memory.
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to remove.
  }
}

function repoLabel(c: Connection): string {
  return `${c.owner}/${c.repo}`
}

/** Keep each row's object (and its place in Svelte's keyed lists) when its content is replaced. */
function reconcile<T extends { id: string }>(current: T[], next: T[]): T[] {
  const byId = new Map(current.map((x) => [x.id, x]))
  return next.map((n) => {
    const mine = byId.get(n.id)
    if (!mine || mine === n) return n
    if (JSON.stringify(mine) !== JSON.stringify(n)) Object.assign(mine, n)
    return mine
  })
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

class Store implements Host {
  mode = $state<Mode>('setup')
  /** The setup screen, opened over the app to connect from the demo or replace a token. */
  setupOpen = $state(false)
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
  /** `holdUntil`: no commit before then (ms), so undoing a list delete never reaches GitHub. */
  toast = $state<{ id: number; message: string; undo?: () => UndoTarget; holdUntil?: number } | null>(null)
  #toastPaused = false
  /** While a toast's undo is on offer: to-dos it would bring back that another device has deleted since. */
  #goneElsewhere = new Set<string>()
  /** While a list delete's undo is on offer: its folder, so a new list doesn't take it. */
  #undoSlugs = new Set<string>()
  /** Lists folded in the main column, by id. */
  openDone = $state<Record<string, boolean>>({})

  readonly remote: Remote
  sealed = 0
  #seq = 0
  #forced: SyncState | null = null
  #syncTimer: ReturnType<typeof setTimeout> | undefined
  #persistTimer: ReturnType<typeof setTimeout> | undefined
  #toastTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    const connection = read<Connection>(CONNECTION_KEY)
    const savedRepo = connection ? read<SavedRepo>(REPO_KEY) : null
    const saved = connection && savedRepo?.repo === repoLabel(connection) ? savedRepo : null
    this.remote = new Remote(this, saved?.base ?? null)
    this.#forced = connection ? null : forcedSync()

    if (connection) {
      this.mode = 'connected'
      this.lists = saved?.lists ?? []
      this.todos = saved?.todos ?? []
      this.pending = saved?.pending ?? []
      this.lastSavedAt = saved?.lastSavedAt ?? null
      this.#seq = Math.max(0, ...this.pending.map((c) => c.seq))
    } else if (this.#forced || new URLSearchParams(location.search).has('demo') || read(DEMO_CHOSEN_KEY)) {
      this.#loadDemo()
    }
    this.sync = this.pending.length ? { kind: 'saving' } : { kind: 'saved', at: this.lastSavedAt }

    if (this.#forced) {
      this.sync = this.#forced
      if (this.#forced.kind !== 'conflict') {
        const sample = this.todos.filter((t) => !t.done).slice(1, 3)
        this.pending = sample.map((t) => this.#change('edited', t))
      }
    }

    if (connection) this.remote.start(connection)

    window.addEventListener('online', () => {
      if (this.mode === 'demo') this.#scheduleSync()
    })
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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return
      // The page may not come back (an app closed on a phone sends only this): save the last edit now.
      this.#flush()
      // Leaving the page lets a held list delete go now; the undo stays on offer.
      if (this.toast?.holdUntil) this.#releaseHold()
    })
    // A reload, a navigation or a closed tab.
    window.addEventListener('pagehide', () => this.#flush())
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

  /** Open and done to-dos in a list, whatever the tag filter. */
  countsIn(listId: string): { open: number; done: number } {
    let open = 0
    let done = 0
    for (const t of this.todos) if (t.listId === listId) t.done ? done++ : open++
    return { open, done }
  }

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
    this.#ensureList()
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
      // Already back (kept by a merge), or deleted on another device since: nothing to restore.
      if (this.find(t.id) || this.#goneElsewhere.has(t.id)) return null
      this.todos.splice(Math.min(at, this.todos.length), 0, t)
      this.#record('added', t)
      this.#announce(`Restored ${t.title}`)
      return { todo: t.id }
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
    this.#record('edited', other)
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
      const back = gone.filter((t) => !this.find(t.id) && !this.#goneElsewhere.has(t.id))
      this.todos.push(...back)
      for (const t of back) this.#record('added', t)
      this.#announce(`Restored ${back.length} done in ${list?.name ?? 'list'}`)
      return null
    })
  }

  addList(name: string): TodoList | null {
    const clean = name.trim()
    if (!clean) return null
    const index = Math.max(0, ...this.lists.map((l) => l.index)) + 1
    // A list is a folder in the data repo, so its id is its folder name. A deleted list's folder stays
    // taken until its delete is on GitHub and can't be undone.
    const taken = (s: string) =>
      this.lists.some((l) => l.id === s || l.slug === s) ||
      this.#undoSlugs.has(s) ||
      this.pending.some((c) => c.kind === 'list' && c.id === s)
    let slug = slugify(clean)
    for (let n = 2; taken(slug); n++) slug = `${slugify(clean)}-${n}`
    const list: TodoList = { id: slug, slug, index, name: clean, ink: inkFor(index) }
    this.lists.push(list)
    this.#recordList(list)
    this.#announce(`New list ${label(list)}`)
    return list
  }

  /** Only the name in the list's `_list.md` changes: its folder, id, number and ink stay. */
  renameList(id: string, name: string): boolean {
    const list = this.listById.get(id)
    const clean = name.trim()
    if (!list || !clean || clean === list.name) return false
    const before = list.name
    list.name = clean
    this.#recordList(list)
    this.#announce(`Renamed ${pad2(list.index)} ${before} to ${clean}. Press U to undo.`)
    this.#showToast(`Renamed “${before}” to “${clean}”`, () => {
      const now = this.listById.get(id)
      if (now) {
        now.name = before
        this.#recordList(now)
        this.#announce(`Name restored: ${label(now)}`)
      }
      return null
    })
    return true
  }

  /**
   * A list and every to-do in it, open and done. The other lists keep their numbers, and the only list
   * stays. The commit waits while the undo is on offer, so an undo never reaches GitHub.
   */
  deleteList(id: string): boolean {
    const at = this.lists.findIndex((l) => l.id === id)
    if (at < 0 || this.lists.length < 2) return false
    const list = this.lists[at]
    const wasCapture = this.inbox().id === id
    const gone = this.todos.filter((t) => t.listId === id)
    // GitHub's copy at the time, so an undo can tell a rename made elsewhere meanwhile.
    const file = this.remote.base.files[`${list.slug}/${LIST_FILE}`]
    const before = file && 'list' in file ? { ...file.list } : null
    // Recorded while the list is still here, so each path names its real folder.
    for (const t of gone) this.#push(this.#change('removed', t))
    this.todos = this.todos.filter((t) => t.listId !== id)
    this.lists.splice(at, 1)
    delete this.openDone[id]
    this.#push(this.#listChange(list))
    this.#persistNow()

    const withTodos = gone.length ? ` and its ${gone.length} ${gone.length === 1 ? 'to-do' : 'to-dos'}` : ''
    const moved = wasCapture ? `. New to-dos go to ${label(this.inbox())}` : ''
    const message = `Deleted list ${label(list)}${withTodos}${moved}`
    this.#announce(`${message}. Press U to undo.`)
    this.#showToast(
      message,
      () => {
        let target = this.listById.get(id)
        let renumbered = false
        if (!target) {
          const restored = { ...list }
          // Renamed or re-inked on another device since the delete: keep that device's fields.
          const now = this.remote.base.files[`${list.slug}/${LIST_FILE}`]
          if (before && now && 'list' in now) {
            for (const k of ['index', 'name', 'ink'] as const) {
              if (now.list[k] !== before[k]) (restored as Record<string, unknown>)[k] = now.list[k]
            }
          }
          if (this.lists.some((l) => l.index === restored.index)) {
            restored.index = Math.max(0, ...this.lists.map((l) => l.index)) + 1
            renumbered = true
          }
          this.lists.splice(Math.min(at, this.lists.length), 0, restored)
          this.#push(this.#listChange(restored))
          target = restored
        }
        // Already back (kept by a merge), or deleted on another device since: those stay as they are.
        const back = gone.filter((t) => !this.find(t.id) && !this.#goneElsewhere.has(t.id))
        const skipped = gone.filter((t) => this.#goneElsewhere.has(t.id)).length
        for (const t of back) {
          this.todos.push(t)
          this.#push(this.#change('added', t))
        }
        this.#persistNow()
        this.#scheduleSync()
        const n = back.length ? `${back.length} ${back.length === 1 ? 'to-do' : 'to-dos'}` : ''
        let text = renumbered
          ? `Restored list ${target.name} as ${pad2(target.index)}${n ? `, with its ${n}` : ''}`
          : `Restored list ${label(target)}${n ? ` and its ${n}` : ''}`
        if (skipped) text += `. ${skipped} ${skipped === 1 ? 'was' : 'were'} deleted on another device`
        this.#announce(`${text}.`)
        return { list: target.id }
      },
      this.mode === 'connected' ? Date.now() + DELETE_HOLD_MS : undefined,
    )
    this.#undoSlugs.add(list.slug)
    // After the toast, so sync sees its hold.
    this.#scheduleSync()
    return true
  }

  /** The only list can't be deleted; say why. */
  refuseDeleteList(id: string) {
    const list = this.listById.get(id)
    if (!list) return
    const text = `${label(list)} is the only list. Add another before deleting it.`
    this.#announce(text)
    // An undo still on offer (the delete that left one list) matters more than the refusal's slip.
    if (!this.toast?.undo) this.#showToast(text)
  }

  setTagFilter(tag: string | null) {
    this.tagFilter = tag
    this.#announce(tag ? `Showing #${tag} only` : 'Showing everything')
  }

  /** The latest edit was already kept; acknowledging the conflict only clears the banner. */
  dismissConflict() {
    this.#forced = null
    this.sync = this.mode === 'connected' && this.pending.length ? { kind: 'saving' } : { kind: 'saved', at: this.lastSavedAt }
  }

  retrySync() {
    this.#forced = null
    if (this.mode === 'connected') {
      if (this.sync.kind === 'failed' && this.sync.fix === 'reconnect') this.openSetup()
      else this.remote.retry()
      return
    }
    if (this.pending.length) this.#scheduleSync()
    else this.sync = { kind: 'saved', at: this.lastSavedAt }
  }

  // ---- connecting ----------------------------------------------------------

  /**
   * Check the token, read the repo, and switch this device over to it. Throws a
   * `SetupError` for the setup screen. The same repo again (a replaced token)
   * keeps everything on the device, pending changes included.
   */
  async connect(token: string, repoText: string, step: (text: string) => void) {
    const { connection, base } = await openRepo(token, repoText, step)
    const same = this.mode === 'connected' && this.remote.repoName.toLowerCase() === repoLabel(connection).toLowerCase()
    if (!same) {
      if (this.mode === 'connected') this.remote.stop()
      this.remote.base = base
      const model = modelOf(base)
      this.lists = model.lists
      this.todos = model.todos
      this.pending = []
      this.lastSavedAt = null
      this.tagFilter = null
      this.openDone = {}
      this.#forced = null
    }
    this.mode = 'connected'
    this.setupOpen = false
    write(CONNECTION_KEY, connection)
    forget(DEMO_CHOSEN_KEY)
    this.sync = this.pending.length ? { kind: 'saving' } : { kind: 'saved', at: this.lastSavedAt }
    this.#ensureList()
    this.#persistNow()
    this.remote.start(connection)
  }

  /** Forget the token and the lists on this device. The repo keeps everything it has. */
  disconnect() {
    this.remote.stop()
    forget(CONNECTION_KEY)
    forget(REPO_KEY)
    this.lists = []
    this.todos = []
    this.pending = []
    this.lastSavedAt = null
    this.tagFilter = null
    this.sync = { kind: 'saved', at: null }
    this.mode = 'setup'
    this.setupOpen = false
  }

  useDemo() {
    write(DEMO_CHOSEN_KEY, '1')
    this.#loadDemo()
    this.setupOpen = false
  }

  openSetup() {
    this.setupOpen = true
  }

  closeSetup() {
    if (this.mode !== 'setup') this.setupOpen = false
  }

  /** The repo path a to-do has, or will have once committed. */
  pathOf(t: Todo): string {
    const folder = this.listById.get(t.listId)?.slug ?? t.listId
    const [plain, unique] = todoNames(t, folder)
    return this.remote.pathsOf(t.id).find((p) => p === plain || p === unique) ?? plain
  }

  // ---- from sync -----------------------------------------------------------

  /** Take in a merge with what GitHub holds. */
  adopt(m: Merged) {
    if (this.toast?.undo) {
      // Deleted here and on another device too: an undo must not bring those back.
      const merged = new Set(m.todos.map((t) => t.id))
      for (const c of this.pending) if (c.kind === 'removed' && m.cleanTodos.has(c.id) && !merged.has(c.id)) this.#goneElsewhere.add(c.id)
    }
    this.todos = reconcile(this.todos, m.todos)
    this.lists = reconcile(this.lists, m.lists)
    this.pending = this.pending.filter((c) => !(c.kind === 'list' ? m.cleanLists.has(c.id) : m.cleanTodos.has(c.id)))
    for (const id of m.relist) {
      const list = this.lists.find((l) => l.id === id)
      if (list) this.#push(this.#listChange(list))
    }
    if (!this.lists.length) {
      this.lists.push({ id: 'inbox', slug: 'inbox', index: 1, name: 'Inbox', ink: 1 })
      this.#push(this.#listChange(this.lists[0]))
    }
  }

  /** Changes up to `seq` are committed. */
  settle(seq: number) {
    this.pending = this.pending.filter((c) => c.seq > seq)
    this.lastSavedAt = new Date().toISOString()
    this.#persistNow()
  }

  persist() {
    this.#persistNow()
  }

  dismissToast() {
    this.#toastPaused = false
    this.#hideToast()
  }

  /** Runs the toast's undo; returns what it restored, for focus. */
  undo(): UndoTarget {
    const undo = this.toast?.undo
    if (!undo) return null
    this.#toastPaused = false
    // The undo reads what the toast's window gathered, so it runs before the toast goes.
    const restored = undo()
    this.#hideToast()
    return restored
  }

  pauseToast(paused: boolean) {
    this.#toastPaused = paused
    clearTimeout(this.#toastTimer)
    if (!paused && this.toast) this.#toastTimer = setTimeout(() => this.#hideToast(), 4000)
  }

  /** No commit before this time (ms): a list delete waits while its undo is on offer. */
  get commitHold(): number {
    return this.toast?.holdUntil ?? 0
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
    return { kind, id: t.id, path: this.pathOf(t), title: t.title, at: new Date().toISOString(), seq: ++this.#seq }
  }

  #listChange(l: TodoList): PendingChange {
    return { kind: 'list', id: l.id, path: `${l.slug}/${LIST_FILE}`, title: l.name, at: new Date().toISOString(), seq: ++this.#seq }
  }

  /** One pending entry per file: a later change replaces an earlier one that isn't on its way to GitHub yet. */
  #push(c: PendingChange) {
    const isList = c.kind === 'list'
    const mine = (p: PendingChange) => p.id === c.id && (p.kind === 'list') === isList
    const at = this.pending.findLastIndex((p) => mine(p) && p.seq > this.sealed)
    if (at >= 0) {
      const prev = this.pending[at]
      this.pending.splice(at, 1)
      if (prev.kind === 'added') {
        // Added and deleted before it ever reached GitHub: nothing left to send.
        if (c.kind === 'removed' && !this.remote.pathsOf(c.id).length && !this.pending.some(mine)) return
        if (c.kind !== 'removed') c = { ...c, kind: 'added' }
      }
    }
    this.pending.push(c)
  }

  #record(kind: ChangeKind, t: Todo) {
    this.#push(this.#change(kind, t))
    this.#persist()
    this.#scheduleSync()
  }

  #recordList(l: TodoList) {
    this.#push(this.#listChange(l))
    this.#persist()
    this.#scheduleSync()
  }

  /** Captures file into the first list, so there always is one. */
  #ensureList() {
    if (this.lists.length) return
    const inbox: TodoList = { id: 'inbox', slug: 'inbox', index: 1, name: 'Inbox', ink: 1 }
    this.lists.push(inbox)
    if (this.mode === 'connected') this.#recordList(inbox)
  }

  #loadDemo() {
    const saved = read<Saved>(DEMO_KEY)
    const seed = saved ?? { ...demoData(this.today), lastSavedAt: null }
    this.lists = seed.lists
    this.todos = seed.todos
    this.lastSavedAt = seed.lastSavedAt
    this.sync = { kind: 'saved', at: seed.lastSavedAt }
    this.mode = 'demo'
    if (!saved) this.#persistNow()
  }

  #scheduleSync() {
    if (this.#forced) return
    if (this.mode === 'connected') {
      this.remote.schedule()
      return
    }
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
      // Demo data: nothing is sent anywhere, so changes settle on this device.
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

  /**
   * Write now what the 300 ms save still holds. A tab with nothing waiting writes nothing, so it can't
   * put stale state over another tab's save; one with a change waiting overwrites it, as its timer would.
   */
  #flush() {
    if (this.#persistTimer !== undefined) this.#persistNow()
  }

  #persistNow() {
    clearTimeout(this.#persistTimer)
    this.#persistTimer = undefined
    const lists = $state.snapshot(this.lists)
    const todos = $state.snapshot(this.todos)
    if (this.mode === 'demo') write(DEMO_KEY, { lists, todos, lastSavedAt: this.lastSavedAt } satisfies Saved)
    if (this.mode !== 'connected') return
    write(REPO_KEY, {
      repo: this.remote.repoName,
      lists,
      todos,
      lastSavedAt: this.lastSavedAt,
      pending: $state.snapshot(this.pending),
      base: this.remote.base,
    } satisfies SavedRepo)
  }

  #announce(text: string) {
    this.announcement = ''
    queueMicrotask(() => (this.announcement = text))
  }

  #showToast(message: string, undo?: () => UndoTarget, holdUntil?: number) {
    // The toast it replaces takes its undo, and its commit hold, with it.
    if (this.toast) this.#hideToast()
    this.toast = { id: Date.now(), message, undo, holdUntil }
    if (!this.#toastPaused) this.#toastTimer = setTimeout(() => this.#hideToast(), 8000)
  }

  #hideToast() {
    clearTimeout(this.#toastTimer)
    const held = !!this.toast?.holdUntil
    this.toast = null
    this.#goneElsewhere.clear()
    this.#undoSlugs.clear()
    if (held) this.#releaseHold()
  }

  /** A held list delete may go now: sync recomputes when to commit. */
  #releaseHold() {
    if (this.toast) this.toast.holdUntil = 0
    if (this.mode === 'connected' && this.pending.length) this.remote.schedule()
  }
}

export function label(list: TodoList): string {
  return `${String(list.index).padStart(2, '0')} ${list.name}`
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export const store = new Store()
