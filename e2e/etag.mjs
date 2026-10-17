#!/usr/bin/env node
// ETag suite (sync problem 3, which ships with problem 4): the branch ETag a device keeps, in memory
// and in localStorage, is null or the ETag of the head it holds, never another commit's.
//
//   APP_DIR=/path/to/app APP_PORT=5630 MOCK_PORT=5631 node etag.mjs
//   (HEADED=1 to watch, VERBOSE=1 for mock, vite and console output; about 50 s)
//
// Covers, each scenario from h.reset:
//   1. One device walked through open, reloads, a pull, an own commit and the read after it: the
//      saved ETag is the mock's head ETag after the first open, a pull and the read after an own
//      commit; it is null right after an own commit, in memory and on disk; the first branch read
//      after every reload is a 304. 1b: a device upgraded with an older commit's ETag saved pays one
//      200, re-reads no file, and its next reload is a 304. 1c: a save from an older build (no
//      etagOfHead marker) holding the parent's ETag, after the branch is reset to that parent: its
//      ETag is dropped, so the first read is a 200 and the reset is seen.
//   2. The measured run (open, 3 reloads, a pull, a reload, an own commit, 3 checks, 2 reloads): at
//      most 3 x 200 and 9 x 304 branch reads, at most 10 requests that count against the rate limit.
//   3. A lagging branch read (lag: 1) right after an own commit: the device stays on its commit and
//      doesn't keep the parent's ETag (fix 4's guard, which fix 3 removes the old shield for).
//   4. (2a) A force-push back to the parent right after an own commit is seen within 2 reads (fix 4
//      takes the first read naming a head left under 60 s ago for a lagging replica, once), and the
//      device's next commit doesn't put the undone commit back (every file is scanned, since a title
//      edit renames the file). The reads after the force-push are idle ones: the known gap, a first
//      read inside a commit cycle fast-forwarding over the rewind, is not tested.
//   5. (2b) The same after a pull and a reload.
//   6. After a refused ref update (422) and its retry, the ETag is null, then the head's.
//   7. Hygiene: the ETag rule held at every observation, no api.github.com hits, no unhandled mock
//      routes, no page errors, and the only console error is scenario 6's expected 422.
//
// The force-push goes through the mock's own GitHub route (PATCH refs/heads/master with force: true,
// token test-token-Laptop), like `git push --force` from a laptop.
// Prints PASS/FAIL per check, then "PASSED: n/n checks passed in Xs" or "FAILED: k of n checks
// failed"; exits 0 or 1.

import { API, APP_DIR, REPO_KEY, listFile, sleep, startHarness, todoFile } from './harness.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}
const info = (text) => console.log(`      info: ${text}`)
const section = (title) => console.log(`\n== ${title}  [${since()}]`)

const BANK = 't-bank0001'
const STAMPS = 't-stamps01'
const SEED = {
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile({ id: BANK, title: 'Call the bank', order: 1 }),
  'inbox/buy-stamps.md': todoFile({ id: STAMPS, title: 'Buy stamps', order: 2 }),
}

let h
let scenario = ''
const devices = [] // { scenario, dev }
const etagOfHead = new Map() // sha -> the mock's ETag for it, recorded whenever it was the head
const violations = [] // breaches of the rule, from every observation
const trouble = [] // unhandled routes and mock leniencies, per scenario

// ---- helpers ------------------------------------------------------------------------------

const short = (sha) => (sha ? sha.slice(0, 7) : String(sha))
function whose(etag) {
  if (etag === null || etag === undefined) return 'no ETag'
  for (const [sha, e] of etagOfHead) if (e === etag) return `the ETag of ${short(sha)}`
  return `an unknown ETag ${etag.slice(0, 14)}`
}

/** The mock's state; also records the head's ETag. */
async function server() {
  const st = await h.state()
  if (st.head) etagOfHead.set(st.head, st.etag)
  return st
}
const mark = async () => (await h.state()).requests

async function open(name, opts) {
  const dev = await h.device(name, opts)
  devices.push({ scenario, dev })
  return dev
}

/**
 * The head and ETag a device holds, in memory and saved, next to the mock's. Also checks the rule
 * at this moment: an ETag held is null or the ETag of the head held with it.
 */
async function etags(dev, label) {
  const st = await server()
  const mem = await dev.store((s) => ({ head: s.remote.base?.head ?? null, etag: s.remote.base?.etag ?? null }))
  const base = (await dev.storage()).repo?.base ?? null
  const disk = { head: base?.head ?? null, etag: base?.etag ?? null }
  for (const [where, x] of [['memory', mem], ['localStorage', disk]]) {
    if (x.etag === null) continue
    const own = etagOfHead.get(x.head)
    if (x.etag !== own) violations.push(`${scenario}, ${label}: ${dev.name} holds ${short(x.head)} in ${where} with ${whose(x.etag)}`)
  }
  return { head: st.head, etag: st.etag, mem, disk }
}
const fresh = (x, e) => x.head === e.head && x.etag === e.etag
const show = (e) => ({
  mock: `${short(e.head)}, ${whose(e.etag)}`,
  memory: `${short(e.mem.head)}, ${whose(e.mem.etag)}`,
  localStorage: `${short(e.disk.head)}, ${whose(e.disk.etag)}`,
})

/** Statuses of a device's branch reads since request number `n`. */
async function refReads(dev, n) {
  return (await h.requests(n)).filter((r) => r.device === dev.name && r.endpoint === 'getRef').map((r) => r.status)
}
/** Reload, and return the status of the first branch read after it. */
async function reloadRead(dev) {
  const n = await mark()
  await dev.reload()
  return (await refReads(dev, n))[0] ?? null
}

/** The owner rewinds the branch from a laptop: git reset --hard <sha> && git push --force. */
async function forcePush(sha) {
  const res = await fetch(`${API}/repos/test/data/git/refs/heads/master`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer test-token-Laptop',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ sha, force: true }),
  })
  if (!res.ok) throw new Error(`the force-push answered ${res.status}: ${await res.text()}`)
  const st = await server()
  if (st.head !== sha) throw new Error(`the force-push left the branch at ${short(st.head)}, not ${short(sha)}`)
}

/** Idle checks until the device holds `sha`, at most `max` of them. */
async function untilHead(dev, sha, max) {
  let snap = await dev.snapshot()
  for (let i = 0; i < max && snap.head !== sha; i++) snap = await dev.sync()
  return snap
}

const titleOf = (snap, id) => snap.todos.find((t) => t.id === id)?.title ?? null

/** Paths whose content holds `text`. */
const filesWith = (files, text) => Object.entries(files).filter(([, c]) => c.includes(text)).map(([p]) => p)

/** Every to-do title in the repo, sorted. */
function repoTitles(files) {
  const out = []
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.md') || path.endsWith('/_list.md') || !path.includes('/')) continue
    const m = /^title: (.*)$/m.exec(text)
    if (m) out.push(m[1].startsWith('"') ? JSON.parse(m[1]) : m[1])
  }
  return out.sort()
}
const deviceTitles = (snap) => snap.todos.map((t) => t.title).sort()

/** Wait up to 2 s for the page's text to show `want` and not `unwanted`. */
async function screenShows(dev, want, unwanted) {
  let text = ''
  for (let i = 0; i < 20; i++) {
    text = await dev.page.evaluate(() => document.body.innerText)
    if (text.includes(want) && !text.includes(unwanted)) return { ok: true, text }
    await sleep(100)
  }
  return { ok: false, text }
}
const excerpt = (text, around) => {
  const lines = text.split('\n').filter((l) => l.includes(around))
  return lines.length ? lines.join(' | ') : `(no line with "${around}")`
}

/** Start a scenario: note the last one's hygiene, close its devices, reset the repo. */
async function begin(title) {
  await endScenario()
  scenario = title.split('.')[0]
  section(title)
  await h.reset(SEED)
  await server()
}
async function endScenario() {
  if (!scenario) return
  const c = await h.counters()
  if (c.total.unknown || c.total.otherRepo) trouble.push({ scenario, unknown: c.total.unknown ?? 0, otherRepo: c.total.otherRepo ?? 0 })
  const w = await h.warnings()
  if (w.length) trouble.push({ scenario, warnings: w })
  for (const { scenario: s, dev } of devices) if (s === scenario) await dev.close()
}

// ---- the run ------------------------------------------------------------------------------

let aborted = false
try {
  section('start')
  h = await startHarness()
  info(`app under test: ${APP_DIR}`)

  // ---- 1. one device, step by step ----
  {
    await begin("1. where A's ETag stands: open, reloads, a pull, an own commit (B commits elsewhere)")
    const seedHead = (await server()).head
    let n = await mark()
    const A = await open('A')
    let e = await etags(A, 'after the first open')
    info(`A's first read answered ${(await refReads(A, n))[0]}`)
    check("after the first open, A's ETag in memory and in localStorage is the head's", fresh(e.mem, e) && fresh(e.disk, e), show(e))

    let s = await reloadRead(A)
    await etags(A, 'after reload 1')
    check('a reload after the first open: the first branch read is a 304', s === 304, `got ${s}`)
    s = await reloadRead(A)
    await etags(A, 'after reload 2')
    check('a second reload in a row: the first branch read is a 304', s === 304, `got ${s}`)

    const B = await open('B')
    await B.edit(BANK, { title: 'Call the bank today' })
    await B.sync()
    const bHead = (await server()).head
    await B.close()
    await A.sync()
    e = await etags(A, 'after the pull')
    check("after a pull, A's ETag in memory and in localStorage is the new head's", e.head === bHead && fresh(e.mem, e) && fresh(e.disk, e), show(e))

    s = await reloadRead(A)
    await etags(A, 'after the reload after the pull')
    check('a reload after a pull: the first branch read is a 304', s === 304, `got ${s}`)

    await A.edit(STAMPS, { title: 'Buy stamps by Friday' })
    await A.sync()
    e = await etags(A, 'right after its own commit')
    const committed = e.head !== bHead && e.mem.head === e.head
    if (!committed) info(`A did not commit: ${JSON.stringify(show(e))}`)
    check('right after its own commit, the ETag A holds in memory is null', committed && e.mem.etag === null, show(e))
    check('right after its own commit, the ETag A saved in localStorage is null', committed && e.disk.head === e.head && e.disk.etag === null, show(e))

    n = await mark()
    await A.sync()
    e = await etags(A, 'after the read after its own commit')
    info(`the read after A's own commit answered ${(await refReads(A, n))[0]} (a 200 by design: the PATCH's ETag isn't used)`)
    check("after the read that follows its own commit, A's ETag in memory and in localStorage is the head's", fresh(e.mem, e) && fresh(e.disk, e), show(e))

    s = await reloadRead(A)
    await etags(A, 'after the reload after its own commit')
    check('a reload after an own commit (and the read after it): the first branch read is a 304', s === 304, `got ${s}`)

    section("1b. A, as if upgraded from a version that saved an older commit's ETag")
    // The bug's footprint: the head held, with the ETag of a commit before it (here the seed's).
    const oldEtag = etagOfHead.get(seedHead)
    await A.store((st, etag) => {
      st.remote.base.etag = etag
    }, oldEtag)
    await A.page.evaluate(
      ([key, etag]) => {
        const saved = JSON.parse(localStorage.getItem(key))
        saved.base.etag = etag
        localStorage.setItem(key, JSON.stringify(saved))
      },
      [REPO_KEY, oldEtag],
    )
    if ((await A.storage()).repo.base.etag !== oldEtag) throw new Error("couldn't plant the old ETag in A's localStorage")
    n = await mark()
    await A.reload()
    const upgrade = (await h.requests(n)).filter((r) => r.device === 'A' && r.endpoint !== 'preflight')
    e = await etags(A, 'after the first reload after the upgrade')
    const firstAfterUpgrade = upgrade.find((r) => r.endpoint === 'getRef')?.status ?? null
    check(
      "after the upgrade, A's first read is one 200, and the head's ETag is then in memory and in localStorage",
      firstAfterUpgrade === 200 && fresh(e.mem, e) && fresh(e.disk, e),
      { firstRead: firstAfterUpgrade, ...show(e) },
    )
    check(
      'that first read after the upgrade re-reads no file',
      !upgrade.some((r) => ['getTree', 'graphql', 'getBlob'].includes(r.endpoint)),
      upgrade.map((r) => `${r.endpoint} ${r.status}`),
    )
    s = await reloadRead(A)
    await etags(A, 'after the second reload after the upgrade')
    check('the next reload after the upgrade: the first branch read is a 304', s === 304, `got ${s}`)

    section("1c. A save written by an older build, holding the parent's ETag, meets a branch reset to that parent")
    // The older build saved no marker and could hold the parent's ETag. If the branch is then reset to
    // exactly that parent, a read sending that ETag gets a 304 and the reset goes unseen.
    const held = (await A.snapshot()).head
    const parent = (await h.commits()).find((c, i, all) => all[i + 1]?.sha === held)?.sha
    if (!parent) throw new Error("couldn't find the parent of A's head")
    await forcePush(parent)
    const parentEtag = (await server()).etag
    await A.page.evaluate(
      ([key, etag]) => {
        const saved = JSON.parse(localStorage.getItem(key))
        saved.base.etag = etag
        delete saved.etagOfHead
        localStorage.setItem(key, JSON.stringify(saved))
      },
      [REPO_KEY, parentEtag],
    )
    n = await mark()
    await A.reload()
    const firstOld = (await refReads(A, n))[0] ?? null
    const afterOld = await untilHead(A, parent, 2)
    check("an older build's saved ETag is dropped: the first read is a 200, not a 304", firstOld === 200, `got ${firstOld}`)
    check('and the reset is seen: A now holds the parent', afterOld.head === parent, `A holds ${short(afterOld.head)}, parent ${short(parent)}`)
    check('the save written after it carries the marker', (await A.storage()).repo?.etagOfHead === true)
  }

  // ---- 2. the measured run ----
  {
    await begin('2. the cost of the measured run: open, 3 reloads, a pull, a reload, an own commit, 3 checks, 2 reloads (device C; D commits once)')
    const n0 = await mark()
    const afterReload = []
    const C = await open('C')
    await etags(C, 'measured run: open')
    for (let i = 1; i <= 3; i++) afterReload.push([`reload ${i} after the open`, await reloadRead(C)])
    const D = await open('D')
    await D.edit(BANK, { title: 'Call the bank today' })
    await D.sync()
    await server()
    await D.close()
    await C.sync()
    await etags(C, 'measured run: pull')
    afterReload.push(['reload after the pull', await reloadRead(C)])
    await C.edit(STAMPS, { title: 'Buy stamps by Friday' })
    await C.sync()
    await etags(C, 'measured run: own commit')
    for (let i = 0; i < 3; i++) await C.sync()
    await etags(C, 'measured run: 3 checks')
    for (let i = 1; i <= 2; i++) afterReload.push([`reload ${i} after the own commit`, await reloadRead(C)])
    await etags(C, 'measured run: end')

    const reqs = (await h.requests(n0)).filter((r) => r.device === 'C' && r.endpoint !== 'preflight')
    const refs = reqs.filter((r) => r.endpoint === 'getRef').map((r) => r.status)
    const r200 = refs.filter((x) => x === 200).length
    const r304 = refs.filter((x) => x === 304).length
    const limited = reqs.filter((r) => r.status !== 304)
    const byEndpoint = {}
    for (const r of reqs) byEndpoint[`${r.endpoint} ${r.status}`] = (byEndpoint[`${r.endpoint} ${r.status}`] ?? 0) + 1
    info(`device C: ${refs.length} branch reads = ${r200} x 200 + ${r304} x 304; ${limited.length} requests count against the rate limit`)
    info(`device C by endpoint: ${JSON.stringify(byEndpoint)}`)
    check('the measured run costs at most 3 x 200 and 9 x 304 branch reads', r200 <= 3 && r304 <= 9 && r200 + r304 === refs.length, { reads: refs, byEndpoint })
    check('the measured run makes at most 10 requests that count against the rate limit (16 before the fix)', limited.length <= 10, byEndpoint)
    check('in the measured run, the first branch read after every reload is a 304', afterReload.every(([, x]) => x === 304), afterReload.map(([what, x]) => `${what}: ${x}`))
  }

  // ---- 3. a lagging read right after an own commit ----
  {
    await begin("3. a lagging branch read right after A's own commit (lag: 1)")
    const A = await open('A')
    await A.sync()
    const X = (await server()).head
    await A.edit(STAMPS, { title: 'Buy stamps (A)' })
    await A.sync()
    const Y = (await server()).head
    if (Y === X || (await A.snapshot()).head !== Y) throw new Error('A did not commit its edit')
    await etags(A, 'right after its own commit')
    const { id: faultId } = await h.fault({ endpoint: 'getRef', device: 'A', lag: 1, times: 1 })
    let n = await mark()
    await A.sync()
    const lagged = (await h.requests(n)).filter((r) => r.device === 'A' && r.endpoint === 'getRef')
    const hits = (await h.state()).faults.find((f) => f.id === faultId)?.hits ?? 0
    info(`the lagging read answered ${lagged[0]?.status}${lagged[0]?.note ? ` (${lagged[0].note})` : ''}; fault hits ${hits}`)
    let a = await A.snapshot()
    let e = await etags(A, 'after the lagging read')
    check(
      'a lagging read right after an own commit leaves A on its commit, showing its edit',
      hits === 1 && a.head === Y && titleOf(a, STAMPS) === 'Buy stamps (A)' && a.pending.length === 0,
      { faultHits: hits, head: a.head === Y ? 'its commit' : a.head === X ? 'the parent' : short(a.head), title: titleOf(a, STAMPS), pending: a.pending },
    )
    const ownOrNull = (x) => x.head === Y && (x.etag === null || x.etag === etagOfHead.get(Y))
    check("after the lagging read, A's ETag in memory and in localStorage is null or its own head's, never the parent's", ownOrNull(e.mem) && ownOrNull(e.disk), show(e))
    n = await mark()
    await A.sync()
    a = await A.snapshot()
    e = await etags(A, 'after the read after the lagging one')
    info(`the next read answered ${(await refReads(A, n))[0]}`)
    check(
      "the next read keeps A on its commit, and its ETag in memory and in localStorage is then the head's",
      a.head === Y && titleOf(a, STAMPS) === 'Buy stamps (A)' && fresh(e.mem, e) && fresh(e.disk, e),
      { title: titleOf(a, STAMPS), ...show(e) },
    )
  }

  // ---- 4. (2a) a force-push back to the parent, right after an own commit ----
  {
    await begin('4. (2a) the owner force-pushes the branch back to the parent of A\'s commit, right after it')
    const A = await open('A')
    await A.sync()
    const X = (await server()).head
    await A.edit(STAMPS, { title: 'Buy stamps (A)' })
    await A.sync()
    const Y = (await server()).head
    if (Y === X || (await A.snapshot()).head !== Y) throw new Error('A did not commit its edit')
    let e = await etags(A, 'right after its own commit')
    info(`A committed ${short(Y)} on ${short(X)}; A holds ${whose(e.mem.etag)}`)
    await forcePush(X)
    const n = await mark()
    let a = await untilHead(A, X, 2)
    const reads = await refReads(A, n)
    info(`A's reads after the force-push: ${reads.join(', ')}; A holds ${a.head === X ? 'the parent' : a.head === Y ? 'its undone commit' : short(a.head)}`)
    check("A's first read after the force-push is not a 304 (its ETag wasn't the parent's)", reads.length > 0 && reads[0] !== 304, reads)
    check(
      'A is back on the parent within 2 reads, with the title from before its edit',
      a.head === X && titleOf(a, STAMPS) === 'Buy stamps' && a.pending.length === 0,
      { head: a.head === Y ? 'still its undone commit' : short(a.head), title: titleOf(a, STAMPS), pending: a.pending },
    )
    const screen = await screenShows(A, 'Buy stamps', 'Buy stamps (A)')
    check('A\'s screen shows "Buy stamps" again, not "Buy stamps (A)"', screen.ok, excerpt(screen.text, 'Buy stamps'))
    e = await etags(A, 'after the force-push was seen')

    // A edits something else: does its next commit put the undone one back?
    await A.edit(BANK, { title: 'Call the bank (A, later)' })
    a = await A.sync()
    await etags(A, 'after its next commit')
    const history = await h.commits()
    const all = await h.commits({ all: true })
    const last = history.at(-1)
    const files = await h.repoFiles()
    check(
      "A's next commit is built on the force-pushed head",
      last.by === 'A' && last.parents[0] === X,
      history.map((c) => `${short(c.sha)} <- ${c.parents.map(short).join(',')} by ${c.by}: ${c.message.split('\n')[0]}`),
    )
    const traces = filesWith(files, 'Buy stamps (A)')
    const yBack = all.find((c) => c.sha === Y)?.onBranch ?? false
    check('the undone commit never comes back: no file holds "Buy stamps (A)", and it is not on the branch', !traces.length && !yBack, { filesWithIt: traces, undoneCommitOnBranch: yBack })
    check(
      "A's later edit is on GitHub, nothing is pending, and A shows exactly the repo's to-dos",
      filesWith(files, 'Call the bank (A, later)').length === 1 && a.pending.length === 0 && JSON.stringify(deviceTitles(a)) === JSON.stringify(repoTitles(files)),
      { device: deviceTitles(a), repo: repoTitles(files), pending: a.pending },
    )
  }

  // ---- 5. (2b) a force-push back past a pull, seen after a reload ----
  {
    await begin("5. (2b) the owner force-pushes the branch back past Q's commit, which P pulled; P reloads")
    const P = await open('P')
    const Q = await open('Q')
    await P.sync()
    const X = (await server()).head
    await Q.edit(BANK, { title: 'Call the bank (Q)' })
    await Q.sync()
    const Q1 = (await server()).head
    await P.sync()
    let e = await etags(P, 'after the pull')
    if (e.mem.head !== Q1) throw new Error("P did not pull Q's commit")
    info(`P pulled ${short(Q1)}; P saved ${whose(e.disk.etag)}`)
    await Q.close()
    await forcePush(X)
    const n = await mark()
    await P.reload()
    let a = await untilHead(P, X, 1)
    const reads = await refReads(P, n)
    info(`P's reads after the force-push and the reload: ${reads.join(', ')}; P holds ${a.head === X ? 'the earlier commit' : a.head === Q1 ? "Q's undone commit" : short(a.head)}`)
    check("after a pull and a reload, P's first read sees the force-push (not a 304)", reads.length > 0 && reads[0] !== 304, reads)
    check(
      'P is back on the earlier commit within 2 reads, with the title from before Q\'s edit',
      a.head === X && titleOf(a, BANK) === 'Call the bank' && a.pending.length === 0,
      { head: a.head === Q1 ? "still Q's undone commit" : short(a.head), title: titleOf(a, BANK), pending: a.pending },
    )
    const screen = await screenShows(P, 'Call the bank', 'Call the bank (Q)')
    check('P\'s screen shows "Call the bank" again, not "Call the bank (Q)"', screen.ok, excerpt(screen.text, 'Call the bank'))
    e = await etags(P, 'after the force-push was seen')

    await P.edit(STAMPS, { title: 'Buy stamps (P)' })
    a = await P.sync()
    await etags(P, 'after its next commit')
    const history = await h.commits()
    const all = await h.commits({ all: true })
    const last = history.at(-1)
    const files = await h.repoFiles()
    check(
      "P's next commit is built on the force-pushed head",
      last.by === 'P' && last.parents[0] === X,
      history.map((c) => `${short(c.sha)} <- ${c.parents.map(short).join(',')} by ${c.by}: ${c.message.split('\n')[0]}`),
    )
    const traces = filesWith(files, 'Call the bank (Q)')
    const qBack = all.find((c) => c.sha === Q1)?.onBranch ?? false
    check('the undone commit never comes back: no file holds "Call the bank (Q)", and it is not on the branch', !traces.length && !qBack, { filesWithIt: traces, undoneCommitOnBranch: qBack })
    check(
      "P's later edit is on GitHub, nothing is pending, and P shows exactly the repo's to-dos",
      filesWith(files, 'Buy stamps (P)').length === 1 && a.pending.length === 0 && JSON.stringify(deviceTitles(a)) === JSON.stringify(repoTitles(files)),
      { device: deviceTitles(a), repo: repoTitles(files), pending: a.pending },
    )
  }

  // ---- 6. the retry after a refused ref update ----
  {
    await begin("6. A's ref update is refused (422) because B committed first; A re-reads, merges and commits again")
    const A = await open('A')
    const B = await open('B')
    await h.fault({ endpoint: 'patchRef', device: 'A', hold: true, times: 1 })
    await A.edit(STAMPS, { title: 'Buy stamps (A)' })
    await B.edit(BANK, { title: 'Call the bank (B)' })
    const aSync = A.sync({ timeout: 90_000 })
    await h.waitHeld({ endpoint: 'patchRef', device: 'A' }, 40_000)
    await B.sync()
    await server()
    await h.release({ endpoint: 'patchRef', device: 'A' })
    await aSync
    const st = await server()
    const refused = (await h.counters()).status['patchRef 422'] ?? 0
    let e = await etags(A, 'right after its retried commit')
    const last = (await h.commits()).at(-1)
    info(`refused ref updates: ${refused}; the head is ${short(st.head)} by ${last.by}`)
    check(
      "after the refusal and the retry, A's commit is the head and the ETag A holds is null, in memory and in localStorage",
      refused === 1 && last.by === 'A' && e.mem.head === st.head && e.mem.etag === null && e.disk.head === st.head && e.disk.etag === null,
      { refused, lastBy: last.by, ...show(e) },
    )
    await A.sync()
    e = await etags(A, 'after the read after its retried commit')
    const s = await reloadRead(A)
    await etags(A, 'after the reload after its retried commit')
    check(
      "the read after it leaves the head's ETag in memory and in localStorage, and a reload's first read is a 304",
      fresh(e.mem, e) && fresh(e.disk, e) && s === 304,
      { firstReadAfterReload: s, ...show(e) },
    )
  }

  // ---- 7. hygiene ----
  await endScenario()
  scenario = '7'
  section('7. the rule at every step, and hygiene')
  check("at every observation, the ETag a device held in memory and in localStorage was null or its head's", violations.length === 0, violations)
  check('nothing tried to reach api.github.com', h.realGitHubHits.length === 0, h.realGitHubHits)
  check('no request reached an unhandled mock route, and the mock was never lenient', trouble.length === 0, trouble)
  const tagged = devices.flatMap(({ scenario: s, dev }) => dev.errors.map((x) => `${s}/${dev.name}: ${x}`))
  const pageErrors = tagged.filter((x) => x.includes('pageerror'))
  check('no uncaught errors in any page', pageErrors.length === 0, pageErrors)
  const consoleErrors = tagged.filter((x) => x.includes('console.error'))
  const expected = consoleErrors.filter((x) => /^6\/A: .*status of 422/.test(x))
  check("the only console error is scenario 6's expected 422", expected.length === 1 && consoleErrors.length === 1, consoleErrors)
  const other = tagged.filter((x) => !x.includes('pageerror') && !x.includes('console.error'))
  if (other.length) info(`other console output (not failures):\n      ${other.join('\n      ')}`)
} catch (e) {
  aborted = true
  results.push({ name: 'the run completes', ok: false })
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok).length
console.log(bad ? `\nFAILED: ${bad} of ${results.length} checks failed` : `\nPASSED: ${results.length}/${results.length} checks passed in ${since()}`)
process.exit(bad || aborted ? 1 : 0)
