// Folding what GitHub holds now into this device's state. Every to-do is
// merged on its own, field by field against the last version both sides
// shared: a field changed on one side only takes that side's value, and a
// field changed on both takes the latest write (`updatedAt`).

import type { Todo, TodoList } from './types'

export interface Model {
  lists: TodoList[]
  todos: Todo[]
}

/** What this device changed and hasn't committed yet. */
export interface Dirty {
  /** To-do ids, with the deletion time for a to-do deleted here. */
  todos: Map<string, string | null>
  lists: Set<string>
}

export interface Merged extends Model {
  /** To-dos and lists whose local change GitHub now has too, or that no longer needs writing. */
  cleanTodos: Set<string>
  cleanLists: Set<string>
  /** Lists that need writing because of the merge: kept for a local to-do, or renumbered. */
  relist: string[]
  /** To-dos changed on both sides where one side's edit gave way. */
  conflicts: string[]
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
  const todos: Todo[] = []
  const cleanTodos = new Set<string>()
  const conflicts: string[] = []

  for (const id of new Set([...L.keys(), ...R.keys()])) {
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

  const Ll = new Map(local.lists.map((x) => [x.id, x]))
  const Bl = new Map(base.lists.map((x) => [x.id, x]))
  const Rl = new Map(remote.lists.map((x) => [x.id, x]))
  const used = new Set(todos.map((t) => t.listId))
  const lists: TodoList[] = []
  const cleanLists = new Set<string>()
  const relist: string[] = []

  for (const id of new Set([...Ll.keys(), ...Rl.keys()])) {
    const l = Ll.get(id)
    const b = Bl.get(id)
    const r = Rl.get(id)
    if (!dirty.lists.has(id)) {
      if (r) lists.push(l && sameList(l, r) ? l : { ...r })
      else if (l && used.has(id)) {
        // Gone from GitHub while a to-do here still files into it: write it back.
        lists.push(l)
        relist.push(id)
      }
      continue
    }
    if (!l) continue
    if (!r) {
      lists.push(l)
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

  return { lists, todos, cleanTodos, cleanLists, relist, conflicts }
}
