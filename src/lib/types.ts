/** An ISO calendar date, `YYYY-MM-DD`, in the device's local time zone. */
export type DayISO = string

export interface TodoList {
  id: string
  /** Folder name in the data repo. */
  slug: string
  /** Two-digit index shown in the list's ink; also its jump key (g + index). */
  index: number
  name: string
  /** Ink slot, 1–12, mapped to `--list-N`. */
  ink: number
}

export interface Todo {
  id: string
  listId: string
  title: string
  /** Free-text Markdown body. */
  note: string
  tags: string[]
  due: DayISO | null
  done: boolean
  doneAt: string | null
  /** Manual position within its list; lower comes first. */
  order: number
  createdAt: string
  updatedAt: string
}

export type ChangeKind = 'added' | 'edited' | 'moved' | 'rescheduled' | 'done' | 'reopened' | 'removed'

/** A change made on this device and not yet committed to the data repo. */
export interface PendingChange {
  kind: ChangeKind
  /** Repo path of the file, e.g. `home/fix-dripping-kitchen-tap.md`. */
  path: string
  title: string
  at: string
}

export type SyncState =
  | { kind: 'saved'; at: string | null }
  | { kind: 'saving' }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string }
  | { kind: 'conflict'; path: string }

/** The momentary rapid-log mark a row shows right after an action. */
export type Flash = '>' | '<'
