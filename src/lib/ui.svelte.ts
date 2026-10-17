import { tick } from 'svelte'
import { store } from './store.svelte'

export type PaletteMode = 'search' | 'move' | 'tag' | 'rename'

const RAIL_KEY = 'gh-todo:rail'

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== 'closed'
  } catch {
    return true
  }
}

function smooth(): ScrollBehavior {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Screen-level state: which overlay is open, which row is expanded. */
class UI {
  palette = $state<{ mode: PaletteMode; todoId: string | null } | null>(null)
  dateFor = $state<string | null>(null)
  tagsFor = $state<string | null>(null)
  expanded = $state<string | null>(null)
  /** The list whose heading is an input for its new name. */
  renaming = $state<string | null>(null)
  help = $state(false)
  sheet = $state(false)
  railOpen = $state(readRail())
  /** Phone: the row whose swipe tray (> and <) is open. */
  tray = $state<string | null>(null)
  /** The list picked in the Index, with g + number or from the palette: marked in the Index, and where
      capture files a task that has no `>`. Going to Today clears it, back to the Inbox. */
  activeList = $state<string | null>(null)
  /** Whether the day heading is on screen; the phone bar shows the date only once it has scrolled away. */
  headingVisible = $state(true)
  /** The row checkbox that last held focus, so focus can go back to the log. */
  lastRow: HTMLElement | null = null
  /** Where the last delete happened, so undo puts focus back on that copy of the row. */
  lastDeleteScope: 'today' | 'list' | null = null

  #returnFocus: HTMLElement | null = null

  rememberFocus() {
    const el = document.activeElement
    this.#returnFocus = el instanceof HTMLElement && el !== document.body ? el : null
  }

  forgetFocus() {
    this.#returnFocus = null
  }

  restoreFocus(todoId?: string | null, fallback?: HTMLElement) {
    const el = this.#returnFocus
    this.#returnFocus = null
    requestAnimationFrame(() => {
      if (el && el.isConnected) {
        // Back on a row that may have scrolled away (a list renamed from Today): bring it into view.
        el.focus({ preventScroll: true })
        el.closest('li')?.scrollIntoView({ block: 'nearest' })
        return
      }
      if (todoId) focusRow(todoId)
      else fallback?.focus({ preventScroll: true })
    })
  }

  /** Back to the row last worked on, or the first row of the log. */
  focusLog() {
    const el = this.lastRow?.isConnected ? this.lastRow : document.querySelector<HTMLElement>('main [data-row-focus]')
    el?.focus({ preventScroll: true })
    el?.closest('li')?.scrollIntoView({ block: 'nearest' })
  }

  openPalette(mode: PaletteMode, todoId: string | null = null) {
    this.rememberFocus()
    this.tray = null
    this.palette = { mode, todoId }
  }

  openDate(todoId: string) {
    this.rememberFocus()
    this.tray = null
    this.dateFor = todoId
  }

  openTags(todoId: string) {
    this.rememberFocus()
    this.dateFor = null
    this.tagsFor = todoId
  }

  openHelp() {
    this.rememberFocus()
    this.help = true
  }

  toggleRail() {
    this.railOpen = !this.railOpen
    try {
      localStorage.setItem(RAIL_KEY, this.railOpen ? 'open' : 'closed')
    } catch {
      // Not stored; the toggle still works for this visit.
    }
  }

  toggleExpanded(key: string) {
    this.expanded = this.expanded === key ? null : key
  }

  /** The phone Index is a modal sheet; it must be closed before focus can move behind it. */
  async #closeSheet() {
    if (!this.sheet) return
    this.sheet = false
    await tick()
  }

  async jumpToList(listId: string) {
    await this.#closeSheet()
    const section = document.getElementById(`list-${listId}`)
    if (!section) return
    section.scrollIntoView({ block: 'start', behavior: smooth() })
    const first = section.querySelector<HTMLElement>('[data-row-focus]') ?? section.querySelector<HTMLElement>('h2')
    first?.focus({ preventScroll: true })
    this.activeList = listId
  }

  async jumpToToday() {
    await this.#closeSheet()
    this.activeList = null
    window.scrollTo({ top: 0, behavior: smooth() })
    const target =
      document.querySelector<HTMLElement>('#today [data-row-focus]') ?? document.querySelector<HTMLElement>('#today-h')
    target?.focus({ preventScroll: true })
  }

  /** Focus a to-do's row in its own list, opening that list's Done fold when needed. */
  async jumpToTodo(todoId: string) {
    const t = store.find(todoId)
    if (!t) return
    if (store.tagFilter && !t.tags.includes(store.tagFilter)) store.setTagFilter(null)
    if (t.done) store.openDone[t.listId] = true
    await tick()
    const row = document.querySelector<HTMLElement>(`#list-${CSS.escape(t.listId)} [data-todo-id="${CSS.escape(todoId)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: smooth() })
    row.querySelector<HTMLElement>('[data-row-focus]')?.focus({ preventScroll: true })
  }

  /** Turn a list's heading into the field for its name, closing the phone Index first. */
  async renameList(listId: string) {
    this.rememberFocus()
    this.tray = null
    await this.#closeSheet()
    this.renaming = listId
    this.activeList = listId
    await tick()
    document.getElementById(`list-${listId}`)?.scrollIntoView({ block: 'start', behavior: smooth() })
  }

  jumpToIndex(index: number): boolean {
    const list = store.lists.find((l) => l.index === index)
    if (!list) return false
    void this.jumpToList(list.id)
    return true
  }
}

/** Focus a to-do's row, inside `scope` when the same to-do shows in Today and in its list. */
export function focusRow(todoId: string, scope: ParentNode = document) {
  const el = scope.querySelector<HTMLElement>(`[data-todo-id="${CSS.escape(todoId)}"] [data-row-focus]`)
  if (!el) return
  el.focus({ preventScroll: true })
  el.closest('li')?.scrollIntoView({ block: 'nearest' })
}

/** After an undo: the restored row in Today if that is where work was happening, else in its own list. */
export function focusRestored(todoId: string) {
  const t = store.find(todoId)
  if (!t) return
  const todayCopy = document.querySelector(`#today [data-todo-id="${CSS.escape(todoId)}"]`)
  const scope = (ui.lastDeleteScope === 'today' && todayCopy
    ? document.getElementById('today')
    : document.getElementById(`list-${t.listId}`)) ?? document
  ui.lastDeleteScope = null
  if (scope.querySelector(`[data-todo-id="${CSS.escape(todoId)}"] [data-row-focus]`)) focusRow(todoId, scope)
  else ui.focusLog()
}

/** The to-do whose row holds keyboard focus. */
export function focusedTodoId(): string | null {
  const el = document.activeElement?.closest<HTMLElement>('[data-todo-id]')
  return el?.dataset.todoId ?? null
}

export const ui = new UI()
