// Folding what GitHub holds now into this device's state. Every to-do is
// merged on its own, field by field against the last version both sides
// shared: a field changed on one side only takes that side's value, and a
// field changed on both takes the latest write (`updatedAt`).
//
// A deleted list removes only what the deleting device had seen. A to-do
// another device changed (beyond its order), added or moved into the list
// meanwhile survives, and keeps the list alive with just those to-dos; a
// rename or ink change alone never brings a deleted list back. The outcome
// is the same whichever device commits first.

import type { Todo, TodoList } from './types'

export interface Model {
  lists: TodoList[]
  todos: Todo[]
}

/** What this device changed and hasn't committed yet. */
export interface Dirty {
  /** To-do ids, with the deletion time for a to-do deleted here. */
  todos: Map<string, string | null>
  /** List ids, with the path of the list's `_list.md`. A dirty list missing here was deleted here. */
  lists: Map<string, string>
}

/** A list that a delete on one device and a change on another met over. */
export interface ListNotice {
  list: TodoList
  /**
   * `kept`: deleted here, kept for to-dos changed or added on GitHub. `revived`: deleted on GitHub,
   * kept for to-dos changed here. `changeLost`: deleted on GitHub, so this device's rename or ink gave way.
   */
  kind: 'kept' | 'revived' | 'changeLost'
  /** To-dos the list was kept for. */
  count: number
  /** For `kept`: to-dos deleted with it that stay deleted. */
  left: number
}

export interface Merged extends Model {
  /** To-dos and lists whose local change GitHub now has too, or that no longer needs writing. */
  cleanTodos: Set<string>
  cleanLists: Set<string>
  /** Lists that need writing because of the merge: kept for a local to-do, or renumbered. */
  relist: string[]
  /** To-dos changed on both sides where one side's edit gave way. */
  conflicts: string[]
  notices: ListNotice[]
}

type Group = readonly (keyof Todo)[]
const GROUPS: Group[] = [['title'], ['note'], ['tags'], ['due'], ['done', 'doneAt'], ['order'], ['listId']]

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pick(t: Todo, g: Group): unknown[] {
  return g.map((k) => t[k])
}

/** Same content; the timestamps don't count. */
export function sameTodo(a: Todo | undefined, b: Todo | undefined): boolean {
  if (!a || !b) return a === b
  return GROUPS.every((g) => eq(pick(a, g), pick(b, g)))
}

/** Changed in anything but its place in the list. */
function changedBeyondOrder(a: Todo, b: Todo): boolean {
  return GROUPS.some((g) => g[0] !== 'order' && !eq(pick(a, g), pick(b, g)))
}

export function sameList(a: TodoList | undefined, b: TodoList | undefined): boolean {
  if (!a || !b) return a === b
  return a.index === b.index && a.name === b.name && a.ink === b.ink
}

function copy(t: Todo): Todo {
  return { ...t, tags: [...t.tags] }
}

function threeWay(base: Todo, mine: Todo, theirs: Todo): { todo: Todo; clash: boolean } {
  const latest = mine.updatedAt >= theirs.updatedAt ? mine : theirs
  const out = copy(mine)
  let clash = false
  for (const g of GROUPS) {
    const m = pick(mine, g)
    const t = pick(theirs, g)
    if (eq(m, t)) continue
    const from = eq(m, pick(base, g)) ? theirs : eq(t, pick(base, g)) ? mine : ((clash = true), latest)
    for (const k of g) {
      const v = from[k]
      ;(out as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v
    }
  }
  out.updatedAt = mine.updatedAt >= theirs.updatedAt ? mine.updatedAt : theirs.updatedAt
  return { todo: out, clash }
}

export function merge(local: Model, base: Model, remote: Model, dirty: Dirty): Merged {
  const L = new Map(local.todos.map((t) => [t.id, t]))
  const B = new Map(base.todos.map((t) => [t.id, t]))
  const R = new Map(remote.todos.map((t) => [t.id, t]))
  const Ll = new Map(local.lists.map((x) => [x.id, x]))
  const Bl = new Map(base.lists.map((x) => [x.id, x]))
  const Rl = new Map(remote.lists.map((x) => [x.id, x]))
  /** A list deleted on this device and not yet committed. */
  const deletedHere = (listId: string) => dirty.lists.has(listId) && !Ll.has(listId)
  /** A list GitHub no longer has. */
  const goneThere = (listId: string) => Bl.has(listId) && !Rl.has(listId)
  const todos: Todo[] = []
  const cleanTodos = new Set<string>()
  const conflicts: string[] = []

  // Ids this device changed are visited too, so one deleted here and on GitHub is marked clean.
  for (const id of new Set([...L.keys(), ...R.keys(), ...dirty.todos.keys()])) {
    const l = L.get(id)
    const b = B.get(id)
    const r = R.get(id)
    if (!dirty.todos.has(id)) {
      // Untouched here: GitHub's version stands, including its deletions.
      if (r) todos.push(l && sameTodo(l, r) && l.updatedAt === r.updatedAt ? l : copy(r))
      continue
    }
    if (sameTodo(b, r)) {
      // Changed only on this device.
      if (l) todos.push(l)
      continue
    }
    if (!l && b && deletedHere(b.listId)) {
      // Deleted here with its list: a change made elsewhere that this device hadn't seen keeps it,
      // without a conflict of its own (the list's notice tells). A reorder alone doesn't count.
      if (!r) cleanTodos.add(id)
      else if (changedBeyondOrder(b, r)) {
        todos.push(copy(r))
        cleanTodos.add(id)
      }
      continue
    }
    if (!l) {
      // Deleted here, changed on GitHub: the later of the two stands.
      const deletedAt = dirty.todos.get(id) ?? ''
      if (r && r.updatedAt > deletedAt) {
        todos.push(copy(r))
        conflicts.push(id)
      }
      if (!r || r.updatedAt > deletedAt) cleanTodos.add(id)
      continue
    }
    if (!r && b && goneThere(b.listId)) {
      // Deleted on GitHub with its list, changed here: the change keeps it, unless it was only a reorder.
      // The list's notice tells, so there is no conflict of its own.
      if (changedBeyondOrder(b, l)) todos.push(l)
      else cleanTodos.add(id)
      continue
    }
    if (!r) {
      // Deleted on GitHub, changed here: the edit brings it back.
      todos.push(l)
      conflicts.push(id)
      continue
    }
    const merged = b ? threeWay(b, l, r) : { todo: l.updatedAt >= r.updatedAt ? l : copy(r), clash: !sameTodo(l, r) }
    todos.push(merged.todo)
    if (merged.clash) conflicts.push(id)
    if (sameTodo(merged.todo, r)) cleanTodos.add(id)
  }

  const used = new Set(todos.map((t) => t.listId))
  const countIn = (listId: string) => todos.filter((t) => t.listId === listId).length
  const lists: TodoList[] = []
  const cleanLists = new Set<string>()
  const relist: string[] = []
  const notices: ListNotice[] = []

  for (const id of new Set([...Ll.keys(), ...Rl.keys(), ...dirty.lists.keys()])) {
    const l = Ll.get(id)
    const b = Bl.get(id)
    const r = Rl.get(id)
    if (!dirty.lists.has(id)) {
      if (r) lists.push(l && sameList(l, r) ? l : { ...r })
      else if (l && used.has(id)) {
        // Gone from GitHub while a to-do here still files into it: write it back.
        lists.push(l)
        relist.push(id)
        if (b) notices.push({ list: l, kind: 'revived', count: countIn(id), left: 0 })
      }
      continue
    }
    if (!l) {
      // Deleted here. A to-do GitHub changed or added since keeps GitHub's list; otherwise the delete
      // stands, even over a rename made elsewhere.
      if (r && used.has(id)) {
        lists.push({ ...r })
        cleanLists.add(id)
        const kept = new Set(todos.map((t) => t.id))
        let left = 0
        for (const [tid, at] of dirty.todos) if (at !== null && B.get(tid)?.listId === id && !kept.has(tid)) left++
        notices.push({ list: r, kind: 'kept', count: countIn(id), left })
      } else if (!r) cleanLists.add(id)
      continue
    }
    if (!r) {
      // Gone from GitHub: only a to-do changed here keeps it, never a rename or ink change alone.
      if (b && !used.has(id)) {
        cleanLists.add(id)
        notices.push({ list: l, kind: 'changeLost', count: 0, left: 0 })
        continue
      }
      lists.push(l)
      if (b) notices.push({ list: l, kind: 'revived', count: countIn(id), left: 0 })
      continue
    }
    const out = { ...l }
    for (const k of ['index', 'name', 'ink'] as const) {
      if (b && l[k] === b[k] && r[k] !== b[k]) (out as Record<string, unknown>)[k] = r[k]
    }
    lists.push(sameList(out, l) ? l : out)
    if (sameList(out, r)) cleanLists.add(id)
  }

  // Two lists created at once on two devices can share an index; the later one by name moves to the end.
  const seen = new Set<number>()
  let top = Math.max(0, ...lists.map((x) => x.index))
  for (const x of [...lists].sort((a, b) => a.index - b.index || a.slug.localeCompare(b.slug))) {
    if (!seen.has(x.index)) {
      seen.add(x.index)
      continue
    }
    const at = lists.indexOf(x)
    lists[at] = { ...x, index: ++top }
    relist.push(x.id)
    cleanLists.delete(x.id)
  }

  return { lists, todos, cleanTodos, cleanLists, relist, conflicts, notices }
}
