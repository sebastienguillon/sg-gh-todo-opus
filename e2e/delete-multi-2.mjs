#!/usr/bin/env node
// List delete, two devices (scenarios 6-12): a delete on A meets B's unseen changes, in both orders.
//   MOCK_PORT=5321 APP_PORT=5320 node delete-multi-2.mjs        (ONLY=6X,7Y to run some)
// Prints PASS/FAIL per check and exits non-zero on any failure.

import { deepStrictEqual } from 'node:assert'
import { listFile, slugify, startHarness, todoFile } from './harness.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null

function same(a, b) {
  try {
    deepStrictEqual(a, b)
    return true
  } catch {
    return false
  }
}

let current = ''
function check(name, ok, detail) {
  results.push({ scenario: current, name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}
const info = (text) => console.log(`      info: ${text}`)
function section(title) {
  console.log(`\n== ${title}  [${since()}]`)
}

const model = (snap) => ({ lists: snap.lists, todos: snap.todos })

/** A copy of unslug in src/lib/repo.ts: the name a folder without a `_list.md` reads back as. */
function unslug(file) {
  const words = file.replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled'
}
const isData = (p) => /^[^/._][^/]*\/[^/]+\.md$/.test(p) && !/\/readme\.md$/i.test(p)

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text ?? '')
  const out = {}
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ')
    if (i < 0) continue
    let v = line.slice(i + 2)
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v)
      } catch {}
    }
    out[line.slice(0, i)] = v
  }
  return out
}

/** Lists ({folder: {index, name, ink}}) and to-dos in the repo, read from its files. */
function repoModel(files) {
  const lists = {}
  const todos = []
  const todoFolders = new Set()
  for (const [p, text] of Object.entries(files)) {
    if (!isData(p)) continue
    const folder = p.slice(0, p.indexOf('/'))
    const f = frontMatter(text)
    if (p.endsWith('/_list.md')) lists[folder] = { index: Number(f.index), name: f.name, ink: Number(f.ink) }
    else {
      todos.push({ path: p, folder, id: f.id, title: f.title, done: f.done === 'true' })
      todoFolders.add(folder)
    }
  }
  return { lists, todos, todoFolders }
}

function diffFiles(got, want) {
  const out = []
  for (const p of new Set([...Object.keys(got), ...Object.keys(want)])) {
    if (!(p in got)) out.push(`missing ${p}`)
    else if (!(p in want)) out.push(`unexpected ${p}`)
    else if (got[p] !== want[p]) out.push(`differs ${p}: got ${JSON.stringify(got[p])} want ${JSON.stringify(want[p])}`)
  }
  return out
}

// ---- seeds -------------------------------------------------------------------------------------

const LIST = {
  inbox: { index: 1, name: 'Capture', ink: 3 },
  home: { index: 2, name: 'Home stuff', ink: 5 },
  work: { index: 3, name: 'Work things', ink: 8 },
}
const T = {
  x: { id: 't-inbox001', listId: 'inbox', title: 'Call the bank', order: 1 },
  a: { id: 't-homea001', listId: 'home', title: 'Fix the tap', order: 1 },
  b: { id: 't-homeb001', listId: 'home', title: 'Paint the fence', order: 2 },
  c: { id: 't-homec001', listId: 'home', title: 'Water the plants', order: 3 },
  d: { id: 't-homed001', listId: 'home', title: 'Clean the gutters', order: 4, done: true, doneAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z' },
  w: { id: 't-work0001', listId: 'work', title: 'Send the report', order: 1 },
}
const pathOf = (t) => `${t.listId}/${slugify(t.title)}.md`
const NON_DATA = { 'README.md': '# To Do data\n\nTest repo.\n', 'home/README.md': '# Home\n\nNotes about the house, not a to-do.\n' }
const HOME_DATA = ['home/_list.md', ...['a', 'b', 'c', 'd'].map((k) => pathOf(T[k]))].sort()
const HOME_IDS = ['a', 'b', 'c', 'd'].map((k) => T[k].id)

function seedMain() {
  const files = { ...NON_DATA }
  for (const [id, l] of Object.entries(LIST)) files[`${id}/_list.md`] = listFile(l)
  for (const t of Object.values(T)) files[pathOf(t)] = todoFile(t)
  return files
}

const LIST12 = {
  errands: { index: 1, name: 'Errands list', ink: 4 },
  home: { index: 2, name: 'Home stuff', ink: 6 },
}
const T12 = [
  { id: 't-errand01', listId: 'errands', title: 'Buy stamps', order: 1 },
  { id: 't-errand02', listId: 'errands', title: 'Post the parcel', order: 2 },
  { id: 't-homea001', listId: 'home', title: 'Fix the tap', order: 1 },
  { id: 't-homeb001', listId: 'home', title: 'Paint the fence', order: 2, done: true, doneAt: '2026-10-02T10:00:00.000Z' },
]
function seed12() {
  const files = { 'README.md': NON_DATA['README.md'] }
  for (const [id, l] of Object.entries(LIST12)) files[`${id}/_list.md`] = listFile(l)
  for (const t of T12) files[pathOf(t)] = todoFile(t)
  return files
}

// ---- harness plumbing --------------------------------------------------------------------------

let h
let A
let B

async function setup(label, seed) {
  if (A) await A.close()
  if (B) await B.close()
  A = B = null
  await h.reset(seed)
  A = await h.device('A')
  B = await h.device('B')
  const a = await A.snapshot({ full: true })
  const b = await B.snapshot({ full: true })
  const folders = new Set(Object.keys(seed).filter((p) => p.endsWith('/_list.md')).map((p) => p.split('/')[0]))
  check(
    `${label}: both devices read the seed (${folders.size} lists), nothing pending`,
    a.lists.length === folders.size && same(model(a), model(b)) && !a.pending.length && !b.pending.length,
    { a: model(a), b: model(b) },
  )
}

/** Delete a list on a device, check the toast holds the commit, then dismiss it so the commit can go. */
async function deleteOn(D, listId) {
  const now = Date.now()
  const ok = await D.store((s, id) => s.deleteList(id), listId)
  const toast = await D.store((s) => (s.toast ? { message: s.toast.message, hold: s.toast.holdUntil ?? 0, undo: !!s.toast.undo } : null))
  const pending = (await D.snapshot()).pending
  await D.store((s) => s.dismissToast())
  return { ok, toast, pending, holds: !!toast && toast.hold > now + 20_000 }
}

const commits = () => h.commits()
const last = async () => (await commits()).at(-1)
const gone = (snap, listId) => !snap.lists.some((l) => l.id === listId) && !snap.todos.some((t) => t.listId === listId)

const RE = {
  changeLost: (names) => new RegExp(`^02 (${names.join('|')}) was deleted on another device, so the change made to it here wasn't kept\\.$`),
  revived1: (name) => `02 ${name} was deleted on another device. It was kept for the to-do changed here.`,
  kept: (name, n, left) => `02 ${name} was kept for ${n} ${n === 1 ? 'to-do' : 'to-dos'} changed or added on another device. ${left === 1 ? 'The other one stays deleted.' : `The other ${left} stay deleted.`}`,
}

/** The global invariants, on the repo and both devices, after one more round of syncs. */
async function invariants(label, { nonData, allowUnslug = [] }) {
  const devs = [A, B]
  try {
    for (const d of devs) await d.sync()
    for (const d of devs) await d.sync()
  } catch (e) {
    check(`${label} [inv] final syncs ran`, false, String(e))
  }
  const [a, b] = [await A.snapshot({ full: true }), await B.snapshot({ full: true })]
  check(`${label} [inv] A and B converge (every field of every list and to-do)`, same(model(a), model(b)), { a: model(a), b: model(b) })
  check(`${label} [inv] nothing pending on A or B`, !a.pending.length && !b.pending.length, { a: a.pending, b: b.pending })
  check(`${label} [inv] neither device shows failed`, a.sync.kind !== 'failed' && b.sync.kind !== 'failed', { a: a.sync, b: b.sync })

  const files = await h.repoFiles()
  const rm = repoModel(files)
  const orphans = [...rm.todoFolders].filter((f) => !rm.lists[f])
  check(`${label} [inv] no repo folder holds a data .md without its _list.md`, !orphans.length, { orphans, paths: Object.keys(files) })

  const bad = []
  for (const s of [a, b]) for (const l of s.lists) if (l.name === unslug(l.slug) && !allowUnslug.includes(l.slug)) bad.push(`device list ${l.slug} named ${l.name}`)
  for (const [f, l] of Object.entries(rm.lists)) if (l.name === unslug(f) && !allowUnslug.includes(f)) bad.push(`repo ${f}/_list.md named ${l.name}`)
  check(`${label} [inv] no list is named after its folder (an orphan read back)`, !bad.length, bad)

  const strays = []
  for (const [n, s] of [['A', a], ['B', b]]) {
    const ids = new Set(s.lists.map((l) => l.id))
    for (const t of s.todos) if (!ids.has(t.listId)) strays.push(`${n}: ${t.title} in ${t.listId}`)
  }
  check(`${label} [inv] every to-do's list exists on both devices`, !strays.length, strays)

  const want = { ...nonData }
  for (const l of a.lists) want[`${l.slug}/_list.md`] = listFile(l)
  for (const t of a.todos) want[`${a.lists.find((l) => l.id === t.listId)?.slug ?? t.listId}/${slugify(t.title)}.md`] = todoFile(t)
  const diff = diffFiles(files, want)
  check(`${label} [inv] the repo holds exactly the devices' lists and to-dos, plus its non-data files`, !diff.length, diff)

  const warnings = await h.warnings()
  check(`${label} [inv] no tree entry deleted a path missing from its base (mock warnings)`, !warnings.length, warnings)
  const pageErrors = devs.flatMap((d) => d.errors.filter((e) => e.startsWith('pageerror')).map((e) => `${d.name} ${e}`))
  check(`${label} [inv] no uncaught page errors`, !pageErrors.length, pageErrors)
  const stillFiled = devs.flatMap((d) => d.errors.filter((e) => /still filed in the deleted list/.test(e)).map((e) => `${d.name} ${e}`))
  check(`${label} [inv] no "still filed in the deleted list" warning from the plan`, !stillFiled.length, stillFiled)
  check(`${label} [inv] nothing reached api.github.com`, !h.realGitHubHits.length, h.realGitHubHits)
  const all = await h.commits({ all: true })
  const off = all.filter((c) => !c.onBranch)
  if (off.length) info(`commits off the branch: ${JSON.stringify(off.map((c) => [c.by, c.message]))}`)
  info(`history: ${JSON.stringify(describeCommits(await h.commits()), null, 1).replace(/\n/g, '\n        ')}`)
  const noise = devs.flatMap((d) => d.errors.filter((e) => !e.startsWith('pageerror')).map((e) => `${d.name} ${e}`))
  if (noise.length) info(`console output (not failures):\n        ${noise.join('\n        ')}`)
  return { a, b, files }
}

const describeCommits = (cs) => cs.map((c) => `${c.by}: ${c.message.replace(/\n/g, ' | ')} [${c.changed.join(', ')}]`)

/** Both devices offline, A deletes Home stuff, B does `bAction`; then one goes online first. */
async function twoDevice(label, order, bAction) {
  await setup(label, seedMain())
  await A.offline(true)
  await B.offline(true)
  const del = await deleteOn(A, 'home')
  check(
    `${label}: A deletes Home stuff offline (4 removals and the list recorded; the toast holds its commit)`,
    del.ok === true && del.holds && del.pending.filter((c) => c.kind === 'removed').length === 4 && del.pending.some((c) => c.kind === 'list' && c.id === 'home'),
    del,
  )
  await bAction()
  return del
}

// ---- scenarios ---------------------------------------------------------------------------------

async function s6(order) {
  const L = `6${order}`
  section(`${L}. A deletes Home stuff; B, unaware, renames it only; ${order === 'X' ? 'A (deleting)' : 'B'} syncs first`)
  await twoDevice(L, order, async () => {
    const ok = await B.store((s) => s.renameList('home', 'Chores'))
    check(`${L}: B renames Home stuff to Chores offline`, ok === true)
  })
  if (order === 'X') {
    await A.offline(false)
    await A.sync()
    const c = await last()
    check(`${L}: A's one commit deletes the folder's data (not home/README.md): "Delete list “Home stuff” and its 4 to-dos"`, c.by === 'A' && c.message === 'Delete list “Home stuff” and its 4 to-dos' && same(c.changes.deleted, HOME_DATA) && !c.changes.added.length && !c.changes.modified.length, c)
    await B.offline(false)
    const b = await B.sync()
    check(`${L}: B shows the changeLost banner for home/`, b.conflict?.path === 'home/' && RE.changeLost(['Chores', 'Home stuff']).test(b.conflict.message ?? ''), { conflict: b.conflict, sync: b.sync })
    if (b.conflict?.message) info(`B's banner: ${b.conflict.message}`)
    check(`${L}: B's rename made no commit (seed + A's delete only)`, (await commits()).length === 2, describeCommits(await commits()))
    check(`${L}: Home stuff is gone on B`, gone(b, 'home'), model(b))
    const a = await A.sync()
    check(`${L}: A shows no banner`, a.sync.kind === 'saved' && !a.conflict, { sync: a.sync, conflict: a.conflict })
  } else {
    await B.offline(false)
    await B.sync()
    const c = await last()
    check(`${L}: B commits the rename alone`, c.by === 'B' && same(c.changed, ['home/_list.md']), c)
    await A.offline(false)
    const a = await A.sync()
    check(`${L}: A shows no banner`, a.sync.kind === 'saved' && !a.conflict, { sync: a.sync, conflict: a.conflict })
    const c2 = await last()
    check(`${L}: A's commit deletes the folder's data (not home/README.md), in one commit`, c2.by === 'A' && same(c2.changes.deleted, HOME_DATA) && !c2.changes.added.length && !c2.changes.modified.length, c2)
    check(`${L}: A's commit message is "Delete list “…” and its 4 to-dos"`, /^Delete list “(Home stuff|Chores)” and its 4 to-dos$/.test(c2.message), c2.message)
    info(`A's commit message: ${c2.message}`)
    check(`${L}: Home stuff is gone on A`, gone(a, 'home'), model(a))
    const b = await B.sync()
    check(`${L}: B shows no banner and just sees the list vanish`, b.sync.kind === 'saved' && !b.conflict && gone(b, 'home'), { sync: b.sync, conflict: b.conflict, lists: b.lists })
  }
  const { a } = await invariants(L, { nonData: NON_DATA })
  check(`${L}: Home stuff and its to-dos are gone; the other lists stay`, gone(a, 'home') && same(a.lists.map((l) => l.id), ['inbox', 'work']) && same(a.todos.map((t) => t.id).sort(), [T.x.id, T.w.id].sort()), model(a))
}

async function s7(order) {
  const L = `7${order}`
  section(`${L}. A deletes Home stuff; B, unaware, renames it AND edits "Fix the tap"; ${order === 'X' ? 'A (deleting)' : 'B'} syncs first`)
  await twoDevice(L, order, async () => {
    const ok = await B.store((s) => s.renameList('home', 'Chores'))
    await B.edit(T.a.id, { title: 'Fix the tap today' })
    const b = await B.snapshot()
    check(`${L}: B renames to Chores and edits a, offline`, ok === true && b.pending.length === 2, b.pending)
  })
  const aPath = 'home/fix-the-tap-today.md'
  if (order === 'X') {
    await A.offline(false)
    await A.sync()
    const c = await last()
    check(`${L}: A commits the delete: "Delete list “Home stuff” and its 4 to-dos"`, c.by === 'A' && c.message === 'Delete list “Home stuff” and its 4 to-dos' && same(c.changes.deleted, HOME_DATA), c)
    await B.offline(false)
    const b = await B.sync()
    check(`${L}: B shows the revived banner`, b.conflict?.path === 'home/' && b.conflict.message === RE.revived1('Chores'), { got: b.conflict, want: RE.revived1('Chores') })
    const c2 = await last()
    check(`${L}: B writes the list back, under its new name, with only a`, c2.by === 'B' && same(c2.changes.added, ['home/_list.md', aPath]) && !c2.changes.deleted.length && !c2.changes.modified.length, c2)
    const a = await A.sync()
    check(`${L}: A, which had nothing pending, shows no banner`, a.sync.kind === 'saved' && !a.conflict, { sync: a.sync, conflict: a.conflict })
  } else {
    await B.offline(false)
    await B.sync()
    const c = await last()
    check(`${L}: B commits the rename and the edit`, c.by === 'B' && same(c.changes, { added: [aPath], modified: ['home/_list.md'], deleted: ['home/fix-the-tap.md'] }), c)
    await A.offline(false)
    const a = await A.sync()
    check(`${L}: A shows the kept banner`, a.conflict?.path === 'home/' && a.conflict.message === RE.kept('Chores', 1, 3), { got: a.conflict, want: RE.kept('Chores', 1, 3) })
    const c2 = await last()
    const rest = ['b', 'c', 'd'].map((k) => pathOf(T[k])).sort()
    check(`${L}: A's commit deletes only the 3 to-dos B didn't change, keeping _list.md`, c2.by === 'A' && same(c2.changes.deleted, rest) && !c2.changes.added.length && !c2.changes.modified.length, c2)
    info(`A's commit message: ${c2.message.replace(/\n/g, ' | ')}`)
    const b = await B.sync()
    check(`${L}: B, which had nothing pending, shows no banner`, b.sync.kind === 'saved' && !b.conflict, { sync: b.sync, conflict: b.conflict })
  }
  const { a } = await invariants(L, { nonData: NON_DATA })
  const home = a.lists.find((l) => l.id === 'home')
  const inHome = a.todos.filter((t) => t.listId === 'home')
  check(`${L}: Home survives as 02 Chores, ink 5, holding only "Fix the tap today"`, same(home, { id: 'home', slug: 'home', index: 2, name: 'Chores', ink: 5 }) && inHome.length === 1 && inHome[0].id === T.a.id && inHome[0].title === 'Fix the tap today', { home, inHome })
}

async function s8(order) {
  const L = `8${order}`
  section(`${L}. A deletes Home stuff; B, unaware, only reorders its rows; ${order === 'X' ? 'A (deleting)' : 'B'} syncs first`)
  await twoDevice(L, order, async () => {
    await B.store((s, id) => s.reorder(id, 1), T.a.id)
    const b = await B.snapshot({ full: true })
    const ta = b.todos.find((t) => t.id === T.a.id)
    const tb = b.todos.find((t) => t.id === T.b.id)
    check(`${L}: B moves "Fix the tap" below "Paint the fence" (orders swap, 2 pending edits)`, ta.order === 2 && tb.order === 1 && b.pending.length === 2, { ta, tb, pending: b.pending })
  })
  if (order === 'X') {
    await A.offline(false)
    await A.sync()
    const c = await last()
    check(`${L}: A commits the delete`, c.by === 'A' && c.message === 'Delete list “Home stuff” and its 4 to-dos' && same(c.changes.deleted, HOME_DATA), c)
    await B.offline(false)
    const b = await B.sync()
    check(`${L}: B shows no banner, and Home stuff is gone`, b.sync.kind === 'saved' && !b.conflict && gone(b, 'home'), { sync: b.sync, conflict: b.conflict, model: model(b) })
    check(`${L}: B's reorder made no commit`, (await commits()).length === 2, describeCommits(await commits()))
  } else {
    await B.offline(false)
    await B.sync()
    const c = await last()
    check(`${L}: B commits the reorder (two files)`, c.by === 'B' && same(c.changes.modified, [pathOf(T.a), pathOf(T.b)].sort()) && !c.changes.added.length && !c.changes.deleted.length, c)
    await A.offline(false)
    const a = await A.sync()
    check(`${L}: A shows no banner`, a.sync.kind === 'saved' && !a.conflict, { sync: a.sync, conflict: a.conflict })
    const c2 = await last()
    check(`${L}: A's commit deletes the whole folder's data anyway`, c2.by === 'A' && c2.message === 'Delete list “Home stuff” and its 4 to-dos' && same(c2.changes.deleted, HOME_DATA) && !c2.changes.added.length && !c2.changes.modified.length, c2)
    const b = await B.sync()
    check(`${L}: B shows no banner, and Home stuff is gone`, b.sync.kind === 'saved' && !b.conflict && gone(b, 'home'), { sync: b.sync, conflict: b.conflict, model: model(b) })
  }
  const { a } = await invariants(L, { nonData: NON_DATA })
  check(`${L}: Home stuff is gone; the other lists stay`, gone(a, 'home') && same(a.lists.map((l) => l.id), ['inbox', 'work']), model(a))
  const sa = await A.snapshot()
  const sb = await B.snapshot()
  check(`${L}: no banner on either device at the end`, sa.sync.kind === 'saved' && !sa.conflict && sb.sync.kind === 'saved' && !sb.conflict, { A: { sync: sa.sync, conflict: sa.conflict }, B: { sync: sb.sync, conflict: sb.conflict } })
}

async function s9(order) {
  const L = `9${order}`
  section(`${L}. A and B both delete Home stuff, unaware of each other; ${order === 'X' ? 'A' : 'B'} syncs first`)
  await twoDevice(L, order, async () => {
    const del = await deleteOn(B, 'home')
    check(`${L}: B deletes Home stuff too, offline`, del.ok === true && del.holds, del)
  })
  const [first, second] = order === 'X' ? [A, B] : [B, A]
  await first.offline(false)
  await first.sync()
  const c = await last()
  check(`${L}: ${first.name} commits the delete`, c.by === first.name && c.message === 'Delete list “Home stuff” and its 4 to-dos' && same(c.changes.deleted, HOME_DATA) && !c.changes.added.length && !c.changes.modified.length, c)
  await second.offline(false)
  const s = await second.sync()
  check(`${L}: ${second.name}'s merge takes in the delete: nothing pending, no banner`, !s.pending.length && s.sync.kind === 'saved' && !s.conflict && gone(s, 'home'), { sync: s.sync, conflict: s.conflict, pending: s.pending, lists: s.lists })
  const f = await first.sync()
  check(`${L}: ${first.name} shows no banner`, f.sync.kind === 'saved' && !f.conflict, { sync: f.sync, conflict: f.conflict })
  await invariants(L, { nonData: NON_DATA })
  const cs = await commits()
  const all = await h.commits({ all: true })
  const deletions = cs.filter((x) => x.changes.deleted.some((p) => p.startsWith('home/')))
  check(`${L}: exactly ONE deletion commit on the branch, and no other commit (seed + 1)`, cs.length === 2 && deletions.length === 1, describeCommits(cs))
  check(`${L}: no refused or stray commit either`, all.length === 2, describeCommits(all))
}

async function s10(variant) {
  const L = `10${variant}`
  const withEdit = variant === 'a'
  section(`${L}. B offline "for a day" with ${withEdit ? 'an edit to "Fix the tap"' : 'an edit outside Home stuff only'}; A deletes Home stuff and moves on; B comes back much later`)
  await setup(L, seedMain())
  const note = 'The washer is in the drawer'
  if (withEdit) await B.edit(T.a.id, { note })
  else await B.edit(T.w.id, { note: 'Draft attached' })
  await B.offline(true)
  const b0 = await B.snapshot()
  check(`${L}: B went offline with its edit pending, uncommitted`, b0.pending.length === 1 && (await commits()).length === 1, { pending: b0.pending, commits: describeCommits(await commits()) })

  const del = await deleteOn(A, 'home')
  check(`${L}: A deletes Home stuff (online; the toast holds the commit until dismissed)`, del.ok === true && del.holds, del)
  await A.sync()
  let c = await last()
  check(`${L}: A commits the delete`, c.by === 'A' && c.message === 'Delete list “Home stuff” and its 4 to-dos' && same(c.changes.deleted, HOME_DATA), c)
  // The day goes on: more commits from A and a third device.
  const venue = await A.add('Book the venue', 'work')
  await A.sync()
  await h.externalCommit({ 'inbox/order-paper.md': todoFile({ id: 't-paper001', title: 'Order paper', order: 2, createdAt: '2026-10-03T08:00:00.000Z' }) }, 'Add from the phone')
  await A.toggle(T.x.id)
  await A.sync()
  const cs = await commits()
  info(`B is ${cs.length - 1} commits behind when it comes back: ${JSON.stringify(cs.slice(1).map((x) => `${x.by}: ${x.message}`))}`)

  await B.offline(false)
  const b = await B.sync()
  if (withEdit) {
    check(`${L}: B shows the revived banner`, b.conflict?.path === 'home/' && b.conflict.message === RE.revived1('Home stuff'), { got: b.conflict, want: RE.revived1('Home stuff') })
    c = await last()
    check(`${L}: B writes Home stuff back with only a`, c.by === 'B' && same(c.changes.added, ['home/_list.md', pathOf(T.a)]) && !c.changes.deleted.length && !c.changes.modified.length, c)
  } else {
    check(`${L}: B shows no banner and Home stuff disappears cleanly`, b.sync.kind === 'saved' && !b.conflict && gone(b, 'home'), { sync: b.sync, conflict: b.conflict, model: model(b) })
    c = await last()
    check(`${L}: B commits only its own edit`, c.by === 'B' && same(c.changed, [pathOf(T.w)]), c)
  }
  check(`${L}: B took in the day's other changes`, b.todos.some((t) => t.id === venue.id) && b.todos.some((t) => t.id === 't-paper001') && b.todos.find((t) => t.id === T.x.id)?.done === true, model(b))
  const a = await A.sync()
  check(`${L}: A shows no banner`, a.sync.kind === 'saved' && !a.conflict, { sync: a.sync, conflict: a.conflict })
  const { a: fin } = await invariants(L, { nonData: NON_DATA })
  if (withEdit) {
    const home = fin.lists.find((l) => l.id === 'home')
    const inHome = fin.todos.filter((t) => t.listId === 'home')
    check(`${L}: Home stuff survives (02, ink 5) holding only "Fix the tap", with B's note`, same(home, { id: 'home', slug: 'home', index: 2, name: 'Home stuff', ink: 5 }) && inHome.length === 1 && inHome[0].id === T.a.id && inHome[0].note === note, { home, inHome })
  } else {
    check(`${L}: Home stuff is gone; B's edit elsewhere is kept`, gone(fin, 'home') && fin.todos.find((t) => t.id === T.w.id)?.note === 'Draft attached', model(fin))
  }
}

async function s11(variant) {
  const L = `11${variant}`
  const withEdit = variant === 'a'
  section(`${L}. The home folder is deleted by hand on github.com while B ${withEdit ? 'has an unsynced edit to "Fix the tap"' : 'has nothing pending'}`)
  await setup(L, seedMain())
  await B.offline(true)
  if (withEdit) await B.edit(T.a.id, { tags: ['diy'] })
  const homeFiles = Object.keys(seedMain()).filter((p) => p.startsWith('home/'))
  await h.externalCommit(Object.fromEntries(homeFiles.map((p) => [p, null])), 'Delete home by hand')
  const ext = await last()
  check(`${L}: the hand commit deletes every home/ file (README.md included)`, same(ext.changes.deleted, homeFiles.sort()), ext)
  let a = await A.sync()
  check(`${L}: A, with nothing pending, sees Home stuff vanish without a banner`, a.sync.kind === 'saved' && !a.conflict && gone(a, 'home'), { sync: a.sync, conflict: a.conflict, model: model(a) })
  await B.offline(false)
  const b = await B.sync()
  if (withEdit) {
    check(`${L}: B keeps Home stuff with only a, and shows the revived banner`, b.conflict?.path === 'home/' && b.conflict.message === RE.revived1('Home stuff'), { got: b.conflict, want: RE.revived1('Home stuff') })
    const c = await last()
    check(`${L}: B writes back home/_list.md and a`, c.by === 'B' && same(c.changes.added, ['home/_list.md', pathOf(T.a)]) && !c.changes.deleted.length && !c.changes.modified.length, c)
    a = await A.sync()
    check(`${L}: A sees Home stuff come back with a, without a banner`, a.sync.kind === 'saved' && !a.conflict && a.todos.filter((t) => t.listId === 'home').map((t) => t.id).join() === T.a.id, { sync: a.sync, conflict: a.conflict, model: model(a) })
  } else {
    check(`${L}: B sees Home stuff vanish silently`, b.sync.kind === 'saved' && !b.conflict && gone(b, 'home'), { sync: b.sync, conflict: b.conflict, model: model(b) })
    check(`${L}: B made no commit`, (await commits()).length === 2, describeCommits(await commits()))
  }
  const { a: fin } = await invariants(L, { nonData: { 'README.md': NON_DATA['README.md'] } })
  if (withEdit) {
    const home = fin.lists.find((l) => l.id === 'home')
    const inHome = fin.todos.filter((t) => t.listId === 'home')
    check(`${L}: Home stuff (02, ink 5) holds only "Fix the tap" #diy`, same(home, { id: 'home', slug: 'home', index: 2, name: 'Home stuff', ink: 5 }) && inHome.length === 1 && same(inHome[0].tags, ['diy']), { home, inHome })
  } else {
    check(`${L}: Home stuff is gone everywhere`, gone(fin, 'home'), model(fin))
  }
}

/** 7, with three to-dos changed on B (plural and "the other one" wordings). */
async function s7b(order) {
  const L = `7${order}b`
  section(`${L}. A deletes Home stuff; B, unaware, renames it and changes 3 of its 4 to-dos (one reopened); ${order === 'X' ? 'A (deleting)' : 'B'} syncs first`)
  await twoDevice(L, order, async () => {
    await B.store((s) => s.renameList('home', 'Chores'))
    await B.edit(T.a.id, { title: 'Fix the tap today' })
    await B.edit(T.c.id, { note: 'Use the rain barrel' })
    await B.toggle(T.d.id)
    const b = await B.snapshot()
    check(`${L}: B has 4 pending changes`, b.pending.length === 4, b.pending)
  })
  const kept = [T.a.id, T.c.id, T.d.id].sort()
  if (order === 'X') {
    await A.offline(false)
    await A.sync()
    await B.offline(false)
    const b = await B.sync()
    const want = '02 Chores was deleted on another device. It was kept for the 3 to-dos changed here.'
    check(`${L}: B shows the revived banner, plural`, b.conflict?.path === 'home/' && b.conflict.message === want, { got: b.conflict, want })
    const c = await last()
    check(`${L}: B writes back _list.md and the 3 changed to-dos`, c.by === 'B' && same(c.changes.added, ['home/_list.md', 'home/clean-the-gutters.md', 'home/fix-the-tap-today.md', 'home/water-the-plants.md']) && !c.changes.deleted.length && !c.changes.modified.length, c)
  } else {
    await B.offline(false)
    await B.sync()
    await A.offline(false)
    const a = await A.sync()
    const want = '02 Chores was kept for 3 to-dos changed or added on another device. The other one stays deleted.'
    check(`${L}: A shows the kept banner, "the other one"`, a.conflict?.path === 'home/' && a.conflict.message === want, { got: a.conflict, want })
    const c = await last()
    check(`${L}: A deletes only "Paint the fence"`, c.by === 'A' && same(c.changes.deleted, [pathOf(T.b)]) && !c.changes.added.length && !c.changes.modified.length, c)
    info(`A's commit message: ${c.message.replace(/\n/g, ' | ')}`)
  }
  const { a } = await invariants(L, { nonData: NON_DATA })
  const home = a.lists.find((l) => l.id === 'home')
  const inHome = a.todos.filter((t) => t.listId === 'home')
  check(`${L}: 02 Chores survives with a, c and d (d reopened)`, home?.name === 'Chores' && home?.index === 2 && same(inHome.map((t) => t.id).sort(), kept) && inHome.find((t) => t.id === T.d.id)?.done === false, { home, inHome })
}

/** 9, with B's undo toast still up when A's delete reaches it: then dismissed (h) or undone (u). */
async function s9h(variant) {
  const L = `9X${variant}`
  section(`${L}. A and B both delete Home stuff; B's undo toast is still up when A's delete arrives; then B ${variant === 'h' ? 'lets the toast go' : 'presses undo'}`)
  await setup(L, seedMain())
  await A.offline(true)
  await B.offline(true)
  const da = await deleteOn(A, 'home')
  const ok = await B.store((s) => s.deleteList('home'))
  // The user's pointer rests on the toast: its 8 s timer stops (the hold stays capped at 30 s).
  await B.store((s) => s.pauseToast(true))
  const t = await B.store((s) => (s.toast ? { hold: s.toast.holdUntil ?? 0, undo: !!s.toast.undo } : null))
  check(`${L}: both delete Home stuff offline; B's toast holds its commit`, da.ok && ok === true && t?.undo && t.hold > Date.now() + 15_000, { da, ok, t })
  await A.offline(false)
  await A.sync()
  const c0 = await B.store(() => window.__e2e.cycles)
  const tOnline = Date.now()
  await B.offline(false)
  // B's first cycle back online reads A's delete and merges it (its own commit waits for the hold).
  await B.waitFor((s, n) => window.__e2e.cycles > n && !window.__e2e.inflight, c0, { what: 'its first cycle back online' })
  const m = await B.snapshot()
  const toast = await B.store((s) => (s.toast ? { message: s.toast.message, hold: s.toast.holdUntil ?? 0 } : null))
  check(`${L}: B's merge of A's delete leaves nothing pending (GitHub already has the delete), toast still up`, !m.pending.length && !!toast && gone(m, 'home'), { pending: m.pending, sync: m.sync, conflict: m.conflict, toast })
  let b
  if (variant === 'h') {
    // The toast goes right after the merge: the hold ends, and there must be nothing left to commit.
    await B.store((s) => s.dismissToast())
    b = await B.sync()
    check(`${L}: the hold ends with nothing to commit: one deletion commit only, B saved`, (await commits()).length === 2 && (await h.commits({ all: true })).length === 2 && b.sync.kind === 'saved' && !b.conflict, { sync: b.sync, conflict: b.conflict, commits: describeCommits(await h.commits({ all: true })) })
    const { a } = await invariants(L, { nonData: NON_DATA })
    check(`${L}: Home stuff is gone`, gone(a, 'home'), model(a))
  } else {
    // Undo while the toast (and its hold) is still up, right after the merge.
    const r = await B.store((s) => s.undo())
    const said = await B.store(() => new Promise((res) => setTimeout(res, 20)).then(() => window.__e2e.store.announcement))
    const want = 'Restored list 02 Home stuff. 4 were deleted on another device.'
    check(`${L}: B's undo restores the list without the 4 to-dos A deleted, and says so`, same(r, { list: 'home' }) && said === want, { r, said, want })
    b = await B.sync()
    const c = await last()
    check(`${L}: B's next commit writes home/_list.md back, with no to-do`, c.by === 'B' && same(c.changes.added, ['home/_list.md']) && !c.changes.deleted.length && !c.changes.modified.length, c)
    const { a } = await invariants(L, { nonData: NON_DATA })
    check(`${L}: 02 Home stuff is back, empty, on both`, same(a.lists.find((l) => l.id === 'home'), { id: 'home', slug: 'home', index: 2, name: 'Home stuff', ink: 5 }) && !a.todos.some((x) => x.listId === 'home'), model(a))
  }
}

/** 9, where B's batch also holds an edit elsewhere: its commit must carry the edit only. */
async function s9e() {
  const L = '9Xe'
  section(`${L}. A and B both delete Home stuff; B also edits "Send the report" (work); A syncs first`)
  await twoDevice(L, 'X', async () => {
    const del = await deleteOn(B, 'home')
    await B.edit(T.w.id, { note: 'Draft attached' })
    check(`${L}: B deletes Home stuff and edits a work to-do, offline`, del.ok === true && (await B.snapshot()).pending.length === 6, (await B.snapshot()).pending)
  })
  await A.offline(false)
  await A.sync()
  await B.offline(false)
  const b = await B.sync()
  const cs = await commits()
  const c = cs.at(-1)
  check(`${L}: B's commit is the edit alone: "Edit “Send the report”", one file`, cs.length === 3 && c.by === 'B' && c.message === 'Edit “Send the report”' && same(c.changed, [pathOf(T.w)]), describeCommits(cs))
  check(`${L}: B shows no banner`, b.sync.kind === 'saved' && !b.conflict, { sync: b.sync, conflict: b.conflict })
  const { a } = await invariants(L, { nonData: NON_DATA })
  check(`${L}: Home stuff is gone and the edit is kept`, gone(a, 'home') && a.todos.find((t) => t.id === T.w.id)?.note === 'Draft attached', model(a))
}

/** 7, order Y, with A online: B's commit lands while A's delete is held by its toast; A merges during the hold. */
async function s7h() {
  const L = '7Yh'
  section(`${L}. A deletes Home stuff online (toast up, commit held); B renames it and edits "Fix the tap" and commits during A's hold`)
  await setup(L, seedMain())
  const ok = await A.store((s) => s.deleteList('home'))
  await A.store((s) => s.pauseToast(true))
  await B.store((s) => s.renameList('home', 'Chores'))
  await B.edit(T.a.id, { title: 'Fix the tap today' })
  await B.sync()
  check(`${L}: B committed while A's delete waits`, ok === true && (await commits()).length === 2 && (await last()).by === 'B', describeCommits(await commits()))
  await A.store((s) => s.remote.check())
  await A.waitFor(() => !!window.__e2e.conflict(), null, { what: 'the kept banner', timeout: 15_000 })
  const a0 = await A.snapshot()
  const toast = await A.store((s) => (s.toast ? { hold: s.toast.holdUntil } : null))
  const want = RE.kept('Chores', 1, 3)
  check(`${L}: A merges during its hold: kept banner, toast still up, no commit from A yet`, a0.conflict?.message === want && a0.conflict?.path === 'home/' && !!toast && (await commits()).length === 2, { conflict: a0.conflict, want, toast })
  check(`${L}: A now holds 02 Chores with only "Fix the tap today", and the 3 removals pending`, same(a0.todos.filter((t) => t.listId === 'home').map((t) => t.title), ['Fix the tap today']) && a0.lists.find((l) => l.id === 'home')?.name === 'Chores' && same(a0.pending.map((p) => p.kind).sort(), ['removed', 'removed', 'removed']), { lists: a0.lists, pending: a0.pending })
  await A.store((s) => s.dismissToast())
  await A.sync()
  const c = await last()
  check(`${L}: once the toast goes, A deletes only the 3 to-dos B didn't change`, c.by === 'A' && same(c.changes.deleted, ['b', 'c', 'd'].map((k) => pathOf(T[k])).sort()) && !c.changes.added.length && !c.changes.modified.length, c)
  const { a } = await invariants(L, { nonData: NON_DATA })
  check(`${L}: 02 Chores survives with only "Fix the tap today"`, a.lists.find((l) => l.id === 'home')?.name === 'Chores' && same(a.todos.filter((t) => t.listId === 'home').map((t) => t.id), [T.a.id]), model(a))
}

async function s12(order) {
  const L = `12${order}`
  section(`${L}. Two lists only: A deletes 01 Errands list, B deletes 02 Home stuff, unaware; ${order === 'X' ? 'A' : 'B'} syncs first`)
  await setup(L, seed12())
  await A.offline(true)
  await B.offline(true)
  const da = await deleteOn(A, 'errands')
  const db = await deleteOn(B, 'home')
  check(`${L}: A deletes Errands list and B deletes Home stuff (each has 2 lists)`, da.ok === true && db.ok === true, { da, db })
  const [first, second] = order === 'X' ? [A, B] : [B, A]
  const firstFolder = first === A ? 'errands' : 'home'
  const secondFolder = first === A ? 'home' : 'errands'
  const dataOf = (folder) => Object.keys(seed12()).filter((p) => p.startsWith(`${folder}/`)).sort()
  await first.offline(false)
  await first.sync()
  let c = await last()
  check(`${L}: ${first.name} commits its delete (${firstFolder}/)`, c.by === first.name && same(c.changes.deleted, dataOf(firstFolder)) && !c.changes.added.length && !c.changes.modified.length && /^Delete list “.+” and its 2 to-dos$/.test(c.message), c)
  await second.offline(false)
  const s = await second.sync()
  c = await last()
  check(`${L}: ${second.name}'s one commit deletes ${secondFolder}/ and writes inbox/_list.md`, c.by === second.name && same(c.changes.deleted, dataOf(secondFolder)) && same(c.changes.added, ['inbox/_list.md']) && !c.changes.modified.length, c)
  info(`${second.name}'s commit message: ${c.message.replace(/\n/g, ' | ')}`)
  info(`banners after the merges: ${second.name} ${JSON.stringify(s.conflict ?? s.sync)}`)
  const f = await first.sync()
  info(`banners: ${first.name} ${JSON.stringify(f.conflict ?? f.sync)}`)
  const { a, files } = await invariants(L, { nonData: { 'README.md': NON_DATA['README.md'] }, allowUnslug: ['inbox'] })
  check(`${L}: both end with only 01 Inbox (folder inbox, ink 1), no to-dos`, same(a.lists, [{ id: 'inbox', slug: 'inbox', index: 1, name: 'Inbox', ink: 1 }]) && !a.todos.length, model(a))
  check(`${L}: the repo is README.md and inbox/_list.md`, same(Object.keys(files).sort(), ['README.md', 'inbox/_list.md']) && files['inbox/_list.md'] === listFile({ index: 1, name: 'Inbox', ink: 1 }), files)
  check(`${L}: 3 commits in all (seed, two deletes)`, (await commits()).length === 3, describeCommits(await commits()))
}

// ---- run ---------------------------------------------------------------------------------------

const PLAN = [
  ['6X', () => s6('X')],
  ['6Y', () => s6('Y')],
  ['7X', () => s7('X')],
  ['7Y', () => s7('Y')],
  ['7Xb', () => s7b('X')],
  ['7Yb', () => s7b('Y')],
  ['7Yh', () => s7h()],
  ['8X', () => s8('X')],
  ['8Y', () => s8('Y')],
  ['9X', () => s9('X')],
  ['9Y', () => s9('Y')],
  ['9Xh', () => s9h('h')],
  ['9Xu', () => s9h('u')],
  ['9Xe', () => s9e()],
  ['10a', () => s10('a')],
  ['10b', () => s10('b')],
  ['11a', () => s11('a')],
  ['11b', () => s11('b')],
  ['12X', () => s12('X')],
  ['12Y', () => s12('Y')],
]

let aborted = false
try {
  section('start')
  h = await startHarness()
  console.log(`      mock ${h.apiUrl}, app ${h.appUrl}`)
  for (const [id, run] of PLAN) {
    if (ONLY && !ONLY.includes(id)) continue
    current = id
    try {
      await run()
    } catch (e) {
      check(`${id}: the scenario ran to the end`, false, e.stack ?? String(e))
      try {
        info(`commits: ${JSON.stringify(describeCommits(await commits()), null, 1)}`)
        if (A) info(`A: ${JSON.stringify(await A.snapshot())}`)
        if (B) info(`B: ${JSON.stringify(await B.snapshot())}`)
      } catch {}
    }
  }
} catch (e) {
  aborted = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${bad.length || aborted ? 'FAILED' : 'PASSED'}: ${results.length - bad.length}/${results.length} checks passed${aborted ? ', run aborted' : ''} in ${since()}`)
if (bad.length) console.log(`Failed:\n${bad.map((r) => `  [${r.scenario}] ${r.name}`).join('\n')}`)
process.exit(bad.length || aborted ? 1 : 0)
