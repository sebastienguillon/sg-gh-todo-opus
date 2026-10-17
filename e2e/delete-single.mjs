#!/usr/bin/env node
// List delete: single-device behaviour (and two-device where stated), through the app's real sync code.
//   MOCK_PORT=5331 APP_PORT=5330 node delete-single.mjs        (ONLY=a,b,... to run some scenarios)
// Prints PASS/FAIL per check and exits non-zero on any failure.

import { deepStrictEqual } from 'node:assert'
import { listFile, sleep, slugify, startHarness, todoFile } from './harness.mjs'
import { blobSha } from './mock-github.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null

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
  results.push({ name: `${current} ${name}`, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${current}] ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}
const info = (text) => console.log(`      info: ${text}`)
const model = (snap) => ({ lists: snap.lists, todos: snap.todos })

async function waitUntil(what, fn, { timeout = 30_000, every = 150 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await sleep(every)
  }
}

// ---- seed ---------------------------------------------------------------------------------------

const T = {
  bank: { id: 't-bank0001', listId: 'inbox', title: 'Call the bank', order: 1 },
  tap: { id: 't-tap00001', listId: 'home', title: 'Fix the tap', order: 1, tags: ['diy'] },
  fence: { id: 't-fence001', listId: 'home', title: 'Paint the fence', order: 2, due: '2026-11-02', note: 'White, two coats.' },
  plant: { id: 't-plant001', listId: 'home', title: 'Water plants', order: 3 },
  bulbs: { id: 't-bulbs001', listId: 'home', title: 'Buy bulbs', order: 4, done: true, doneAt: '2026-10-03T10:00:00.000Z', updatedAt: '2026-10-03T10:00:00.000Z' },
  report: { id: 't-report01', listId: 'work', title: 'Send the report', order: 1 },
}
const HOME_TODOS = ['home/fix-the-tap.md', 'home/paint-the-fence.md', 'home/water-plants.md', 'home/buy-bulbs.md']
const SEED = {
  'README.md': '# To Do data\n\nTest repo.\n',
  'inbox/_list.md': listFile({ index: 1, name: 'In tray', ink: 1 }),
  'inbox/call-the-bank.md': todoFile(T.bank),
  'home/_list.md': listFile({ index: 2, name: 'Home stuff', ink: 5 }),
  'home/fix-the-tap.md': todoFile(T.tap),
  'home/paint-the-fence.md': todoFile(T.fence),
  'home/water-plants.md': todoFile(T.plant),
  'home/buy-bulbs.md': todoFile(T.bulbs),
  'home/README.md': '# Home\n\nNotes about the home list, kept by hand.\n',
  'home/photo.png': '\u0089PNG fake image bytes for the test\n',
  'work/_list.md': listFile({ index: 3, name: 'Work things', ink: 9 }),
  'work/send-the-report.md': todoFile(T.report),
}
const DELETE_MSG = 'Delete list “Home stuff” and its 4 to-dos'

// Copies of the app's rules, for the invariants.
const isDataPath = (p) => /^[^/._][^/]*\/[^/]+\.md$/.test(p) && !/\/readme\.md$/i.test(p)
const unslug = (folder) => {
  const w = folder.replace(/[-_]+/g, ' ').trim()
  return w ? w[0].toUpperCase() + w.slice(1) : 'Untitled'
}

// ---- helpers ------------------------------------------------------------------------------------

let h
let devices = []
let freshN = 0

async function open(name) {
  const d = await h.device(name)
  devices.push(d)
  return d
}

async function begin(id, title, seed = SEED) {
  current = id
  console.log(`\n== (${id}) ${title}  [${since()}]`)
  for (const d of devices) await d.close()
  devices = []
  await h.reset(seed)
  return (await h.commits()).at(-1)
}

/** One read cycle, without waiting for pending changes to go (a held delete keeps them). */
async function pull(d) {
  const before = await d.page.evaluate(() => window.__e2e.cycles)
  await waitUntil(`${d.name} to start a read`, () =>
    d.page.evaluate(() => {
      const e = window.__e2e
      const b = e.refStarted
      e.store.remote.check()
      return e.refStarted > b
    }),
  )
  await waitUntil(`${d.name} to finish a read`, async () => {
    const st = await d.state()
    return st.cycles > before && st.inflight === 0
  })
  return d.snapshot()
}

/** Global invariants, on the repo, every device in the scenario and a fresh device reading the repo. */
async function invariants({ seededFolderNames = [], allowConflict = false } = {}) {
  for (const d of devices) await d.sync()
  for (const d of devices) await d.sync()
  const F = await h.device(`F${++freshN}`)
  const all = [...devices, F]
  const snaps = []
  for (const d of all) snaps.push({ name: d.name, snap: await d.snapshot({ full: true }) })
  const [first, ...rest] = snaps
  for (const s of rest) check(`invariant: ${s.name} converges with ${first.name} (every field)`, same(model(s.snap), model(first.snap)), { [first.name]: model(first.snap), [s.name]: model(s.snap) })
  for (const s of snaps) {
    check(`invariant: ${s.name} has nothing pending`, s.snap.pending.length === 0, s.snap.pending)
    check(`invariant: ${s.name} sync is not failed`, s.snap.sync.kind !== 'failed', s.snap.sync)
    if (!allowConflict) check(`invariant: ${s.name} shows no conflict banner`, !s.snap.conflict, { conflict: s.snap.conflict, sync: s.snap.sync })
    const ids = new Set(s.snap.lists.map((l) => l.id))
    check(`invariant: ${s.name} has no duplicate list ids`, ids.size === s.snap.lists.length, s.snap.lists.map((l) => l.id))
    const homeless = s.snap.todos.filter((t) => !ids.has(t.listId))
    check(`invariant: every to-do on ${s.name} is in an existing list`, homeless.length === 0, homeless)
    const orphans = s.snap.lists.filter((l) => l.name === unslug(l.id) && !seededFolderNames.includes(l.id))
    check(`invariant: no list on ${s.name} is named after its folder (an orphan folder)`, orphans.length === 0, orphans)
  }
  const files = await h.repoFiles()
  const folders = new Set(Object.keys(files).filter(isDataPath).map((p) => p.slice(0, p.indexOf('/'))))
  const bare = [...folders].filter((f) => !(`${f}/_list.md` in files))
  check('invariant: no repo folder holds a data .md without its _list.md', bare.length === 0, { bare, files: Object.keys(files) })
  const warnings = await h.warnings()
  check('invariant: no mock warnings (no delete of a path missing from the base)', warnings.length === 0, warnings)
  const errs = all.flatMap((d) => d.errors.map((e) => `${d.name} ${e}`))
  const pageErrors = errs.filter((e) => /pageerror/.test(e))
  check('invariant: no uncaught page errors', pageErrors.length === 0, pageErrors)
  const consoleErrors = errs.filter((e) => /console\.error/.test(e) && !/Failed to load resource/.test(e))
  check('invariant: no console errors other than 4xx resource noise', consoleErrors.length === 0, consoleErrors)
  const other = errs.filter((e) => !pageErrors.includes(e) && !consoleErrors.includes(e))
  if (other.length) info(`other console output:\n        ${other.join('\n        ')}`)
  check('invariant: nothing tried to reach api.github.com', h.realGitHubHits.length === 0, h.realGitHubHits)
  await F.close()
  return { files, snaps }
}

const without = (files, paths) => Object.fromEntries(Object.entries(files).filter(([p]) => !paths.includes(p)))

async function scenario(id, title, fn) {
  if (ONLY && !ONLY.has(id)) return
  try {
    await fn(await begin(id, title))
  } catch (e) {
    check(`the scenario ran to the end`, false, e.stack ?? String(e))
  }
}

// ---- scenarios ----------------------------------------------------------------------------------

h = await startHarness()
try {
  await scenario('a', 'delete, then undo inside the toast: no commit at all', async () => {
    const A = await open('A')
    const before = await A.snapshot({ full: true })
    const n0 = (await h.commits()).length
    const r = await A.store((s) => {
      const ok = s.deleteList('home')
      return { ok, hold: s.toast?.holdUntil ? s.toast.holdUntil - Date.now() : null, toast: s.toast?.message, pending: s.pending.map((c) => [c.kind, c.id, c.path]), lists: s.lists.map((l) => l.id), todos: s.todos.length }
    })
    check('deleteList returns true', r.ok === true, r)
    check('the toast holds the commit for about 30 s', r.hold > 29_000 && r.hold <= 30_000, r.hold)
    check('the list and its 4 to-dos are gone on the device', !r.lists.includes('home') && r.todos === 2, r)
    check('pending: one removed per to-do (open and done) and a list change for home/_list.md', same(r.pending.map((p) => p.join(' ')).sort(), ['list home home/_list.md', ...Object.values(T).filter((t) => t.listId === 'home').map((t) => `removed ${t.id} home/${slugify(t.title)}.md`)].sort()), r.pending)
    info(`toast: ${r.toast}`)
    await sleep(1500)
    check('no commit while the toast is up', (await h.commits()).length === n0)
    const u = await A.store((s) => ({ target: s.undo(), toast: s.toast, pending: s.pending.length }))
    check('undo restores the list (returns its id) and the toast goes', same(u.target, { list: 'home' }) && u.toast === null, u)
    await sleep(50)
    info(`announcement: ${await A.store((s) => s.announcement)}`)
    const after = await A.sync()
    const full = await A.snapshot({ full: true })
    check('no new commit at all after undo and a sync', (await h.commits()).length === n0, (await h.commits()).map((c) => c.message))
    check('list and to-dos are back, every field identical', same(model(full), model(before)), { before: model(before), after: model(full) })
    check('nothing pending', after.pending.length === 0, after.pending)
    check('the repo is the seed', same(await h.repoFiles(), SEED))
    await invariants()
  })

  await scenario('b', 'delete, then dismiss the toast: one commit; a second device sees the list gone', async (seed) => {
    const A = await open('A')
    const B = await open('B')
    await A.store((s) => s.deleteList('home'))
    await A.store((s) => s.dismissToast())
    await A.sync()
    const commits = await h.commits()
    check('exactly one new commit', commits.length === 2, commits.map((c) => c.message))
    const c = commits.at(-1)
    check(`its message is "${DELETE_MSG}"`, c.message === DELETE_MSG, c.message)
    check('it deletes _list.md and the 4 to-do files, nothing else', same(c.changes, { added: [], modified: [], deleted: [...HOME_TODOS, 'home/_list.md'].sort() }), c.changes)
    const files = await h.repoFiles()
    check('home/README.md and home/photo.png are still there, unchanged', files['home/README.md'] === SEED['home/README.md'] && files['home/photo.png'] === SEED['home/photo.png'], Object.keys(files))
    check('the repo is the seed minus the list', same(files, without(SEED, [...HOME_TODOS, 'home/_list.md'])), Object.keys(files))
    const b = await B.sync()
    check('B sees the list gone, with its to-dos', !b.lists.some((l) => l.id === 'home') && !b.todos.some((t) => t.listId === 'home'), b)
    check('B has no conflict banner', !b.conflict, { conflict: b.conflict, sync: b.sync })
    await invariants()
  })

  await scenario('c', 'hold cap: a paused toast still commits 30 s after the delete; undo then puts every file back byte-identical', async (seedCommit) => {
    const A = await open('A')
    const at = await A.store((s) => {
      s.deleteList('home')
      s.pauseToast(true)
      return Date.now()
    })
    const n0 = (await h.commits()).length
    let landed = null
    let toastUp = null
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline) {
      if ((await h.commits()).length > n0) {
        landed = (await A.store(() => Date.now())) - at
        toastUp = await A.store((s) => !!s.toast?.undo)
        break
      }
      await sleep(250)
    }
    check('the delete commits while the toast is still paused', landed !== null && toastUp === true, { landed, toastUp })
    check('...about 30 s after the delete, not before', landed !== null && landed >= 29_500 && landed <= 34_000, landed)
    await A.waitSaved()
    const del = (await h.commits()).at(-1)
    check('the commit is the delete', del.message === DELETE_MSG, del.message)
    const u = await A.store((s) => ({ target: s.undo(), pending: s.pending.map((c) => [c.kind, c.id]) }))
    check('undo after the commit restores the list', same(u.target, { list: 'home' }), u)
    await sleep(50)
    info(`announcement: ${await A.store((s) => s.announcement)}`)
    await A.sync()
    const commits = await h.commits()
    check('a second commit puts the list back', commits.length === n0 + 2, commits.map((c) => c.message))
    const back = commits.at(-1)
    info(`restore commit message: ${JSON.stringify(back.message)}`)
    check('it adds _list.md and the 4 to-dos, nothing else', same(back.changes, { added: [...HOME_TODOS, 'home/_list.md'].sort(), modified: [], deleted: [] }), back.changes)
    const files = await h.repoFiles()
    const diff = Object.keys({ ...files, ...SEED }).filter((p) => files[p] !== SEED[p])
    check('every file is byte-identical to the seed', diff.length === 0, diff.map((p) => ({ p, got: files[p], want: SEED[p] })))
    const shas = Object.keys(SEED).filter((p) => blobSha(files[p] ?? '') !== blobSha(SEED[p]))
    check('every blob sha matches the seed', shas.length === 0, shas)
    check("the restore commit's root tree is the seed commit's tree", back.tree === seedCommit.tree, { back: back.tree, seed: seedCommit.tree })
    await invariants()
  })

  await scenario('d', 'delete, then reload at once: the delete still commits after the reload', async () => {
    const A = await open('A')
    await A.store((s) => s.deleteList('home'))
    const stored = await A.storage()
    check('the pending delete is in localStorage at once', stored.repo?.pending?.length === 5 && !stored.repo.lists.some((l) => l.id === 'home'), stored.repo?.pending)
    check('no commit before the reload', (await h.commits()).length === 1)
    const r = await A.reload()
    check('after the reload the list is still gone', !r.lists.some((l) => l.id === 'home'), r.lists)
    await A.sync()
    const commits = await h.commits()
    check('one commit after the reload, the delete', commits.length === 2 && commits.at(-1).message === DELETE_MSG, commits.map((c) => c.message))
    check('it removed the list files', same(commits.at(-1).changes.deleted, [...HOME_TODOS, 'home/_list.md'].sort()), commits.at(-1).changes)
    await invariants()
  })

  await scenario('e', 'an uncommitted rename, then delete: one commit that deletes, no rename write', async () => {
    const A = await open('A')
    const r = await A.store((s) => {
      const renamed = s.renameList('home', 'Household')
      const deleted = s.deleteList('home')
      return { renamed, deleted, pending: s.pending.map((c) => [c.kind, c.id, c.path, c.title]) }
    })
    check('rename then delete both go through', r.renamed && r.deleted, r)
    check('one list change pending for home', r.pending.filter((p) => p[0] === 'list').length === 1, r.pending)
    await A.store((s) => s.dismissToast())
    await A.sync()
    const commits = await h.commits()
    check('exactly one new commit', commits.length === 2, commits.map((c) => c.message))
    const c = commits.at(-1)
    check('its message is a list delete with the 4 to-dos', /^Delete list “.+” and its 4 to-dos$/.test(c.message), c.message)
    info(`delete message names the list: ${JSON.stringify(c.message)}`)
    check('it only deletes (no _list.md rewrite with the new name)', same(c.changes, { added: [], modified: [], deleted: [...HOME_TODOS, 'home/_list.md'].sort() }), c.changes)
    check('no commit wrote home/_list.md (the rename never reached GitHub)', !(await h.commits()).slice(1).some((x) => x.changes.added.includes('home/_list.md') || x.changes.modified.includes('home/_list.md') || /^Save list|^Rename/.test(x.message)), (await h.commits()).map((x) => [x.message, x.changes]))
    await invariants()
  })

  await scenario('f', 'a list created and deleted before it ever synced: no commit at all', async () => {
    const A = await open('A')
    const r = await A.store((s) => {
      const l = s.addList('Garden')
      const t = s.add('Rake the leaves', l.id)
      const deleted = s.deleteList(l.id)
      return { l, t: t?.listId, deleted, pending: s.pending.map((c) => [c.kind, c.id, c.path]) }
    })
    check('the new list (with a to-do) is deleted', r.deleted && r.t === r.l.id, r)
    info(`pending after create+delete: ${JSON.stringify(r.pending)}`)
    await A.store((s) => s.dismissToast())
    await A.sync()
    check('no commit at all', (await h.commits()).length === 1, (await h.commits()).map((c) => c.message))
    check('the repo is the seed', same(await h.repoFiles(), SEED))
    await invariants()
  })

  await scenario('g', 'delete while another commit is in flight (ref update held): two commits, clean end', async () => {
    const A = await open('A')
    await h.fault({ endpoint: 'patchRef', device: 'A', hold: true, times: 1 })
    await A.toggle('t-report01')
    await A.store((s) => s.remote.check())
    await h.waitHeld({ endpoint: 'patchRef', device: 'A' })
    const r = await A.store((s) => ({ ok: s.deleteList('home'), sealed: s.sealed, pending: s.pending.map((c) => [c.kind, c.id, c.seq]) }))
    check('the delete is recorded while the commit is in flight', r.ok, r)
    await A.store((s) => s.dismissToast())
    await h.release({ endpoint: 'patchRef', device: 'A' })
    await A.sync({ timeout: 90_000 })
    const commits = await h.commits()
    check('two new commits', commits.length === 3, commits.map((c) => c.message))
    check('the first is the check-off, only work/send-the-report.md', commits[1]?.message === 'Check off “Send the report”' && same(commits[1]?.changed, ['work/send-the-report.md']), commits[1])
    check('the second is the delete', commits[2]?.message === DELETE_MSG && same(commits[2]?.changes.deleted, [...HOME_TODOS, 'home/_list.md'].sort()) && commits[2]?.changes.added.length === 0 && commits[2]?.changes.modified.length === 0, commits[2])
    const files = await h.repoFiles()
    check('the report is checked off in the repo', /\ndone: true\n/.test(files['work/send-the-report.md'] ?? ''), files['work/send-the-report.md'])
    await invariants()
  })

  // (h) uses its own seed: a stale hand copy of the report in home/.
  if (!ONLY || ONLY.has('h'))
    try {
      const report = { ...T.report, updatedAt: '2026-10-05T09:00:00.000Z' }
      const stale = { ...T.report, title: 'Send the report (old copy)', updatedAt: '2026-10-01T09:00:00.000Z' }
      const seed = { ...SEED, 'work/send-the-report.md': todoFile(report), 'home/x.md': todoFile(stale) }
      await begin('h', 'a stale hand copy in the deleted folder is swept; the newer copy elsewhere survives', seed)
      const A = await open('A')
      const a = await A.snapshot({ full: true })
      const r = a.todos.find((t) => t.id === 't-report01')
      check('the device reads the newer copy, in work', r?.listId === 'work' && r?.title === 'Send the report', r)
      check('home shows 4 to-dos', a.todos.filter((t) => t.listId === 'home').length === 4)
      await A.store((s) => s.deleteList('home'))
      await A.store((s) => s.dismissToast())
      await A.sync()
      const c = (await h.commits()).at(-1)
      info(`message: ${JSON.stringify(c.message)}`)
      check('the message counts the 5 to-do files deleted in the folder', c.message === 'Delete list “Home stuff” and its 5 to-dos', c.message)
      check('the commit deletes home/x.md too, and nothing outside home/', same(c.changes, { added: [], modified: [], deleted: [...HOME_TODOS, 'home/_list.md', 'home/x.md'].sort() }), c.changes)
      const files = await h.repoFiles()
      check('the work copy survives unchanged', files['work/send-the-report.md'] === seed['work/send-the-report.md'], files['work/send-the-report.md'])
      check('no data file is left in home/', !Object.keys(files).some((p) => p.startsWith('home/') && isDataPath(p)), Object.keys(files))
      const after = await A.snapshot()
      check('the device still has the report, in work', after.todos.some((t) => t.id === 't-report01' && t.listId === 'work'), after.todos)
      await invariants()
    } catch (e) {
      check('the scenario ran to the end', false, e.stack ?? String(e))
    }

  await scenario('i', 'delete Home, add a list "Home" while the undo is on offer (folder home-2, not home), then undo', async () => {
    const A = await open('A')
    // The seeded list is folder home, named "Home stuff"; a new list "Home" would slug to home.
    const r = await A.store((s) => {
      s.deleteList('home')
      const l = s.addList('Home')
      return { l: { ...l }, toast: !!s.toast?.undo }
    })
    check('the new list takes folder home-2, not home', r.l.id === 'home-2' && r.l.slug === 'home-2', r.l)
    check('the delete toast is still on offer', r.toast, r)
    const u = await A.store((s) => ({ target: s.undo(), lists: s.lists.map((l) => ({ ...l })) }))
    await sleep(300)
    const ids = u.lists.map((l) => l.id)
    check('undo restores home; home-2 stays; no duplicate ids', same(u.target, { list: 'home' }) && ids.includes('home') && ids.includes('home-2') && new Set(ids).size === ids.length, u)
    const dup = A.errors.filter((e) => /each_key_duplicate/.test(e))
    check('no Svelte each_key_duplicate error in the console', dup.length === 0, dup)
    await A.sync()
    const commits = await h.commits()
    info(`commits: ${JSON.stringify(commits.slice(1).map((c) => c.message))}`)
    const files = await h.repoFiles()
    check('home/ is untouched in the repo', Object.keys(SEED).filter((p) => p.startsWith('home/')).every((p) => files[p] === SEED[p]))
    check('home-2/_list.md is written, named Home', /\nname: Home\n/.test(files['home-2/_list.md'] ?? ''), files['home-2/_list.md'])
    check('the only change on GitHub is home-2/_list.md', commits.slice(1).flatMap((c) => c.changed).join() === 'home-2/_list.md', commits.slice(1).map((c) => c.changes))
    await invariants()
    const dup2 = A.errors.filter((e) => /each_key_duplicate/.test(e))
    check('still no each_key_duplicate after the sync', dup2.length === 0, dup2)
  })

  await scenario('j', 'B deletes a to-do of the list during the undo window; A pulls, undoes: it stays deleted', async () => {
    const A = await open('A')
    const B = await open('B')
    await A.store((s) => {
      s.deleteList('home')
      s.pauseToast(true)
    })
    await B.remove('t-fence001')
    await B.sync()
    check('B committed the to-do delete', (await h.commits()).at(-1).message === 'Delete “Paint the fence”', (await h.commits()).at(-1).message)
    const n0 = (await h.commits()).length
    const a = await pull(A)
    check('A pulled B\'s commit during the hold', a.head === (await h.commits()).at(-1).sha, { head: a.head })
    check('the pull settles the removed change of the to-do deleted on both devices', !a.pending.some((c) => c.id === 't-fence001'), a.pending)
    check('A did not commit during the hold', (await h.commits()).length === n0)
    const u = await A.store((s) => ({ target: s.undo(), todos: s.todos.filter((t) => t.listId === 'home').map((t) => t.id).sort() }))
    await sleep(50)
    const ann = await A.store((s) => s.announcement)
    info(`announcement: ${ann}`)
    check('undo restores the list with the 3 others', same(u.todos, ['t-bulbs001', 't-plant001', 't-tap00001']), u)
    check('the announcement says "1 was deleted on another device"', /1 was deleted on another device/.test(ann), ann)
    await A.sync()
    info(`commits: ${JSON.stringify((await h.commits()).slice(n0).map((c) => c.message))}`)
    check('A makes no commit for the undo (nothing differs from GitHub)', (await h.commits()).length === n0, (await h.commits()).slice(n0).map((c) => [c.message, c.changes]))
    const { snaps } = await invariants()
    check('Paint the fence stays deleted everywhere', snaps.every((s) => !s.snap.todos.some((t) => t.id === 't-fence001')))
    check('Home is back everywhere with 3 to-dos', snaps.every((s) => s.snap.todos.filter((t) => t.listId === 'home').length === 3))
  })

  await scenario('j2', 'probe for (j): the same with a single to-do delete (store.remove) on both devices, then undo', async () => {
    const A = await open('A')
    const B = await open('B')
    // A deletes first, offline so it can't commit; B deletes the same to-do since, and syncs.
    await A.offline(true)
    await A.store((s) => {
      s.remove('t-fence001')
      s.pauseToast(true)
    })
    await B.remove('t-fence001')
    await B.sync()
    const n0 = (await h.commits()).length
    await A.offline(false)
    const a = await A.sync()
    check('A settles its delete against B\'s (no commit)', a.pending.length === 0 && (await h.commits()).length === n0, { pending: a.pending, commits: (await h.commits()).slice(n0).map((c) => c.message) })
    const u = await A.store((s) => ({ target: s.undo(), back: !!s.todos.find((t) => t.id === 't-fence001') }))
    check('undo does not bring back a to-do deleted on another device too', u.back === false, u)
    await A.sync()
    check('no commit writes it back', (await h.commits()).length === n0, (await h.commits()).slice(n0).map((c) => [c.message, c.changes]))
    await invariants()
  })

  await scenario('k', 'B renames the list during the undo window; A pulls, undoes: the restored list carries B\'s name', async () => {
    const A = await open('A')
    const B = await open('B')
    await A.store((s) => {
      s.deleteList('home')
      s.pauseToast(true)
    })
    await B.store((s) => s.renameList('home', 'House chores'))
    await B.sync()
    const n0 = (await h.commits()).length
    check('B committed the rename', /House chores/.test((await h.commits()).at(-1).message), (await h.commits()).at(-1).message)
    await pull(A)
    const u = await A.store((s) => ({ target: s.undo(), list: { ...s.lists.find((l) => l.id === 'home') } }))
    await sleep(50)
    info(`announcement: ${await A.store((s) => s.announcement)}`)
    check("the restored list is named B's name, keeps number 02 and ink 5", u.list.name === 'House chores' && u.list.index === 2 && u.list.ink === 5, u.list)
    await A.sync()
    check('A makes no commit for the undo', (await h.commits()).length === n0, (await h.commits()).slice(n0).map((c) => [c.message, c.changes]))
    const { snaps, files } = await invariants()
    check('everyone sees "House chores" with its 4 to-dos', snaps.every((s) => s.snap.lists.find((l) => l.id === 'home')?.name === 'House chores' && s.snap.todos.filter((t) => t.listId === 'home').length === 4))
    check('home/_list.md says House chores', files['home/_list.md'] === listFile({ index: 2, name: 'House chores', ink: 5 }), files['home/_list.md'])
  })

  await scenario('l', 'number reuse: delete the highest list, add a list (takes its number), undo: the restored list takes the next number', async () => {
    const A = await open('A')
    const r = await A.store((s) => {
      s.deleteList('work')
      const l = s.addList('Errands & bits')
      return { ...l }
    })
    check('the new list takes number 03', r.index === 3, r)
    const u = await A.store((s) => ({ target: s.undo(), list: { ...s.lists.find((l) => l.id === 'work') } }))
    await sleep(50)
    const ann = await A.store((s) => s.announcement)
    info(`announcement: ${ann}`)
    check('the restored list takes 04', u.list.index === 4 && u.list.name === 'Work things', u.list)
    check('the announcement says "as 04"', /Restored list Work things as 04/.test(ann), ann)
    await A.sync()
    const files = await h.repoFiles()
    info(`commits: ${JSON.stringify((await h.commits()).slice(1).map((c) => c.message))}`)
    check('work/_list.md now says index 4, same name', /\nindex: 4\n/.test(files['work/_list.md'] ?? '') && /\nname: Work things\n/.test(files['work/_list.md'] ?? ''), files['work/_list.md'])
    check('errands-and-bits/_list.md says index 3', /\nindex: 3\n/.test(files['errands-and-bits/_list.md'] ?? ''), files['errands-and-bits/_list.md'])
    check('the work to-do file is unchanged', files['work/send-the-report.md'] === SEED['work/send-the-report.md'])
    const { snaps } = await invariants()
    const indexes = snaps[0].snap.lists.map((l) => l.index)
    check('no two lists share a number', new Set(indexes).size === indexes.length, snaps[0].snap.lists)
  })

  if (!ONLY || ONLY.has('m'))
    try {
      const one = { 'inbox/_list.md': listFile({ index: 1, name: 'In tray', ink: 1 }), 'inbox/call-the-bank.md': todoFile(T.bank) }
      await begin('m', 'the only list cannot be deleted', one)
      const A = await open('A')
      const r = await A.store((s) => ({
        ok: s.deleteList('inbox'),
        missing: s.deleteList('no-such-list'),
        pending: s.pending.length,
        toast: s.toast,
        lists: s.lists.length,
        todos: s.todos.length,
      }))
      check('deleteList returns false for the only list', r.ok === false, r)
      check('deleteList returns false for an unknown id', r.missing === false, r)
      check('nothing recorded: no pending, no toast, list and to-do still there', r.pending === 0 && r.toast === null && r.lists === 1 && r.todos === 1, r)
      await A.sync()
      check('no commit', (await h.commits()).length === 1)
      await invariants()
    } catch (e) {
      check('the scenario ran to the end', false, e.stack ?? String(e))
    }

  await scenario('n', 'the commit hold: no write request for 12 s while reads go on; dismiss, then the commit', async () => {
    const A = await open('A')
    const n0 = (await h.state()).requests
    await A.store((s) => {
      s.deleteList('home')
      s.pauseToast(true)
    })
    const start = Date.now()
    while (Date.now() - start < 12_000) {
      await pull(A)
      await sleep(2000)
    }
    const reqs = (await h.requests(n0)).filter((r) => r.device === 'A')
    const count = (e) => reqs.filter((r) => r.endpoint === e).length
    const writes = { createTree: count('createTree'), createCommit: count('createCommit'), patchRef: count('patchRef') }
    check('no createTree / createCommit / patchRef for 12 s', writes.createTree + writes.createCommit + writes.patchRef === 0, writes)
    check('reads (getRef) went on meanwhile', count('getRef') >= 3, { getRef: count('getRef'), all: reqs.map((r) => `${r.endpoint} ${r.status}`) })
    check('the toast is still up and nothing committed', (await A.store((s) => !!s.toast?.undo)) && (await h.commits()).length === 1)
    const t = Date.now()
    await A.store((s) => s.dismissToast())
    await waitUntil('the delete commit', async () => (await h.commits()).length === 2, { timeout: 15_000 })
    const took = Date.now() - t
    check('dismissing lets the commit go within a few seconds', took < 6000, took)
    check('the commit is the delete', (await h.commits()).at(-1).message === DELETE_MSG, (await h.commits()).at(-1).message)
    await invariants()
  })
} catch (e) {
  check('the run stopped', false, e.stack ?? String(e))
} finally {
  for (const d of devices) await d.close().catch(() => {})
  await h?.stop()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${bad.length ? 'FAILED' : 'PASSED'}: ${results.length - bad.length}/${results.length} checks passed in ${since()}`)
if (bad.length) console.log(bad.map((r) => `  - ${r.name}`).join('\n'))
process.exit(bad.length ? 1 : 0)
