#!/usr/bin/env node
// Stale branch reads (sync fix 4, shipped with fix 3, the ETag tied to the head held).
//
// A lagging GitHub replica answers a branch read with a head this device has already moved past
// (simulated with the mock's `lag` fault on getRef). The device must take that read for no news,
// once: no visible revert, no lost reopen or delete, no false "deleted" banner, no tree or file
// reads, and the ETag it holds stays the head's. A head it never held (S8), or the first read after
// a reload (S8b), may be taken in, but the device must be back on the real head within 2 reads, and
// an edit made meanwhile must cost at most 1 refused ref update, 1 commit, and never show failed.
//
//   S1   another device's edit, then a read one commit behind
//   S2   a reopen, with the commit cycle's read one commit behind
//   S3   a delete, with the commit cycle's read one commit behind
//   S4   the device's own commit, then a read one commit behind
//   S4b  a pulled hand edit and an own commit, then a read two commits behind
//   S5   the commit retry loop: a 422, then a re-read two commits behind
//   S6   a list made elsewhere, then a read from before it existed
//   S7   (optional, about 75 s) a read stuck one commit behind for over a minute
//   S8   a head A never held: B commits H2, then H3 10 s later; A pulls H3; one read lags by 1
//   S8b  A commits, reloads, then the first read lags by 2
//   In S8 and S8b the edit touches no field the lagging read put back. A title edit of a to-do it
//   reverted is a true three-way conflict against the older base A took in: a conflict banner, a gap
//   the plan leaves open (heads never held, the first read after a reload).
//   then the run's invariants: nothing reached api.github.com, the only console errors are the
//   expected 422s (one per refused ref update), no unhandled mock route.
//
// Run from this folder, always against an app copy:
//   APP_DIR=/path/to/app APP_PORT=5640 MOCK_PORT=5641 node stale.mjs      about 85 s
//   ... node stale.mjs S1 S8b      only these scenarios
//   STALE_S7=1 ... node stale.mjs  adds S7 (about 65 s more)
//   HEADED=1 / VERBOSE=1           as for smoke.mjs
// Prints PASS/FAIL per check and exits 1 on any failure.

import { listFile, sleep, startHarness, todoFile } from './harness.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}

function section(title) {
  console.log(`\n== ${title}  [${since()}]`)
}

const info = (text) => console.log(`      info: ${text}`)

const SEED = {
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank', order: 1 }),
  'inbox/buy-stamps.md': todoFile({ id: 't-stamps01', title: 'Buy stamps', order: 2 }),
}
const HAND = { updatedAt: '2026-10-02T09:00:00.000Z' }

const only = process.argv.slice(2)
const wanted = (key) => (only.length ? only.includes(key) : key !== 'S7' || !!process.env.STALE_S7)

const titleOf = (snap, id) => snap.todos.find((x) => x.id === id)?.title
const doneOf = (snap, id) => snap.todos.find((x) => x.id === id)?.done
const short = (s) => (s ? s.slice(0, 7) : String(s))

/** Every to-do file in the repo, by to-do id: [{path, title, done}]. A title edit renames the file, so scan them all. */
function repoTodos(files) {
  const out = {}
  for (const [path, text] of Object.entries(files)) {
    const id = /^id: (.*)$/m.exec(text)?.[1]
    if (!id || path.endsWith('/_list.md')) continue
    ;(out[id] ??= []).push({ path, title: /^title: (.*)$/m.exec(text)?.[1], done: /^done: true$/m.test(text) })
  }
  return out
}
/** The one title the repo holds for a to-do, or a description of what's wrong. */
function repoTitle(files, id) {
  const all = repoTodos(files)[id] ?? []
  return all.length === 1 ? all[0].title : `(${all.length} files: ${all.map((f) => f.path).join(', ')})`
}
/** {title, done} of the one file the repo holds for a to-do, or null. */
function repoTodo(files, id) {
  const all = repoTodos(files)[id] ?? []
  return all.length === 1 ? { title: all[0].title, done: all[0].done } : null
}

let h
let devs = []
let scenario = ''
// Across scenarios (each reset clears the mock's counters and log): console output and mock answers.
const seen = { errors: [], status: {}, total: {}, warnings: 0 }

async function closeAll() {
  if (h) {
    const c = await h.counters()
    for (const [k, v] of Object.entries(c.status)) seen.status[k] = (seen.status[k] ?? 0) + v
    for (const [k, v] of Object.entries(c.total)) seen.total[k] = (seen.total[k] ?? 0) + v
    seen.warnings += (await h.warnings()).length
  }
  for (const d of devs) {
    seen.errors.push(...d.errors.map((e) => `${d.label}: ${e}`))
    await d.close()
  }
  devs = []
}

async function fresh(names = ['A', 'B'], seed = SEED) {
  await closeAll()
  await h.reset(seed)
  for (const n of names) {
    const d = await h.device(n)
    d.label = `${scenario} ${n}`
    devs.push(d)
  }
  return devs
}

const bookmark = async () => (await h.state()).requests

/** One device's getRef answers since request `n`, as "200 (lagging by 1: abc1234)". */
async function refReads(n, device) {
  return (await h.requests(n)).filter((r) => r.endpoint === 'getRef' && r.device === device).map((r) => `${r.status}${r.note ? ` (${r.note})` : ''}`)
}

/** One branch read: a sync with nothing pending is one cycle. The snapshot after it, and the getRef answers it got. */
async function readOnce(dev) {
  const n = await bookmark()
  const snap = await dev.sync()
  return { snap, reads: await refReads(n, dev.name) }
}

/**
 * The conflict notice on screen, or null. Since sync fix 2 it is `store.conflict`; before, it was a
 * `store.sync` of kind 'conflict'. Read both, so the suite runs on either side of that fix.
 */
const notice = (dev) => dev.store((s) => s.conflict ?? (s.sync.kind === 'conflict' ? s.sync : null))

/**
 * Record every state the device's band shows from now on, polled in the page every 20 ms: the sync
 * kind, plus "+notice" while a conflict notice is up.
 */
async function watchBand(dev) {
  await dev.page.evaluate(() => {
    const e = window.__e2e
    const now = () => {
      const s = e.store
      const up = s.conflict ?? (s.sync.kind === 'conflict' ? s.sync : null)
      return `${s.sync.kind}${up ? '+notice' : ''}`
    }
    clearInterval(e.bandTimer)
    e.bands = [now()]
    e.bandTimer = setInterval(() => {
      const k = now()
      if (e.bands.at(-1) !== k) e.bands.push(k)
    }, 20)
  })
}
const bands = (dev) => dev.page.evaluate(() => window.__e2e.bands ?? [])
const showedFailed = (shown) => shown.some((k) => k.startsWith('failed'))
const showedNotice = (shown) => shown.some((k) => k.includes('conflict') || k.endsWith('+notice'))

/**
 * One read lags (by `lag`), then A edits at once, while the head it was on is behind the branch:
 * at most 1 refused ref update, exactly 1 commit, never a failed band. The edit touches no field the
 * lagging read put back: editing one of those is a true conflict against the older base A took in,
 * which the plan leaves open for heads never held and the first read after a reload.
 */
async function editAfterLag(A, { lag, label, names, act, expect }) {
  await h.fault({ endpoint: 'getRef', device: 'A', lag, times: 1 })
  const r = await readOnce(A)
  info(`the lagging read: ${r.reads.join(', ')}; A then on ${names(r.snap.head)}`)
  const before = (await h.commits()).length
  const n = await bookmark()
  await watchBand(A)
  await act(A)
  const a = await A.sync({ allowFailed: true, timeout: 90_000 })
  const reqs = (await h.requests(n)).filter((x) => x.device === 'A' && x.endpoint !== 'preflight')
  info(`A's requests for the edit: ${reqs.map((x) => `${x.endpoint} ${x.status}${x.note ? ` (${x.note})` : ''}`).join(', ')}`)
  const refused = reqs.filter((x) => x.endpoint === 'patchRef' && x.status === 422).length
  const mine = (await h.commits()).slice(before).filter((c) => c.by === 'A')
  const shown = await bands(A)
  const up = await notice(A)
  check(`${label}: an edit right after costs at most 1 refused ref update (422)`, refused <= 1, { refused })
  check(`${label}: the edit lands in exactly 1 commit`, mine.length === 1, mine.map((c) => c.message))
  check(`${label}: the band never shows failed, and ends saved with no conflict notice`, !showedFailed(shown) && a.sync.kind === 'saved' && !up, { bands: shown, end: a.sync, notice: up })
  const files = await h.repoFiles()
  const repo = Object.fromEntries(Object.keys(expect).map((id) => [id, repoTodo(files, id)]))
  const onA = Object.fromEntries(Object.keys(expect).map((id) => [id, { title: titleOf(a, id), done: doneOf(a, id) }]))
  const head = (await h.state()).head
  const same = (x, w) => x?.title === w.title && x?.done === w.done
  check(
    `${label}: the repo and A hold the edit and every earlier one, with A on the branch head`,
    Object.entries(expect).every(([id, w]) => same(repo[id], w) && same(onA[id], w)) && a.head === head && a.pending.length === 0,
    { want: expect, repo, onA, head: { a: short(a.head), branch: short(head) }, pending: a.pending },
  )
}

async function run(key, title, fn) {
  if (!wanted(key)) return
  scenario = key
  section(`${key}. ${title}`)
  try {
    await fn()
  } catch (e) {
    check(`${key} ran to the end`, false, e.stack ?? String(e))
  }
}

let aborted = false
try {
  section('start')
  h = await startHarness()
  info(`app ${process.env.APP_DIR ?? '(the repo: set APP_DIR to a copy)'}, ports ${h.appUrl} and ${h.apiUrl}`)

  await run('S1', "another device's edit, then a read one commit behind", async () => {
    const [A, B] = await fresh()
    await B.edit('t-stamps01', { title: 'Buy stamps by Friday' })
    await B.sync()
    await A.sync()
    const good = (await A.snapshot()).head
    const goodEtag = (await h.state()).etag
    const diskBefore = (await A.storage()).repo?.base
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    const n = await bookmark()
    let a = await A.sync()
    const reqs = (await h.requests(n)).filter((r) => r.device === 'A' && r.endpoint !== 'preflight')
    info(`A's requests for the read: ${reqs.map((r) => `${r.endpoint} ${r.status}${r.note ? ` (${r.note})` : ''}`).join(', ')}`)
    const up = await notice(A)
    check(
      "S1: after the lagging read A keeps the current head and B's edit, and shows saved",
      a.head === good && titleOf(a, 't-stamps01') === 'Buy stamps by Friday' && a.sync.kind === 'saved' && !up,
      { head: a.head === good ? 'current' : `older (${short(a.head)})`, title: titleOf(a, 't-stamps01'), band: a.sync, notice: up },
    )
    const files = reqs.filter((r) => ['getTree', 'graphql', 'getBlob'].includes(r.endpoint))
    check('S1: the lagging read costs no tree or file reads', files.length === 0, files.map((r) => `${r.endpoint} ${r.status}`))
    const memory = await A.store((s) => s.remote.base.etag)
    const disk = (await A.storage()).repo?.base
    check(
      "S1: the lagging read's ETag is not kept: memory holds the head's, localStorage is unchanged",
      memory === goodEtag && disk?.head === diskBefore?.head && disk?.etag === diskBefore?.etag && disk?.head === good,
      { memory, headEtag: goodEtag, diskBefore: { head: short(diskBefore?.head), etag: diskBefore?.etag }, diskAfter: { head: short(disk?.head), etag: disk?.etag } },
    )
    a = await A.sync()
    check("S1: after the next read A is still on the current head with B's edit", a.head === good && titleOf(a, 't-stamps01') === 'Buy stamps by Friday', {
      head: short(a.head),
      title: titleOf(a, 't-stamps01'),
    })
  })

  await run('S2', "B checks off; A reopens it; A's commit cycle reads one commit behind", async () => {
    const [A, B] = await fresh()
    await B.toggle('t-stamps01')
    await B.sync()
    await A.sync()
    const before = (await h.commits()).length
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    await A.toggle('t-stamps01') // reopen
    const n = await bookmark()
    let a = await A.sync()
    info(`A's reads: ${(await refReads(n, 'A')).join(', ')}; then done=${doneOf(a, 't-stamps01')}, pending ${a.pending.length}`)
    a = await A.sync()
    const files = await h.repoFiles()
    const repoDone = (repoTodos(files)['t-stamps01'] ?? []).map((f) => f.done)
    check("S2: A's reopen is kept, on A and in the repo", doneOf(a, 't-stamps01') === false && repoDone.length === 1 && repoDone[0] === false && a.pending.length === 0, {
      onA: doneOf(a, 't-stamps01'),
      repoDone,
      pending: a.pending,
    })
    const mine = (await h.commits()).slice(before).filter((c) => c.by === 'A')
    check('S2: the reopen is committed exactly once', mine.length === 1, mine.map((c) => c.message))
  })

  await run('S3', "B adds a to-do; A deletes it; A's commit cycle reads one commit behind", async () => {
    const [A, B] = await fresh()
    const t = await B.add('Water the plants')
    await B.sync()
    await A.sync()
    const before = (await h.commits()).length
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    await A.remove(t.id)
    const n = await bookmark()
    let a = await A.sync()
    info(`A's reads: ${(await refReads(n, 'A')).join(', ')}; then present=${a.todos.some((x) => x.id === t.id)}, pending ${a.pending.length}`)
    a = await A.sync()
    const files = await h.repoFiles()
    const inRepo = (repoTodos(files)[t.id] ?? []).map((f) => f.path)
    const up = await notice(A)
    check("S3: A's delete is kept, on A and in the repo, with no banner", !a.todos.some((x) => x.id === t.id) && inRepo.length === 0 && a.sync.kind === 'saved' && !up, {
      onA: a.todos.some((x) => x.id === t.id) ? 'back' : 'gone',
      inRepo,
      band: a.sync,
      notice: up,
    })
    const mine = (await h.commits()).slice(before).filter((c) => c.by === 'A')
    check('S3: the delete is committed exactly once', mine.length === 1, mine.map((c) => c.message))
  })

  await run('S4', "A's own commit, then a read one commit behind", async () => {
    const [A] = await fresh(['A'])
    await A.edit('t-stamps01', { title: 'Buy stamps today' })
    await A.sync()
    const good = (await A.snapshot()).head
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    const n = await bookmark()
    const a = await A.sync()
    const reqs = (await h.requests(n)).filter((r) => r.device === 'A' && r.endpoint !== 'preflight')
    info(`A's requests for the read: ${reqs.map((r) => `${r.endpoint} ${r.status}${r.note ? ` (${r.note})` : ''}`).join(', ')}`)
    check('S4: after the lagging read A keeps its own commit', a.head === good && titleOf(a, 't-stamps01') === 'Buy stamps today', {
      head: a.head === good ? 'current' : `older (${short(a.head)})`,
      title: titleOf(a, 't-stamps01'),
    })
    const files = reqs.filter((r) => ['getTree', 'graphql', 'getBlob'].includes(r.endpoint))
    check('S4: the lagging read costs no tree or file reads', files.length === 0, files.map((r) => `${r.endpoint} ${r.status}`))
  })

  await run('S4b', 'A pulls a hand edit, commits its own edit, then a read two commits behind', async () => {
    const [A] = await fresh(['A'])
    await h.externalCommit({ 'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank at 9', order: 1, ...HAND }) })
    await A.sync()
    await A.edit('t-stamps01', { title: 'Buy stamps today' })
    await A.sync()
    const good = (await A.snapshot()).head
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 2, times: 1 })
    const n = await bookmark()
    let a = await A.sync()
    info(`A's reads: ${(await refReads(n, 'A')).join(', ')}`)
    check(
      'S4b: after the lagging read A keeps its commit and the hand edit',
      a.head === good && titleOf(a, 't-stamps01') === 'Buy stamps today' && titleOf(a, 't-bank0001') === 'Call the bank at 9',
      { head: a.head === good ? 'current' : `older (${short(a.head)})`, own: titleOf(a, 't-stamps01'), hand: titleOf(a, 't-bank0001') },
    )
    a = await A.sync()
    check('S4b: after the next read A is still on its own commit', a.head === good && titleOf(a, 't-stamps01') === 'Buy stamps today' && titleOf(a, 't-bank0001') === 'Call the bank at 9', {
      head: short(a.head),
      own: titleOf(a, 't-stamps01'),
      hand: titleOf(a, 't-bank0001'),
    })
  })

  await run('S5', "the commit retry loop: A's ref update loses a race (422), its re-read is two commits behind", async () => {
    const [A] = await fresh(['A'])
    await h.externalCommit({ 'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank at 9', order: 1, ...HAND }) })
    await A.sync()
    const before = (await h.commits()).length
    await h.fault({ endpoint: 'patchRef', device: 'A', hold: true, times: 1 })
    // A puts the hand edit's title back: a pending change equal to the seed's value, which the lagging read serves.
    await A.edit('t-bank0001', { title: 'Call the bank' })
    const syncing = A.sync({ allowFailed: true, timeout: 90_000 })
    await h.waitHeld({ endpoint: 'patchRef', device: 'A' })
    await h.externalCommit({ 'inbox/buy-stamps.md': todoFile({ id: 't-stamps01', title: 'Buy stamps x10', order: 2, ...HAND }) })
    const n = await bookmark()
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 2, times: 1 })
    await h.release({ endpoint: 'patchRef', device: 'A' })
    let a = await syncing
    info(`A's reads after the 422: ${(await refReads(n, 'A')).join(', ')}; band ${a.sync.kind}, pending ${a.pending.length}`)
    a = await A.sync({ allowFailed: true })
    const files = await h.repoFiles()
    const bank = repoTitle(files, 't-bank0001')
    const stamps = repoTitle(files, 't-stamps01')
    check("S5: A's change and the other commit both end up in the repo and on A", bank === 'Call the bank' && stamps === 'Buy stamps x10' && titleOf(a, 't-bank0001') === 'Call the bank' && titleOf(a, 't-stamps01') === 'Buy stamps x10', {
      repo: { bank, stamps },
      onA: { bank: titleOf(a, 't-bank0001'), stamps: titleOf(a, 't-stamps01') },
    })
    const mine = (await h.commits()).slice(before).filter((c) => c.by === 'A')
    const up = await notice(A)
    check('S5: A commits its change exactly once and ends saved, with no conflict notice', mine.length === 1 && a.sync.kind === 'saved' && a.pending.length === 0 && !up, {
      commits: mine.map((c) => c.message),
      band: a.sync,
      notice: up,
      pending: a.pending,
    })
  })

  await run('S6', 'a list made elsewhere; A edits a to-do in it; a read from before the list existed', async () => {
    const [A] = await fresh(['A'])
    await h.externalCommit({
      'errands/_list.md': listFile({ index: 2, name: 'Errands', ink: 2 }),
      'errands/post-office.md': todoFile({ id: 't-post0001', title: 'Post office', order: 1 }),
    })
    await A.sync()
    await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    await watchBand(A)
    await A.edit('t-post0001', { title: 'Post office before noon' })
    let a = await A.sync({ allowFailed: true })
    info(`after the cycle with the lagging read: band ${JSON.stringify(a.sync)}, notice ${JSON.stringify(await notice(A))}`)
    a = await A.sync({ allowFailed: true })
    const files = await h.repoFiles()
    const errands = Object.keys(files).filter((p) => p.startsWith('errands/')).sort()
    const up = await notice(A)
    check(
      'S6: the edit lands in the Errands list, which stays, and A ends saved',
      a.sync.kind === 'saved' && !up && repoTitle(files, 't-post0001') === 'Post office before noon' && !!files['errands/_list.md'] && a.lists.some((l) => l.id === 'errands'),
      { band: a.sync, notice: up, errands, title: repoTitle(files, 't-post0001'), lists: a.lists.map((l) => l.id) },
    )
    const shown = await bands(A)
    check('S6: no conflict or "deleted on another device" notice at any point', !showedNotice(shown), shown)
  })

  await run('S7', 'a read stuck one commit behind for over a minute', async () => {
    const [A, B] = await fresh()
    await B.edit('t-stamps01', { title: 'Buy stamps by Friday' })
    await B.sync()
    await A.sync()
    const good = (await A.snapshot()).head
    const { id } = await h.fault({ endpoint: 'getRef', device: 'A', lag: 1 })
    let a = await A.sync()
    info(`at once: A on the ${a.head === good ? 'current' : 'older'} head`)
    await sleep(61_000)
    a = await A.sync()
    info(`after 61 s: A on the ${a.head === good ? 'current head (still ignoring)' : 'older head (adopted)'}, title "${titleOf(a, 't-stamps01')}"`)
    await h.clearFaults(id)
    a = await A.sync()
    check("S7: once reads are current again, A is on the current head with B's edit", a.head === good && titleOf(a, 't-stamps01') === 'Buy stamps by Friday', {
      head: short(a.head),
      title: titleOf(a, 't-stamps01'),
    })
  })

  await run('S8', 'a head A never held: B commits H2, then H3 10 s later; A pulls H3; then one read lags by 1', async () => {
    const [A, B] = await fresh()
    const h1 = (await h.state()).head
    await B.edit('t-stamps01', { title: 'Buy stamps by Friday' })
    await B.sync()
    const h2 = (await h.state()).head
    const nH2 = await bookmark()
    await B.edit('t-bank0001', { title: 'Call the bank at 9' })
    await B.sync() // waits out B's 10 s commit gap
    const h3 = (await h.state()).head
    const nH3 = await bookmark()
    const names = (s) => ({ [h1]: 'H1', [h2]: 'H2', [h3]: 'H3' })[s] ?? short(s)
    let a = await A.sync()
    const between = (await h.requests(nH2)).filter((r) => r.device === 'A' && r.endpoint === 'getRef' && r.n <= nH3)
    const cs = await h.commits()
    const gap = (Date.parse(cs.at(-1).at) - Date.parse(cs.at(-2).at)) / 1000
    check('S8 setup: A pulls H3 straight from H1, and H3 came 10 s or more after H2', a.head === h3 && between.length === 0 && gap >= 10 && cs.at(-1).by === 'B' && cs.at(-2).by === 'B', {
      a: names(a.head),
      readsBetween: between.length,
      gap,
    })

    await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    let r = await readOnce(A)
    info(`the lagging read: ${r.reads.join(', ')}; A then on ${names(r.snap.head)}`)
    const trail = []
    let back = r.snap.head === h3 ? 0 : null
    for (let i = 1; back === null && i <= 2; i++) {
      r = await readOnce(A)
      trail.push(`read ${i}: ${r.reads.join(', ')} -> A on ${names(r.snap.head)}`)
      if (r.snap.head === h3) back = i
    }
    if (trail.length) info(trail.join('; '))
    check('S8: A is back on H3 within 2 reads after the lagging one', back !== null, trail)
    r = await readOnce(A)
    a = r.snap
    check("S8: one more read: A stays on H3 and shows both of B's edits", a.head === h3 && titleOf(a, 't-stamps01') === 'Buy stamps by Friday' && titleOf(a, 't-bank0001') === 'Call the bank at 9', {
      head: names(a.head),
      reads: r.reads,
      titles: [titleOf(a, 't-stamps01'), titleOf(a, 't-bank0001')],
    })

    // H2 has B's stamps edit, so the lagging read puts back only the bank title: A edits the stamps.
    await editAfterLag(A, {
      lag: 1,
      label: 'S8',
      names,
      act: (dev) => dev.edit('t-stamps01', { title: 'Buy stamps and envelopes' }),
      expect: { 't-stamps01': { title: 'Buy stamps and envelopes', done: false }, 't-bank0001': { title: 'Call the bank at 9', done: false } },
    })
  })

  await run('S8b', 'A commits, reloads, then the first read lags by 2', async () => {
    const [A] = await fresh(['A'])
    const c1 = (await h.state()).head
    await h.externalCommit({ 'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank at 9', order: 1, ...HAND }) })
    const c2 = (await h.state()).head
    await A.sync()
    await A.edit('t-stamps01', { title: 'Buy stamps today' })
    await A.sync()
    await A.sync() // the read after an own commit
    const c3 = (await h.state()).head
    const names = (s) => ({ [c1]: 'C1', [c2]: 'C2', [c3]: 'C3 (own)' })[s] ?? short(s)
    const own = (await h.commits()).at(-1)
    let a = await A.snapshot()
    check('S8b setup: A is on its own commit C3, on top of the pulled hand edit C2', a.head === c3 && own.by === 'A' && own.parents[0] === c2, { a: names(a.head), last: { by: own.by, parent: names(own.parents[0]) } })

    await h.fault({ endpoint: 'getRef', device: 'A', lag: 2, times: 1 })
    const n = await bookmark()
    a = await A.reload()
    info(`the first read after the reload: ${(await refReads(n, 'A')).join(', ')}; A then on ${names(a.head)}`)
    const trail = []
    let back = a.head === c3 ? 0 : null
    for (let i = 1; back === null && i <= 2; i++) {
      const r = await readOnce(A)
      trail.push(`read ${i}: ${r.reads.join(', ')} -> A on ${names(r.snap.head)}`)
      a = r.snap
      if (a.head === c3) back = i
    }
    if (trail.length) info(trail.join('; '))
    check('S8b: A is back on its own commit within 2 reads after the lagging one', back !== null, trail)
    const r = await readOnce(A)
    a = r.snap
    const files = await h.repoFiles()
    check(
      'S8b: one more read: A stays there, and A and the repo hold its edit and the hand edit',
      a.head === c3 && titleOf(a, 't-stamps01') === 'Buy stamps today' && titleOf(a, 't-bank0001') === 'Call the bank at 9' && repoTitle(files, 't-stamps01') === 'Buy stamps today' && repoTitle(files, 't-bank0001') === 'Call the bank at 9' && (await h.state()).head === c3,
      { head: names(a.head), onA: [titleOf(a, 't-stamps01'), titleOf(a, 't-bank0001')], repo: [repoTitle(files, 't-stamps01'), repoTitle(files, 't-bank0001')] },
    )

    // C1 is the seed, so the lagging read puts back both titles: A checks one off instead.
    await editAfterLag(A, {
      lag: 2,
      label: 'S8b',
      names,
      act: (dev) => dev.toggle('t-bank0001'),
      expect: { 't-stamps01': { title: 'Buy stamps today', done: false }, 't-bank0001': { title: 'Call the bank at 9', done: true } },
    })
  })

  // ---- the run's invariants ----
  scenario = 'end'
  section('invariants')
  await closeAll()
  check('nothing tried to reach api.github.com', h.realGitHubHits.length === 0, h.realGitHubHits)
  const pageErrors = seen.errors.filter((e) => e.includes('pageerror'))
  check('no uncaught errors in any page', pageErrors.length === 0, pageErrors)
  // Chrome logs every 4xx as a console error; a refused ref update (422) is expected, nothing else.
  const consoleErrors = seen.errors.filter((e) => e.includes('console.error'))
  const unexpected = consoleErrors.filter((e) => !/status of 422/.test(e))
  const patch422 = seen.status['patchRef 422'] ?? 0
  const all422 = Object.entries(seen.status).filter(([k]) => / 422$/.test(k)).reduce((sum, [, v]) => sum + v, 0)
  check(
    'the only console errors are the expected 422s, one per refused ref update',
    unexpected.length === 0 && consoleErrors.length === patch422 && all422 === patch422,
    { unexpected, console422: consoleErrors.length - unexpected.length, patchRef422: patch422, all422 },
  )
  check('no request reached an unhandled mock route, and no mock leniency was used', !seen.total.unknown && !seen.total.otherRepo && seen.warnings === 0, { total: seen.total, warnings: seen.warnings })
  const warnings = seen.errors.filter((e) => e.includes('console.warning'))
  if (warnings.length) info(`console warnings (not failures):\n      ${warnings.join('\n      ')}`)
  info(`refused ref updates (422) across the run: ${patch422}`)
} catch (e) {
  aborted = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok)
const secs = `${((Date.now() - t0) / 1000).toFixed(0)}s`
if (bad.length || aborted) console.log(`\nFAILED: ${bad.length} of ${results.length} checks failed${aborted ? ', run aborted' : ''} in ${secs}`)
else console.log(`\nPASSED: ${results.length}/${results.length} checks passed in ${secs}`)
process.exit(bad.length || aborted ? 1 : 0)
