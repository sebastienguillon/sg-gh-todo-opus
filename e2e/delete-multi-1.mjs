#!/usr/bin/env node
// List delete meets a concurrent change on another device: rows 1-5, each in both orders.
//   MOCK_PORT=5311 APP_PORT=5310 node delete-multi-1.mjs     (ONLY=2X,3Y to run a subset)
// Order H (extra, rows 2 and 4): both online; B commits while A's undo toast holds A's commit, A pulls
// and merges during the hold, then the toast goes and A commits.
//
// Device A deletes list L ("Home stuff", folder home: open a, b, c and done d). Device B, which hasn't
// seen the delete, does:
//   1 nothing                     -> L gone everywhere, no banner
//   2 edits a's title (2c: checks a off) -> L survives with only a (B's version), seeded name/number/ink;
//                                    banner "revived" on B (order X), "kept" on A (order Y)
//   3 moves a to K (work)         -> a in K, L gone, no banner
//   4 adds n to L                 -> L holds only n; banners as in 2 ("The other 4 stay deleted.")
//   5 moves m from K into L       -> L holds only m; work/m gone; banners
// Order X: A (deleting) syncs first. Order Y: B syncs first.

import { deepStrictEqual } from 'node:assert'
import { listFile, slugify, startHarness, todoFile } from './harness.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((s) => s.trim().toUpperCase())) : null

function same(a, b) {
  try {
    deepStrictEqual(a, b)
    return true
  } catch {
    return false
  }
}

function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}

const info = (text) => console.log(`      info: ${text}`)
const section = (title) => console.log(`\n== ${title}  [${since()}]`)
const model = (snap) => ({ lists: snap.lists, todos: snap.todos })

/** A copy of unslug in src/lib/repo.ts: the name a folder without _list.md would read back as. */
function unslug(file) {
  const words = file.replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled'
}
/** A copy of isDataPath in src/lib/repo.ts. */
const isDataPath = (p) => /^[^/._][^/]*\/[^/]+\.md$/.test(p) && !/\/readme\.md$/i.test(p)
const folderOf = (p) => p.slice(0, p.indexOf('/'))
const idOf = (text) => /\nid: ([^\n]+)\n/.exec(text)?.[1] ?? null

// ---- seed ---------------------------------------------------------------------------------------

const LISTS = {
  inbox: { index: 1, name: 'In tray', ink: 3 },
  work: { index: 2, name: 'Work things', ink: 7 },
  home: { index: 4, name: 'Home stuff', ink: 10 },
}
const T = {
  i1: { id: 't-inbox001', listId: 'inbox', title: 'Call the bank', order: 1 },
  k1: { id: 't-work0001', listId: 'work', title: 'Send the report', order: 1 },
  m: { id: 't-workm001', listId: 'work', title: 'Book the venue', order: 2 },
  a: { id: 't-homea001', listId: 'home', title: 'Fix the gate', order: 1 },
  b: { id: 't-homeb001', listId: 'home', title: 'Paint the shed', order: 2 },
  c: { id: 't-homec001', listId: 'home', title: 'Clean the gutters', order: 3 },
  d: { id: 't-homed001', listId: 'home', title: 'Mow the lawn', order: 4, done: true, doneAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z' },
}
const pathOf = (t) => `${t.listId}/${slugify(t.title)}.md`
const SEED = { 'README.md': '# To Do data\n\nTest repo for list deletes.\n' }
for (const [folder, l] of Object.entries(LISTS)) SEED[`${folder}/_list.md`] = listFile(l)
for (const t of Object.values(T)) SEED[pathOf(t)] = todoFile(t)
const SEEDED_FOLDER_NAMES = new Set() // no list is seeded with its folder's unslugged name
const HOME_LIST = { id: 'home', ...LISTS.home }
const brief = (t, patch = {}) => ({ id: t.id, listId: t.listId, title: t.title, done: !!t.done, ...patch })
const byId = (xs) => [...xs].sort((x, y) => x.id.localeCompare(y.id))
const OTHERS = [T.i1, T.k1, T.m]
const HOME_DATA = Object.keys(SEED).filter((p) => p.startsWith('home/') && p !== 'home/_list.md')

const KEPT_A = (n, left) =>
  `04 Home stuff was kept for ${n === 1 ? '1 to-do' : `${n} to-dos`} changed or added on another device.${left ? (left === 1 ? ' The other one stays deleted.' : ` The other ${left} stay deleted.`) : ''}`
const REVIVED_B = (n) => `04 Home stuff was deleted on another device. It was kept for ${n === 1 ? 'the to-do' : `the ${n} to-dos`} changed here.`
const DELETE_ALL = 'Delete list “Home stuff” and its 4 to-dos'

// ---- scenarios ----------------------------------------------------------------------------------
// Each: what B does offline, and what the end state must be.

const ROWS = [
  {
    row: '1',
    title: 'B does nothing',
    b: async () => ({}),
    lists: ['inbox', 'work'],
    todos: () => OTHERS.map((t) => brief(t)),
    banner: null,
    files: (files) => ({ remove: HOME_DATA.concat('home/_list.md') }),
    commits: {
      X: [['A', DELETE_ALL]],
      Y: [['A', DELETE_ALL]],
    },
  },
  {
    row: '2',
    hold: true,
    title: "B edits a's title",
    b: async (B) => {
      await B.edit(T.a.id, { title: 'Fix the gate today' })
      return {}
    },
    lists: ['inbox', 'work', 'home'],
    todos: () => [...OTHERS.map((t) => brief(t)), brief(T.a, { title: 'Fix the gate today' })],
    banner: { kept: KEPT_A(1, 3), revived: REVIVED_B(1) },
    keepTodos: [{ id: T.a.id, path: 'home/fix-the-gate-today.md' }],
    commits: {
      X: [['A', DELETE_ALL], ['B', null]],
      Y: [['B', 'Edit “Fix the gate today”'], ['A', null]],
    },
  },
  {
    row: '2c',
    title: 'B checks a off',
    b: async (B) => {
      await B.toggle(T.a.id)
      return {}
    },
    lists: ['inbox', 'work', 'home'],
    todos: () => [...OTHERS.map((t) => brief(t)), brief(T.a, { done: true })],
    banner: { kept: KEPT_A(1, 3), revived: REVIVED_B(1) },
    keepTodos: [{ id: T.a.id, path: 'home/fix-the-gate.md' }],
    commits: {
      X: [['A', DELETE_ALL], ['B', null]],
      Y: [['B', 'Check off “Fix the gate”'], ['A', null]],
    },
  },
  {
    row: '3',
    title: 'B moves a to K (work)',
    b: async (B) => {
      await B.store((s, id) => s.move(id, 'work'), T.a.id)
      return {}
    },
    lists: ['inbox', 'work'],
    todos: () => [...OTHERS.map((t) => brief(t)), brief(T.a, { listId: 'work' })],
    banner: null,
    workAdds: [{ id: T.a.id, path: 'work/fix-the-gate.md' }],
    commits: {
      X: [['A', DELETE_ALL], ['B', 'Move “Fix the gate”']],
      Y: [['B', 'Move “Fix the gate”'], ['A', 'Delete list “Home stuff” and its 3 to-dos']],
    },
  },
  {
    row: '4',
    hold: true,
    title: 'B adds n to L',
    b: async (B) => {
      const n = await B.add('Buy light bulbs', 'home')
      return { n }
    },
    lists: ['inbox', 'work', 'home'],
    todos: (ctx) => [...OTHERS.map((t) => brief(t)), { id: ctx.n.id, listId: 'home', title: 'Buy light bulbs', done: false }],
    banner: { kept: KEPT_A(1, 4), revived: REVIVED_B(1) },
    keepTodos: [{ id: (ctx) => ctx.n.id, path: 'home/buy-light-bulbs.md' }],
    commits: {
      X: [['A', DELETE_ALL], ['B', null]],
      Y: [['B', 'Add “Buy light bulbs”'], ['A', null]],
    },
  },
  {
    row: '5',
    title: 'B moves m from K into L',
    b: async (B) => {
      await B.store((s, id) => s.move(id, 'home'), T.m.id)
      return {}
    },
    lists: ['inbox', 'work', 'home'],
    todos: () => [brief(T.i1), brief(T.k1), brief(T.m, { listId: 'home' })],
    banner: { kept: KEPT_A(1, 4), revived: REVIVED_B(1) },
    keepTodos: [{ id: T.m.id, path: 'home/book-the-venue.md' }],
    workRemoves: ['work/book-the-venue.md'],
    commits: {
      X: [['A', DELETE_ALL], ['B', null]],
      Y: [['B', 'Move “Book the venue”'], ['A', null]],
    },
  },
]

// ---- checks shared by every scenario ------------------------------------------------------------

async function invariants(h, tag, A, B) {
  const a = await A.snapshot({ full: true })
  const b = await B.snapshot({ full: true })
  check(`${tag}: A and B converge (every field of every list and to-do)`, same(model(a), model(b)), { a: model(a), b: model(b) })
  check(`${tag}: nothing pending on either device`, a.pending.length === 0 && b.pending.length === 0, { a: a.pending, b: b.pending })
  check(`${tag}: neither device shows failed`, a.sync.kind !== 'failed' && b.sync.kind !== 'failed', { a: a.sync, b: b.sync })
  const files = await h.repoFiles()
  const folders = new Set(Object.keys(files).filter(isDataPath).map(folderOf))
  const orphans = [...folders].filter((f) => !(`${f}/_list.md` in files))
  check(`${tag}: no repo folder holds a data .md without its _list.md`, orphans.length === 0, { orphans, files: Object.keys(files) })
  const named = [...a.lists, ...b.lists].filter((l) => l.name === unslug(l.slug ?? l.id) && !SEEDED_FOLDER_NAMES.has(l.id))
  check(`${tag}: no list on either device is named after its folder (an orphan)`, named.length === 0, named)
  const lost = [a, b].flatMap((s, i) => s.todos.filter((t) => !s.lists.some((l) => l.id === t.listId)).map((t) => `${'AB'[i]}: ${t.id} in ${t.listId}`))
  check(`${tag}: every to-do files into an existing list, on both devices`, lost.length === 0, lost)
  const repoLists = Object.keys(files).filter((p) => p.endsWith('/_list.md')).map(folderOf).sort()
  const repoTodos = Object.entries(files).filter(([p]) => isDataPath(p) && !p.endsWith('/_list.md')).map(([, text]) => idOf(text)).sort()
  check(`${tag}: the devices' lists are the repo's _list.md folders`, same(a.lists.map((l) => l.id).sort(), repoLists), { device: a.lists.map((l) => l.id), repo: repoLists })
  check(`${tag}: the devices' to-dos are the repo's to-do files`, same(a.todos.map((t) => t.id).sort(), repoTodos), { device: a.todos.map((t) => t.id), repo: repoTodos })
  for (const [n, dev, snap] of [['A', A, a], ['B', B, b]]) {
    const saved = (await dev.storage()).repo
    const ok =
      saved &&
      saved.pending.length === 0 &&
      same(saved.lists.map((l) => l.id).sort(), snap.lists.map((l) => l.id).sort()) &&
      same(saved.todos.map((t) => t.id).sort(), snap.todos.map((t) => t.id).sort()) &&
      saved.base?.head === snap.head
    check(`${tag}: ${n}'s localStorage holds the same lists and to-dos, the current head, and nothing pending`, ok, saved && { pending: saved.pending, lists: saved.lists.map((l) => l.id), head: saved.base?.head, memHead: snap.head })
  }
  const warnings = await h.warnings()
  check(`${tag}: the mock saw no delete of a path missing from the base`, warnings.length === 0, warnings)
  const pageErrors = [...A.errors.map((e) => `A ${e}`), ...B.errors.map((e) => `B ${e}`)].filter((e) => e.includes('pageerror'))
  check(`${tag}: no uncaught page errors`, pageErrors.length === 0, pageErrors)
  const noise = [...A.errors.map((e) => `A ${e}`), ...B.errors.map((e) => `B ${e}`)].filter((e) => !e.includes('pageerror'))
  check(`${tag}: no console errors or warnings (no faults were injected)`, noise.length === 0, noise)
  check(`${tag}: nothing reached api.github.com`, h.realGitHubHits.length === 0, h.realGitHubHits)
  return { a, b, files }
}

// ---- one scenario -------------------------------------------------------------------------------

async function run(h, S, order) {
  const tag = `${S.row}${order}`
  const how = { X: 'A (deleting) syncs first', Y: 'B syncs first', H: "both online: B commits, A pulls it while its undo toast holds the commit" }[order]
  section(`${tag}. A deletes Home stuff; B ${S.title}; ${how}`)
  const late = order !== 'X' // the deleting device merges second (Y, and H)
  await h.reset(SEED)
  const A = await h.device('A')
  const B = await h.device('B')
  try {
    const a0 = await A.snapshot()
    const b0 = await B.snapshot()
    check(`${tag}: both devices read the seed (3 lists, 7 to-dos)`, a0.lists.length === 3 && a0.todos.length === 7 && same(model(a0), model(b0)), { a: model(a0), b: model(b0) })

    if (order !== 'H') {
      await A.offline(true)
      await B.offline(true)
    }

    // A deletes the list (offline, except in H).
    const del = await A.store((s) => {
      const ok = s.deleteList('home')
      return { ok, toast: s.toast && { message: s.toast.message, holdIn: s.toast.holdUntil - Date.now(), undo: !!s.toast.undo }, hold: s.commitHold - Date.now() }
    })
    check(`${tag}: A's deleteList('home') succeeds and offers an undo`, del.ok === true && del.toast?.undo === true, del)
    check(`${tag}: A's toast says what went`, del.toast?.message === 'Deleted list 04 Home stuff and its 4 to-dos', del.toast?.message)
    check(`${tag}: the toast holds A's commit for about 30 s`, del.toast?.holdIn > 29_000 && del.toast?.holdIn <= 30_000 && del.hold > 29_000, del)
    let a = await A.snapshot()
    const wantPending = [
      ...['a', 'b', 'c', 'd'].map((k) => ({ kind: 'removed', id: T[k].id, path: pathOf(T[k]) })),
      { kind: 'list', id: 'home', path: 'home/_list.md' },
    ]
    check(
      `${tag}: A records a removal per to-do (open and done) and a list change for the folder`,
      same(
        a.pending.map(({ kind, id, path }) => ({ kind, id, path })).sort((x, y) => (x.kind === 'list') - (y.kind === 'list') || x.id.localeCompare(y.id)),
        wantPending,
      ) && a.pending.at(-1)?.kind === 'list',
      a.pending,
    )
    check(`${tag}: A no longer shows the list or its to-dos`, !a.lists.some((l) => l.id === 'home') && !a.todos.some((t) => t.listId === 'home'), model(a))
    const persisted = await A.storage()
    check(`${tag}: the delete is saved to localStorage at once`, persisted.repo?.pending?.length === 5 && !persisted.repo.lists.some((l) => l.id === 'home'), persisted.repo?.pending)
    if (order !== 'H') {
      const hold = await A.store((s) => {
        s.dismissToast()
        return { toast: s.toast, hold: s.commitHold }
      })
      check(`${tag}: dismissing the toast ends the hold`, hold.toast === null && hold.hold === 0, hold)
    } else {
      // Keep the toast up (no 8 s timer); the hold stays capped at 30 s from the delete.
      const p = await A.store((s) => {
        s.pauseToast(true)
        return { toast: !!s.toast, hold: s.commitHold - Date.now() }
      })
      check(`${tag}: pausing the toast keeps it up, with the hold still capped at 30 s`, p.toast && p.hold > 25_000 && p.hold <= 30_000, p)
    }

    // B, which hasn't seen the delete, makes its change offline.
    const ctx = await S.b(B)
    const b = await B.snapshot()
    info(`B pending: ${JSON.stringify(b.pending.map((c) => `${c.kind} ${c.path}`))}`)

    const commits0 = (await h.commits()).length
    const first = order === 'X' ? A : B
    const second = order === 'X' ? B : A
    let afterFirst, afterSecond
    if (order !== 'H') {
      await first.offline(false)
      await first.sync()
      afterFirst = await first.snapshot()
      await second.offline(false)
      await second.sync()
      afterSecond = await second.snapshot()
      await first.sync()
      await second.sync()
    } else {
      await B.sync()
      afterFirst = await B.snapshot()
      const bHead = (await h.commits()).at(-1).sha
      check(`${tag}: A hasn't committed while its toast is up`, (await h.commits()).length === commits0 + 1 && (await h.commits()).at(-1).by === 'B', (await h.commits()).map((c) => [c.by, c.message]))
      // A reads while held: it pulls B's commit and merges, but doesn't commit.
      await A.store((s) => s.remote.check())
      await A.waitFor((s, sha) => s.remote.base.head === sha && !!window.__e2e.conflict(), bHead, { what: "A pulls B's commit", timeout: 15_000 })
      const during = await A.store((s) => ({ toast: !!s.toast, hold: s.commitHold - Date.now(), sync: s.sync, conflict: window.__e2e.conflict(), pending: s.pending.map((c) => `${c.kind} ${c.id}`) }))
      info(`A during the hold: ${JSON.stringify(during)}`)
      check(`${tag}: A pulled B's commit during the hold, still shows the toast, and made no commit`, during.toast && during.hold > 0 && (await h.commits()).length === commits0 + 1, during)
      check(`${tag}: A shows the "kept" banner as soon as it merges, during the hold`, same(during.conflict, { path: 'home/', message: S.banner.kept }), during.conflict)
      await A.store((s) => s.dismissToast())
      await A.sync()
      afterSecond = await A.snapshot()
      await B.sync()
      await A.sync()
    }
    const shows = (x) => (x.conflict ? `conflict${x.conflict.message ? ` "${x.conflict.message}"` : ''}` : x.sync.kind)
    info(`after ${first.name}'s sync: ${first.name} shows ${shows(afterFirst)}; after ${second.name}'s merge: ${second.name} shows ${shows(afterSecond)}`)

    // ---- commits ----
    const commits = (await h.commits()).slice(commits0)
    const wantC = S.commits[late ? 'Y' : 'X']
    info(`commits: ${JSON.stringify(commits.map((c) => [c.by, c.message, c.changes]))}`)
    check(
      `${tag}: the commits are ${wantC.map(([by, msg]) => `${by}${msg ? ` "${msg}"` : ''}`).join(', then ')}`,
      commits.length === wantC.length && wantC.every(([by, msg], i) => commits[i].by === by && (msg === null || commits[i].message === msg)),
      commits.map((c) => [c.by, c.message]),
    )
    const delCommit = commits.find((c) => c.by === 'A')
    if (!late || ['1', '3'].includes(S.row)) {
      // The deletion commit takes the folder: every to-do file left in it, then _list.md.
      const wantDeleted = !late || S.row === '1' ? [...HOME_DATA, 'home/_list.md'].sort() : HOME_DATA.filter((p) => p !== pathOf(T.a)).concat('home/_list.md').sort()
      check(
        `${tag}: A's delete commit removes exactly the home folder's files, in one commit`,
        delCommit && same(delCommit.changes, { added: [], modified: [], deleted: wantDeleted }),
        delCommit?.changes,
      )
    } else {
      // Order Y with a survivor: the list stays, so A's commit only deletes the to-dos nobody else touched.
      const left = { '2': ['b', 'c', 'd'], '2c': ['b', 'c', 'd'], '4': ['a', 'b', 'c', 'd'], '5': ['a', 'b', 'c', 'd'] }[S.row]
      const wantDeleted = left.map((k) => pathOf(T[k])).sort()
      check(`${tag}: A's commit deletes only the to-dos nobody else changed, and keeps home/_list.md`, delCommit && same(delCommit.changes, { added: [], modified: [], deleted: wantDeleted }), delCommit?.changes)
      // One "- Delete …" line per to-do, in the app's (path) order.
      const lines = left.map((k) => `- Delete “${T[k].title}”`).sort()
      const [head, blank, ...rest] = (delCommit?.message ?? '').split('\n')
      check(
        `${tag}: A's commit message is "${left.length} changes" with one "- Delete …" line per deleted to-do`,
        head === `${left.length} changes` && blank === '' && same([...rest].sort(), lines),
        { got: delCommit?.message, wantLines: lines },
      )
    }
    if (order === 'X' && S.banner) {
      const bc = commits.find((c) => c.by === 'B')
      info(`B's commit reviving the list: ${JSON.stringify(bc?.message)}`)
      check(`${tag}: B's commit writes home/_list.md back`, bc?.changes.added.includes('home/_list.md'), bc?.changes)
    }

    // ---- end state ----
    const { a: aEnd, b: bEnd, files } = await invariants(h, tag, A, B)
    const wantTodos = byId(S.todos(ctx))
    check(`${tag}: the to-dos are as expected on A`, same(byId((await A.snapshot()).todos), wantTodos), { got: (await A.snapshot()).todos, want: wantTodos })
    const lists = (await A.snapshot()).lists
    check(`${tag}: the lists are ${S.lists.join(', ')}`, same(lists.map((l) => l.id).sort(), [...S.lists].sort()), lists)
    if (S.lists.includes('home')) {
      check(`${tag}: Home stuff survives with its seeded name, number and ink`, same(lists.find((l) => l.id === 'home'), HOME_LIST), lists.find((l) => l.id === 'home'))
      check(`${tag}: home/_list.md is byte-identical to the seed`, files['home/_list.md'] === SEED['home/_list.md'], files['home/_list.md'])
    } else {
      check(`${tag}: nothing is left in the home folder`, !Object.keys(files).some((p) => p.startsWith('home/')), Object.keys(files))
    }

    // Expected repo: the seed, minus home's data, plus the survivors, plus the scenario's work changes.
    const want = { ...SEED }
    for (const p of Object.keys(SEED)) if (p.startsWith('home/')) delete want[p]
    if (S.lists.includes('home')) want['home/_list.md'] = SEED['home/_list.md']
    const full = new Map(aEnd.todos.map((t) => [t.id, t]))
    for (const k of S.keepTodos ?? []) {
      const id = typeof k.id === 'function' ? k.id(ctx) : k.id
      want[k.path] = full.has(id) ? todoFile(full.get(id)) : '(missing on device)'
    }
    for (const k of S.workAdds ?? []) want[k.path] = full.has(k.id) ? todoFile(full.get(k.id)) : '(missing on device)'
    for (const p of S.workRemoves ?? []) delete want[p]
    const diff = [...new Set([...Object.keys(want), ...Object.keys(files)])].filter((p) => want[p] !== files[p]).map((p) => ({ path: p, want: want[p] ?? '(absent)', got: files[p] ?? '(absent)' }))
    check(`${tag}: the repo is exactly as expected (inbox and work untouched except as the scenario says)`, diff.length === 0, diff)

    // ---- banners ----
    const aBanner = aEnd.conflict
    const bBanner = bEnd.conflict
    if (!S.banner) {
      check(`${tag}: no banner on either device`, !aBanner && !bBanner, { a: aBanner, b: bBanner })
    } else if (!late) {
      check(`${tag}: B shows the "revived" banner on home/`, same(bBanner, { path: 'home/', message: S.banner.revived }), { got: bBanner, want: S.banner.revived })
      check(`${tag}: A shows no banner`, !aBanner, aBanner)
    } else {
      check(`${tag}: A shows the "kept" banner on home/`, same(aBanner, { path: 'home/', message: S.banner.kept }), { got: aBanner, want: S.banner.kept })
      check(`${tag}: B shows no banner`, !bBanner, bBanner)
    }
  } finally {
    await A.close()
    await B.close()
  }
}

// ---- main ---------------------------------------------------------------------------------------

let h
let failed = false
try {
  section('start')
  h = await startHarness()
  console.log(`      started mock, dev server and Chrome in ${since()}`)
  for (const S of ROWS) {
    for (const order of S.hold ? ['X', 'Y', 'H'] : ['X', 'Y']) {
      if (only && !only.has(`${S.row}${order}`.toUpperCase())) continue
      try {
        await run(h, S, order)
      } catch (e) {
        failed = true
        check(`${S.row}${order}: the scenario ran to the end`, false, String(e.stack ?? e))
      }
    }
  }
} catch (e) {
  failed = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${bad.length || failed ? 'FAILED' : 'PASSED'}: ${results.length - bad.length}/${results.length} checks passed in ${since()}`)
if (bad.length) console.log(`failed:\n  ${bad.map((r) => r.name).join('\n  ')}`)
process.exit(bad.length || failed ? 1 : 0)
