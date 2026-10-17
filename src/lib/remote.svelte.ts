// Sync with the data repo. The store stays the source of truth for the screen;
// this sends its pending changes to GitHub in batched commits and folds other
// devices' commits back in.
//
// Budget (see PRODUCT.md): at most one commit every 10 s (GitHub allows about
// 6 pushes a minute per repo), a second between write requests (enforced in
// github.ts), and polling by ETag, whose 304 replies cost no rate limit.

import { formatTime } from './dates'
import { GitHub, GitHubError, type Connection, type FileChange } from './github'
import { merge, type Dirty, type ListNotice, type Merged, type Model } from './merge'
import {
  blobSha,
  fileOf,
  folderOf,
  isDataPath,
  LIST_FILE,
  listFolderDrops,
  readList,
  readTodo,
  README,
  settleLists,
  settleOrders,
  slugify,
  todoNames,
  writeList,
  writeTodo,
} from './repo'
import type { ChangeKind, Conflict, PendingChange, SyncState, Todo, TodoList } from './types'

const POLL_MS = 60_000
/** Wait for a burst of edits to end before committing… */
const SETTLE_MS = 1500
/** …but not longer than this after the first of them. */
const MAX_WAIT_MS = 8000
/** At most 6 commits a minute. */
const COMMIT_GAP_MS = 10_000
/** Focus and visibility checks are skipped if the last check is this recent. */
const RECHECK_MS = 10_000
/** Tries for one batch when the branch keeps moving under it. */
const TRIES = 3

/** What the repo held at the last commit this device read or wrote. */
export interface Base {
  head: string | null
  /** Root tree of `head`. */
  tree: string | null
  /** ETag of the last branch read. */
  etag: string | null
  /** Every list and to-do file at `head`, parsed, with its blob id when known. */
  files: Record<string, BaseFile>
}

export type BaseFile = { sha: string | null; todo: Todo } | { sha: string | null; list: TodoList }

/** The store, as sync sees it. */
export interface Host {
  readonly lists: TodoList[]
  readonly todos: Todo[]
  readonly pending: PendingChange[]
  sync: SyncState
  /** A merge's notice; only the user clears it. */
  conflict: Conflict | null
  lastSavedAt: string | null
  /** Pending changes up to this `seq` are in a commit on its way; later edits must not fold into them. */
  sealed: number
  /** No commit before this time (ms): a list delete waits while its undo is offered. */
  readonly commitHold: number
  adopt(merged: Merged): void
  /** Drop pending changes up to `seq`: they are on GitHub. */
  settle(seq: number): void
  persist(): void
  pathOf(t: Todo): string
}

export function emptyBase(): Base {
  return { head: null, tree: null, etag: null, files: {} }
}

/** The lists and to-dos a base describes. */
export function modelOf(base: Base): Model {
  const lists = new Map<string, TodoList>()
  const todos = new Map<string, { path: string; todo: Todo }>()
  const folders = new Set<string>()
  for (const [path, f] of Object.entries(base.files)) {
    const folder = folderOf(path)
    folders.add(folder)
    if ('list' in f) {
      lists.set(folder, { ...f.list })
    } else {
      // A to-do in two files (a hand copy, or a rename half-seen) counts once: its latest version.
      const prev = todos.get(f.todo.id)
      if (!prev || f.todo.updatedAt > prev.todo.updatedAt) todos.set(f.todo.id, { path, todo: { ...f.todo, tags: [...f.todo.tags] } })
    }
  }
  for (const folder of folders) if (!lists.has(folder)) lists.set(folder, readList(folder, null))
  const inPathOrder = [...todos.values()].sort((a, b) => a.path.localeCompare(b.path)).map((x) => x.todo)
  return { lists: settleLists([...lists.values()]), todos: settleOrders(inPathOrder) }
}

export function dirtyOf(pending: PendingChange[]): Dirty {
  const dirty: Dirty = { todos: new Map(), lists: new Map() }
  for (const c of pending) {
    if (c.kind === 'list') dirty.lists.set(c.id, c.path)
    else dirty.todos.set(c.id, c.kind === 'removed' ? c.at : null)
  }
  return dirty
}

/** Read every list and to-do at a commit, fetching only the files that changed since `prev`. */
export async function readRepo(gh: GitHub, commit: string, prev: Base, etag: string | null): Promise<Base> {
  const tree = await gh.tree(commit)
  const files: Record<string, BaseFile> = {}
  const need: { path: string; sha: string }[] = []
  for (const e of tree.entries) {
    if (e.type !== 'blob' || !isDataPath(e.path)) continue
    const known = prev.files[e.path]
    if (known && known.sha === e.sha) files[e.path] = known
    else need.push(e)
  }
  const texts = need.length ? await gh.blobs(need.map((e) => e.sha)) : new Map<string, string>()
  for (const e of need) {
    const text = texts.get(e.sha)
    if (text === undefined) continue
    const folder = folderOf(e.path)
    files[e.path] =
      fileOf(e.path) === LIST_FILE
        ? { sha: e.sha, list: readList(folder, text) }
        : { sha: e.sha, todo: readTodo(e.path, text, folder) }
  }
  return { head: commit, tree: tree.sha, etag, files }
}

const COMMIT_VERBS: Record<ChangeKind, string> = {
  added: 'Add',
  edited: 'Edit',
  moved: 'Move',
  rescheduled: 'Reschedule',
  done: 'Check off',
  reopened: 'Reopen',
  removed: 'Delete',
  list: 'Save list',
}

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`
}

/**
 * One line per file a change wrote, or per deleted list: "Delete list “Home” and its 24 to-dos", with
 * that folder's deletions folded in. Changes the commit writes nothing for (an undo's identical
 * re-adds, a list that never reached GitHub) are left out.
 */
function commitMessage(
  batch: PendingChange[],
  files: Record<string, BaseFile | null>,
  listExists: (id: string) => boolean,
  pathsOf: (id: string) => string[],
): string {
  const last = new Map<string, PendingChange>()
  for (const c of batch) last.set(`${c.kind === 'list' ? 'list' : 'todo'}:${c.id}`, c)
  const planned = Object.keys(files)
  // Match folders with their slash, so `home/` doesn't take in `home-2/`.
  const inFolder = (folder: string) => planned.filter((p) => p.startsWith(`${folder}/`))
  const deleted = new Map<string, number>()
  for (const c of last.values()) {
    if (c.kind !== 'list' || listExists(c.id)) continue
    const folder = folderOf(c.path)
    deleted.set(folder, inFolder(folder).filter((p) => files[p] === null && fileOf(p) !== LIST_FILE).length)
  }
  const writes = (c: PendingChange) => {
    if (c.kind === 'list') return listExists(c.id) ? c.path in files : inFolder(folderOf(c.path)).length > 0
    // A deleted list's to-dos fold into its line, unless the file goes from another folder (moved in, uncommitted).
    if (c.kind === 'removed' && deleted.has(folderOf(c.path)) && pathsOf(c.id).every((p) => folderOf(p) === folderOf(c.path))) return false
    return (
      c.path in files ||
      pathsOf(c.id).some((p) => p in files) ||
      planned.some((p) => {
        const f = files[p]
        return !!f && 'todo' in f && f.todo.id === c.id
      })
    )
  }
  let items = [...last.values()].filter(writes)
  if (!items.length) items = [...last.values()]
  const line = (c: PendingChange) => {
    if (c.kind === 'list' && !listExists(c.id)) {
      const n = deleted.get(folderOf(c.path)) ?? 0
      return `Delete list “${c.title}”${n ? ` and its ${plural(n, 'to-do')}` : ''}`
    }
    return `${COMMIT_VERBS[c.kind]} “${c.title}”`
  }
  if (items.length === 1) return line(items[0])
  return `${items.length} changes\n\n${items.map((c) => `- ${line(c)}`).join('\n')}`
}

/** The banner after a merge where a list delete met a change made elsewhere. */
function noticeText(notices: ListNotice[]): string {
  const [n] = notices
  const name = `${String(n.list.index).padStart(2, '0')} ${n.list.name}`
  let text: string
  if (n.kind === 'kept') {
    text = `${name} was kept for ${plural(n.count, 'to-do')} changed or added on another device.`
    if (n.left) text += n.left === 1 ? ' The other one stays deleted.' : ` The other ${n.left} stay deleted.`
  } else if (n.kind === 'revived') {
    text = `${name} was deleted on another device. It was kept for ${n.count === 1 ? 'the to-do' : `the ${n.count} to-dos`} changed here.`
  } else {
    text = `${name} was deleted on another device, so the change made to it here wasn't kept.`
  }
  const more = notices.length - 1
  return more ? `${text} ${plural(more, 'other list')} met a delete the same way.` : text
}

// ---- first run -----------------------------------------------------------------

/** Where To Do is served. */
export const HOME = 'https://do.sebastienguillon.com'

/**
 * A github.io host is shared by every Pages site on the account, and so is its
 * browser storage: any of them could read a token stored there.
 */
export function sharedOrigin(hostname = location.hostname): boolean {
  return hostname === 'github.io' || hostname.endsWith('.github.io')
}

export class SetupError extends Error {
  constructor(
    message: string,
    readonly field: 'repo' | 'token' | null = null,
  ) {
    super(message)
  }
}

/** `owner/name`, or a github.com URL to it. */
export function parseRepo(text: string): { owner: string; name: string } | null {
  const s = text
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/)
  return m ? { owner: m[1], name: m[2] } : null
}

function setupError(e: unknown, repo: string, stage: 'repo' | 'read' | 'write'): SetupError {
  if (!(e instanceof GitHubError)) return new SetupError(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`)
  switch (e.kind) {
    case 'network':
      return new SetupError("Couldn't reach GitHub. Check this device's connection, then try again.")
    case 'auth':
      return new SetupError("GitHub didn't accept this token. Check that it was copied whole, and that it hasn't expired or been revoked.", 'token')
    case 'rate':
      return new SetupError(`GitHub is limiting requests from this account. Try again after ${formatTime(new Date(e.retryAt ?? Date.now() + 60_000).toISOString())}.`)
    case 'missing':
    case 'forbidden':
      if (stage === 'repo' && e.kind === 'missing')
        return new SetupError(`This token can't see ${repo}. Check the name, and that the token's Repository access includes this repo.`, 'repo')
      if (stage === 'read') return new SetupError(`This token can see ${repo} but can't read its files. Give it the Contents permission, set to Read and write.`, 'token')
      if (stage === 'write') return new SetupError(`This token can read ${repo} but can't write to it. Set its Contents permission to Read and write.`, 'token')
      return new SetupError(`GitHub refused this token for ${repo}: ${e.message}`, 'token')
    default:
      return new SetupError(`GitHub answered: ${e.message}`)
  }
}

/**
 * Check a token against a repo with one call, then read the repo (or start it,
 * if it has no commits yet). Throws a `SetupError` worded for the setup screen.
 */
export async function openRepo(token: string, repoText: string, step: (text: string) => void): Promise<{ connection: Connection; base: Base }> {
  if (sharedOrigin()) throw new SetupError(`To Do doesn't store a token on ${location.hostname}. Open it at ${HOME.replace('https://', '')} instead.`)
  const t = token.trim()
  const ref = parseRepo(repoText)
  if (!ref) throw new SetupError('Write the repo as owner/name, for example you/todo-data.', 'repo')
  if (!t) throw new SetupError('Paste the token for this device.', 'token')
  if (/^gh[po]_/.test(t))
    throw new SetupError('This is a classic token, which reaches every repo on the account. Make a fine-grained token limited to the data repo instead.', 'token')
  if (/\s/.test(t)) throw new SetupError("That doesn't look like a whole token. Copy it again from GitHub.", 'token')

  const gh = new GitHub(t, ref.owner, ref.name)
  step('Checking the token…')
  let info
  try {
    info = await gh.repo()
  } catch (e) {
    throw setupError(e, `${ref.owner}/${ref.name}`, 'repo')
  }
  const repo = `${info.owner}/${info.name}`
  if (!info.private) throw new SetupError(`${repo} is public, so anyone could read your to-dos. Make it private on GitHub, or use another repo.`, 'repo')
  if (info.archived) throw new SetupError(`${repo} is archived, so nothing can be saved to it. Unarchive it on GitHub, or use another repo.`, 'repo')
  const connection: Connection = { token: t, owner: info.owner, repo: info.name, branch: info.defaultBranch }
  const reader = new GitHub(t, info.owner, info.name)

  step(`Reading ${repo}…`)
  try {
    const head = await reader.head(info.defaultBranch, null)
    if (head.changed) return { connection, base: await readRepo(reader, head.sha, emptyBase(), head.etag) }
  } catch (e) {
    if (!(e instanceof GitHubError && e.kind === 'empty')) throw setupError(e, repo, 'read')
  }

  step(`Starting ${repo}…`)
  try {
    const first = await reader.init('README.md', README, 'Start the To Do data repo')
    return { connection, base: { head: first.commit, tree: first.tree, etag: null, files: {} } }
  } catch (e) {
    throw setupError(e, repo, 'write')
  }
}

// ---- the engine ----------------------------------------------------------------

export class Remote {
  connection = $state<Connection | null>(null)
  /** When GitHub was last asked for changes, successfully. */
  lastCheckedAt = $state<string | null>(null)

  #base: Base
  #host: Host
  #gh: GitHub | null = null
  #paths = new Map<string, string[]>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #pollTimer: ReturnType<typeof setInterval> | undefined
  #busy = false
  #again = false
  #firstPendingAt = 0
  #lastCommitAt = 0
  #lastCheck = 0
  #failures = 0
  #retryAt = 0
  /** A failure only a new token can fix: it shows again each time the device is back online. */
  #blocked: SyncState | null = null

  constructor(host: Host, base: Base | null) {
    this.#host = host
    this.#base = base ?? emptyBase()
    this.#index()
  }

  /** The last commit read or written, and its files. */
  get base(): Base {
    return this.#base
  }

  set base(base: Base) {
    this.#base = base
    this.#index()
  }

  get repoName(): string {
    return this.connection ? `${this.connection.owner}/${this.connection.repo}` : ''
  }

  start(connection: Connection) {
    const first = !this.#gh
    this.connection = connection
    this.#gh = new GitHub(connection.token, connection.owner, connection.repo)
    this.#retryAt = 0
    this.#failures = 0
    this.#blocked = null
    if (first) {
      addEventListener('online', this.#onOnline)
      addEventListener('focus', this.#onFocus)
      document.addEventListener('visibilitychange', this.#onFocus)
      this.#pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') void this.#run(false)
      }, POLL_MS)
    }
    void this.#run(this.#host.pending.length > 0)
  }

  stop() {
    removeEventListener('online', this.#onOnline)
    removeEventListener('focus', this.#onFocus)
    document.removeEventListener('visibilitychange', this.#onFocus)
    clearInterval(this.#pollTimer)
    clearTimeout(this.#timer)
    clearTimeout(this.#retryTimer)
    this.#gh = null
    this.connection = null
    this.lastCheckedAt = null
    this.base = emptyBase()
  }

  /** Repo paths holding a to-do, as of the last commit read or written. */
  pathsOf(id: string): string[] {
    return this.#paths.get(id) ?? []
  }

  /** A change was recorded: commit once edits settle, and at most once every 10 s. */
  schedule() {
    if (!this.#gh) return
    const now = Date.now()
    if (!this.#firstPendingAt) this.#firstPendingAt = now
    const at = Math.max(
      Math.min(now + SETTLE_MS, this.#firstPendingAt + MAX_WAIT_MS),
      this.#lastCommitAt + COMMIT_GAP_MS,
      this.#retryAt,
      this.#host.commitHold,
    )
    clearTimeout(this.#timer)
    if (Number.isFinite(at)) this.#timer = setTimeout(() => void this.#run(true), at - now)
    if (!navigator.onLine) this.#host.sync = { kind: 'offline' }
    else if (this.#blocked) this.#host.sync = this.#blocked
    else if (this.#host.sync.kind !== 'failed') this.#host.sync = { kind: 'saving' }
  }

  /** Ask GitHub for changes now. */
  check() {
    void this.#run(this.#host.pending.length > 0)
  }

  retry() {
    this.#retryAt = 0
    this.#failures = 0
    this.#blocked = null
    clearTimeout(this.#retryTimer)
    if (this.#host.sync.kind === 'failed') this.#host.sync = { kind: 'saving' }
    void this.#run(true)
  }

  #onOnline = () => {
    this.#retryAt = Number.isFinite(this.#retryAt) ? 0 : this.#retryAt
    void this.#run(this.#host.pending.length > 0)
  }

  #onFocus = () => {
    if (document.visibilityState === 'visible' && Date.now() - this.#lastCheck > RECHECK_MS) void this.#run(false)
  }

  #index() {
    this.#paths.clear()
    for (const [path, f] of Object.entries(this.base.files)) {
      if (!('todo' in f)) continue
      const list = this.#paths.get(f.todo.id)
      if (list) list.push(path)
      else this.#paths.set(f.todo.id, [path])
    }
  }

  async #run(commit: boolean) {
    const gh = this.#gh
    if (!gh) return
    if (this.#busy) {
      if (commit) this.#again = true
      return
    }
    if (!navigator.onLine) {
      this.#host.sync = { kind: 'offline' }
      return
    }
    if (Date.now() < this.#retryAt) {
      // Waiting out a failure: one that needs a new token says so again, not offline or saving.
      if (this.#blocked) this.#host.sync = this.#blocked
      return
    }
    if (commit && Date.now() < this.#lastCommitAt + COMMIT_GAP_MS) {
      // Too soon after the last commit: check now, commit when the gap is over.
      commit = false
      this.#again = true
    }
    if (commit && Date.now() < this.#host.commitHold) {
      // A list delete's undo is on offer: keep reading, commit once it's gone.
      commit = false
      this.#again = true
    }
    this.#busy = true
    try {
      await this.#cycle(gh, commit)
      if (gh !== this.#gh) return
      this.#failures = 0
      this.#lastCheck = Date.now()
      this.lastCheckedAt = new Date().toISOString()
      if (this.#host.pending.length) {
        this.#again = true
      } else {
        this.#firstPendingAt = 0
        this.#host.sync = { kind: 'saved', at: this.#host.lastSavedAt }
      }
    } catch (e) {
      if (gh === this.#gh) this.#fail(e)
    } finally {
      this.#busy = false
      if (this.#again && this.#gh) {
        this.#again = false
        if (this.#host.pending.length) this.schedule()
      }
    }
  }

  /** Read the branch; take in what moved; then commit, re-reading and retrying if the branch moves meanwhile. */
  async #cycle(gh: GitHub, commit: boolean) {
    const branch = this.connection!.branch
    for (let attempt = 1; ; attempt++) {
      const head = await gh.head(branch, this.base.etag)
      if (head.changed) {
        if (head.sha !== this.base.head) await this.#pull(gh, head.sha)
        if (gh !== this.#gh) return
        this.base.etag = head.etag
      }
      if (!commit || !this.#host.pending.length) return
      if (Date.now() < this.#host.commitHold) {
        // A list was deleted while this cycle was reading: its undo is on offer, so commit later.
        this.#again = true
        return
      }
      if (await this.#commit(gh, branch)) return
      if (attempt >= TRIES) throw new GitHubError('stale', 'The branch kept moving.')
      this.base.etag = null
    }
  }

  async #pull(gh: GitHub, sha: string) {
    const next = await readRepo(gh, sha, this.base, this.base.etag)
    if (gh !== this.#gh) return
    const host = this.#host
    const result = merge({ lists: host.lists, todos: host.todos }, modelOf(this.base), modelOf(next), dirtyOf(host.pending))
    this.base = next
    host.adopt(result)
    const clash = result.conflicts[0]
    if (result.notices.length) {
      // A list kept or dropped over a delete says more than a to-do's conflict, so it takes the banner.
      host.conflict = { path: `${result.notices[0].list.slug}/`, message: noticeText(result.notices) }
    } else if (clash) {
      const t = host.todos.find((x) => x.id === clash)
      host.conflict = { id: clash, path: this.pathsOf(clash)[0] ?? (t ? host.pathOf(t) : clash) }
    }
    host.persist()
  }

  /** One commit for every pending change. False if the branch moved first. */
  async #commit(gh: GitHub, branch: string): Promise<boolean> {
    const host = this.#host
    const base = this.base
    if (!base.head || !base.tree) throw new GitHubError('invalid', 'There is no commit to build on.')
    const seq = Math.max(...host.pending.map((c) => c.seq))
    const batch = host.pending.filter((c) => c.seq <= seq)
    host.sealed = seq
    this.#firstPendingAt = 0
    const plan = this.#plan(dirtyOf(batch))
    const present = new Set(host.lists.map((l) => l.id))
    const message = commitMessage(batch, plan.files, (id) => present.has(id), (id) => this.pathsOf(id))
    const paths = Object.keys(plan.files)
    if (!paths.length) {
      host.sealed = 0
      host.settle(seq)
      return true
    }

    let done: { commit: string; tree: string }
    try {
      await Promise.all(
        paths.map(async (p) => {
          const f = plan.files[p]
          if (f) f.sha = await blobSha(plan.contents[p])
        }),
      )
      const changes: FileChange[] = paths.map((p) => ({ path: p, content: plan.files[p] ? plan.contents[p] : null }))
      done = await gh.commit(branch, base.head, base.tree, changes, message)
    } catch (e) {
      host.sealed = 0
      if (e instanceof GitHubError && e.kind === 'stale') return false
      throw e
    }
    host.sealed = 0
    if (gh !== this.#gh) return true
    for (const p of paths) {
      const f = plan.files[p]
      if (f) base.files[p] = f
      else delete base.files[p]
    }
    base.head = done.commit
    base.tree = done.tree
    this.#index()
    this.#lastCommitAt = Date.now()
    host.settle(seq)
    return true
  }

  /** The files a set of changes rewrites (a parsed copy) or deletes (null), against the base. */
  #plan(dirty: Dirty): { files: Record<string, BaseFile | null>; contents: Record<string, string> } {
    const host = this.#host
    const base = this.base
    const files: Record<string, BaseFile | null> = {}
    const contents: Record<string, string> = {}
    const owner = new Map<string, string>()
    for (const [path, f] of Object.entries(base.files)) owner.set(path, 'todo' in f ? f.todo.id : '')
    const lists = new Map(host.lists.map((l) => [l.id, l]))
    const todos = new Map(host.todos.map((t) => [t.id, t]))
    const listsDone = new Set<string>()

    const put = (path: string, content: string, file: BaseFile) => {
      const prev = base.files[path]
      const same =
        prev && ('todo' in prev ? 'todo' in file && writeTodo(prev.todo) === content : 'list' in file && writeList(prev.list) === content)
      if (same) {
        if (files[path] === null) delete files[path]
        return
      }
      files[path] = file
      contents[path] = content
    }
    const drop = (path: string) => {
      if (!(path in base.files) || path in files) return
      files[path] = null
      owner.delete(path)
    }
    const putList = (l: TodoList) => {
      if (listsDone.has(l.id)) return
      listsDone.add(l.id)
      const snap = { ...l }
      put(`${l.slug}/${LIST_FILE}`, writeList(snap), { sha: null, list: snap })
    }

    const deleted: string[] = []
    for (const [id, path] of dirty.lists) {
      const l = lists.get(id)
      if (l) putList(l)
      else deleted.push(folderOf(path))
    }
    for (const id of dirty.todos.keys()) {
      const t = todos.get(id)
      const paths = this.pathsOf(id)
      if (!t) {
        paths.forEach(drop)
        continue
      }
      const list = lists.get(t.listId)
      const folder = list?.slug ?? t.listId
      // A folder is a list only with its `_list.md`; write it with the folder's first to-do.
      if (list && !(`${folder}/${LIST_FILE}` in base.files)) putList(list)
      const snap: Todo = { ...t, tags: [...t.tags] }
      const [plain, unique] = todoNames(snap, folder)
      const free = (p: string) => !owner.has(p) || owner.get(p) === id
      const path =
        paths.find((p) => p === plain || p === unique) ??
        (free(plain) ? plain : free(unique) ? unique : `${folder}/${slugify(snap.title)}-${Date.now().toString(36)}.md`)
      owner.set(path, id)
      put(path, writeTodo(snap), { sha: null, todo: snap })
      for (const p of paths) if (p !== path) drop(p)
    }
    for (const folder of deleted) {
      const { drops, keepListFile } = listFolderDrops(base.files, files, folder)
      drops.forEach(drop)
      if (keepListFile) console.warn(`To Do: a to-do is still filed in the deleted list ${folder}/; its _list.md stays.`)
      else drop(`${folder}/${LIST_FILE}`)
    }
    return { files, contents }
  }

  #fail(e: unknown) {
    const err = e instanceof GitHubError ? e : new GitHubError('invalid', e instanceof Error ? e.message : String(e))
    if (err.kind === 'network' && !navigator.onLine) {
      this.#host.sync = { kind: 'offline' }
      return
    }
    // A missed check with nothing waiting to be saved stays quiet; the next check tries again.
    if (!this.#host.pending.length && ['network', 'server', 'stale'].includes(err.kind)) return
    this.#failures++
    const repo = this.repoName
    const kept = 'Your changes are kept on this device.'
    let delay = Math.min(30_000 * 2 ** (this.#failures - 1), 600_000)
    let message = `GitHub did not answer. ${kept}`
    let fix: 'retry' | 'reconnect' = 'retry'
    switch (err.kind) {
      case 'auth':
        message = `GitHub no longer accepts this device's token. It may have expired or been revoked. ${kept}`
        fix = 'reconnect'
        break
      case 'forbidden':
        message = `This device's token isn't allowed to save to ${repo}. Give it the Contents permission, set to Read and write. ${kept}`
        fix = 'reconnect'
        break
      case 'missing':
        message = `This device's token can't find ${repo} or its ${this.connection?.branch} branch. ${kept}`
        fix = 'reconnect'
        break
      case 'rate':
        delay = Math.max((err.retryAt ?? 0) - Date.now(), 60_000)
        message = `GitHub asked To Do to slow down. It tries again at ${formatTime(new Date(Date.now() + delay).toISOString())}. ${kept}`
        break
      case 'stale':
        message = `${repo} kept changing while this device saved. To Do tries again shortly. ${kept}`
        break
      case 'invalid':
        message = `GitHub refused the change: ${err.message} ${kept}`
        break
    }
    clearTimeout(this.#retryTimer)
    if (fix === 'reconnect') {
      // Retrying can't help until the token is fixed.
      this.#retryAt = Infinity
    } else {
      this.#retryAt = Date.now() + delay
      this.#retryTimer = setTimeout(() => {
        this.#retryAt = 0
        void this.#run(true)
      }, delay)
    }
    const failed: SyncState = { kind: 'failed', message, fix }
    this.#blocked = fix === 'reconnect' ? failed : null
    this.#host.sync = failed
  }
}
