#!/usr/bin/env node
// Sync faults: what a device does when GitHub's answer to a save is lost (fix 5 of the sync plan).
// The last step of a save, the ref update (PATCH), is made to fail in each way below, through the
// app's real sync code against the mock GitHub:
//   1. it lands but the answer is lost (applied, then 502): never "failed", one branch read, the gap holds;
//   2. it fails before landing (502): "failed", one free 304 read, and Retry lands exactly once;
//   3. it lands, the answer is lost, and another device commits on top first: no loss, no duplicate;
//   4. it lands, the answer is lost, and the re-check fails too (502): "failed", Retry makes no
//      duplicate, and the next commit still keeps the 10 s gap;
//   5. it lands, the answer is lost, and the user edits during the re-check: the edit stays pending
//      and commits after the gap;
//   6. the re-check is rate limited (429, retry-after 75 s): the message names the time, nothing is
//      asked before it, then the device retries by itself;
//   7. the re-check is rate limited (403, retry-after 150 s): the message names the time, a check
//      asks nothing, and Retry makes no duplicate;
//   8. the re-check is refused (401): the device offers Reconnect;
//   9. a save fails before its ref update (500 on the tree POST): Retry commits at once, with no gap.
// These checks make the mock answer 4xx and 5xx on purpose, and Chrome logs each as a console
// error, so they live here and not in smoke.mjs.
//
//   APP_DIR=/path/to/app APP_PORT=5650 MOCK_PORT=5651 node sync-faults.mjs     (about 3 min)
//   node run-all.mjs sync-faults
// HEADED=1 to watch, VERBOSE=1 for mock, vite and console output, ONLY=1,4 for some scenarios.
// Prints PASS/FAIL per check and exits non-zero on any failure.

import { listFile, sleep, startHarness, todoFile } from './harness.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null

function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}
const info = (text) => console.log(`      info: ${text}`)
const section = (title) => console.log(`\n== ${title}  [${since()}]`)

const SEED = {
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank', order: 1 }),
  'inbox/buy-stamps.md': todoFile({ id: 't-stamps01', title: 'Buy stamps', order: 2 }),
}
const STAMPS = 'inbox/buy-stamps.md'
const RETRY_AFTER_LONG = 75
const RETRY_AFTER_SHORT = 150

// ---- helpers --------------------------------------------------------------------------------

let h

/** The device's sync state, as the store holds it. */
const st = (d) =>
  d.page.evaluate(() => {
    const s = window.__e2e.store
    return { kind: s.sync.kind, pending: s.pending.length, message: s.sync.message ?? null }
  })

/** Poll the sync state every 50 ms until `done(state)` or the timeout; return the transitions, with absolute (`at`) and relative (`t`) times. */
async function watch(d, done, timeout) {
  const start = Date.now()
  const seen = []
  for (;;) {
    const s = await st(d)
    const now = Date.now()
    const last = seen.at(-1)
    if (!last || last.kind !== s.kind || last.pending !== s.pending) seen.push({ ...s, at: now, t: now - start })
    if (done(s) || now - start > timeout) return seen
    await sleep(50)
  }
}
const line = (seen) => seen.map((s) => `${(s.t / 1000).toFixed(1)}s ${s.kind}/${s.pending}`).join(' -> ')
const settled = (s) => s.kind === 'failed' || (s.kind === 'saved' && s.pending === 0)
const saved = (s) => s.kind === 'saved' && s.pending === 0

/** One device's requests as the mock logged them since request number `n`, in the order they arrived. */
const reqsOf = async (device, n) => (await h.requests(n)).filter((r) => r.device === device).sort((a, b) => a.n - b.n)
const fmt = (reqs) => reqs.map((r) => `${r.endpoint} ${r.status}`).join(', ') || 'nothing'
const startOf = (r) => new Date(r.at).getTime()
const endOf = (r) => startOf(r) + r.ms
/** Seconds from the end of request `r` to the first write of the device's next commit (its tree POST). */
function gapToNextCommit(reqs, r) {
  const next = r && reqs.find((x) => x.n > r.n && x.endpoint === 'createTree')
  return next ? (startOf(next) - endOf(r)) / 1000 : NaN
}

/** Commits on the branch after the seed, oldest first. */
const landed = async () => (await h.commits()).slice(1)
/** Every commit object a device made, on the branch or not. */
const objectsBy = async (device) => (await h.commits({ all: true })).filter((c) => c.by === device)
const isDone = (text) => /\ndone: true\n/.test(text ?? '')
const repoHas = async (re) => Object.values(await h.repoFiles()).some((t) => re.test(t))

/** HH:MM, in the page's time zone, of each moment in `times`. */
const clockNames = (d, times) =>
  d.page.evaluate(
    (ts) =>
      [
        ...new Set(
          ts.map((ms) => {
            const x = new Date(ms)
            return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
          }),
        ),
      ],
    times,
  )

/** Park device's ref update with a 502 after it lands, then arm `recheck` (a fault spec for its next branch read) and let the update go. */
async function loseAnswer(A, device, recheck) {
  await h.fault({ endpoint: 'patchRef', device, hold: true, after: true, status: 502, times: 1 })
  await A.toggle('t-stamps01')
  await A.store((s) => s.remote.check())
  await h.waitHeld({ endpoint: 'patchRef', device }, 15_000)
  if (recheck) await h.fault({ endpoint: 'getRef', device, times: 1, ...recheck })
  const released = Date.now()
  await h.release({ endpoint: 'patchRef', device })
  return released
}

/** Wait up to `ms` for the device's branch re-read to be parked by a hold fault. */
async function recheckParked(device, ms = 4000) {
  try {
    await h.waitHeld({ endpoint: 'getRef', device }, ms)
    return true
  } catch {
    return false
  }
}

// ---- scenarios ------------------------------------------------------------------------------

let unknownRoutes = 0
const mockWarnings = []
const pageErrors = []

async function scenario(n, title, fn) {
  if (ONLY && !ONLY.has(n)) return
  section(`${n}. ${title}`)
  await h.reset(SEED)
  const opened = []
  const open = async (name) => {
    const d = await h.device(name)
    opened.push(d)
    return d
  }
  try {
    await fn(open)
  } catch (e) {
    check(`scenario ${n} ran to the end`, false, e.stack ?? String(e))
  } finally {
    const c = await h.counters()
    unknownRoutes += (c.total.unknown ?? 0) + (c.total.otherRepo ?? 0)
    mockWarnings.push(...(await h.warnings()))
    for (const d of opened) {
      pageErrors.push(...d.errors.filter((e) => e.startsWith('pageerror')).map((e) => `${d.name} ${e}`))
      await d.close().catch(() => {})
    }
  }
}

let failed = false
try {
  section('start')
  h = await startHarness()
  console.log(`      started mock, dev server and Chrome in ${since()}`)

  await scenario(1, 'The ref update lands but its answer is lost (applied, then 502)', async (open) => {
    const A = await open('A1')
    const n0 = (await h.state()).requests
    await h.fault({ endpoint: 'patchRef', device: 'A1', after: true, status: 502, times: 1 })
    await A.toggle('t-stamps01')
    await A.store((s) => s.remote.check())
    // Today's app heals after its 30 s backoff, so wait long enough to see that.
    const seen = await watch(A, saved, 45_000)
    await sleep(1500)
    info(`A's states: ${line(seen)}`)
    check('A never shows "failed" for a save that landed', !seen.some((s) => s.kind === 'failed'), line(seen))
    const end = await st(A)
    check('A ends saved with nothing pending', saved(end), end)
    const reqs = await reqsOf('A1', n0)
    const patch = reqs.find((r) => r.endpoint === 'patchRef')
    const after = reqs.filter((r) => r.n > (patch?.n ?? Infinity))
    info(`A's requests: ${fmt(reqs)}`)
    check('the only request after the lost answer is one branch read', after.length === 1 && after[0].endpoint === 'getRef', fmt(after))
    const commits = await landed()
    check('exactly one commit reached the branch, by A, with the check-off', commits.length === 1 && commits[0].by === 'A1' && isDone((await h.repoFiles())[STAMPS]), commits.map((c) => [c.by, c.message]))
    check('A made one commit object in all (no duplicate)', (await objectsBy('A1')).length === 1, (await objectsBy('A1')).map((c) => [c.message, c.onBranch]))

    // The next edit, made as soon as the first save shows, keeps the 10 s gap from the landed commit.
    await A.edit('t-bank0001', { title: 'Call the bank today' })
    await A.waitSaved({ timeout: 30_000 })
    const gap = gapToNextCommit(await reqsOf('A1', n0), patch)
    info(`the next commit's first write came ${gap.toFixed(1)} s after the landed ref update`)
    check('the next commit comes 10 s or more after the landed one', (await landed()).length === 2 && gap >= 9.9, { commits: (await landed()).length, gap })
  })

  await scenario(2, 'The ref update fails before landing (502, not applied)', async (open) => {
    const A = await open('A2')
    const n0 = (await h.state()).requests
    await h.fault({ endpoint: 'patchRef', device: 'A2', status: 502, times: 1 })
    await A.toggle('t-stamps01')
    await A.store((s) => s.remote.check())
    const seen = await watch(A, settled, 12_000)
    await sleep(1500)
    info(`A's states: ${line(seen)}`)
    const s = await st(A)
    check('A shows "failed" and keeps its change', s.kind === 'failed' && s.pending === 1, s)
    check('nothing reached the branch', (await landed()).length === 0, (await landed()).map((c) => c.message))
    const reqs = await reqsOf('A2', n0)
    const patch = reqs.find((r) => r.endpoint === 'patchRef')
    const after = reqs.filter((r) => r.n > (patch?.n ?? Infinity))
    info(`A's requests: ${fmt(reqs)}`)
    check('A read the branch once after the lost answer, a free 304', after.length === 1 && after[0].endpoint === 'getRef' && after[0].status === 304, fmt(after))
    await A.store((x) => x.retrySync())
    const a = await A.sync()
    check('after Retry: saved, nothing pending', saved({ kind: a.sync.kind, pending: a.pending.length }), a.sync)
    const commits = await landed()
    check('Retry lands the change exactly once', commits.length === 1 && commits[0].by === 'A2' && isDone((await h.repoFiles())[STAMPS]), commits.map((c) => [c.by, c.message]))
  })

  await scenario(3, "Lands, answer lost, and B commits on top before A's re-check answers", async (open) => {
    const A = await open('A3')
    const B = await open('B3')
    const n0 = (await h.state()).requests
    await loseAnswer(A, 'A3', { hold: true })
    const parked = await recheckParked('A3')
    info(`A re-read the branch right after the lost answer: ${parked}`)
    await B.edit('t-bank0001', { title: 'Call the bank before noon' })
    await B.sync()
    if (parked) await h.release({ endpoint: 'getRef', device: 'A3' })
    const seen = await watch(A, settled, 6000)
    info(`A's states after B moved the branch: ${line(seen)}`)
    const s = await st(A)
    check("A, unable to prove its commit is the head, shows \"failed\" and keeps its change", s.kind === 'failed' && s.pending === 1, s)
    await h.clearFaults()
    await A.store((x) => x.retrySync())
    const a = await A.sync()
    const b = await B.sync()
    info(`A's requests: ${fmt(await reqsOf('A3', n0))}`)
    check('A ends saved, nothing pending', saved({ kind: a.sync.kind, pending: a.pending.length }), a.sync)
    const files = await h.repoFiles()
    check('no loss: both changes are in the repo', isDone(files[STAMPS]) && (await repoHas(/title: Call the bank before noon\n/)), Object.keys(files))
    const commits = await landed()
    check('no duplicate: two commits on the branch, A once then B once', commits.length === 2 && commits[0].by === 'A3' && commits[1].by === 'B3', commits.map((c) => [c.by, c.message]))
    check('A and B agree', JSON.stringify(a.todos) === JSON.stringify(b.todos), { a: a.todos, b: b.todos })
  })

  await scenario(4, 'Lands, answer lost, and the re-check fails too (502)', async (open) => {
    const A = await open('A4')
    const n0 = (await h.state()).requests
    await loseAnswer(A, 'A4', { status: 502 })
    const seen = await watch(A, settled, 8000)
    info(`A's states: ${line(seen)}`)
    const s = await st(A)
    check('A shows "failed" and keeps its change (it cannot tell)', s.kind === 'failed' && s.pending === 1, s)
    // Another edit, then Retry at once: inside the 10 s gap of a commit that may have landed.
    await A.edit('t-bank0001', { title: 'Call the bank today' })
    await h.clearFaults()
    const nRetry = (await h.state()).requests
    const tRetry = Date.now()
    await A.store((x) => x.retrySync())
    const a = await A.sync()
    check('after Retry: saved, nothing pending', saved({ kind: a.sync.kind, pending: a.pending.length }), a.sync)
    const commits = await landed()
    const files = await h.repoFiles()
    check(
      'no duplicate: the check-off committed once, then the edit once',
      commits.length === 2 && commits.every((c) => c.by === 'A4') && commits[0].changed.includes(STAMPS) && !commits[1].changed.includes(STAMPS) && (await objectsBy('A4')).length === 2 && isDone(files[STAMPS]) && 'inbox/call-the-bank-today.md' in files,
      commits.map((c) => [c.by, c.message, c.changed]),
    )
    const reqs = await reqsOf('A4', n0)
    const retried = reqs.filter((r) => r.n > nRetry)
    const readAt = retried[0] ? (startOf(retried[0]) - tRetry) / 1000 : NaN
    const gap = gapToNextCommit(reqs, reqs.find((r) => r.endpoint === 'patchRef'))
    info(`after Retry: ${fmt(retried)}; first read ${readAt.toFixed(1)} s after Retry, next commit ${gap.toFixed(1)} s after the lost answer`)
    check('Retry reads the branch at once, and the next commit waits 10 s from the lost answer', retried[0]?.endpoint === 'getRef' && readAt < 1.5 && gap >= 9.9, { first: retried[0] && fmt([retried[0]]), readAt, gap })
  })

  await scenario(5, 'Lands, answer lost, and the user edits again while the re-check is in flight', async (open) => {
    const A = await open('A5')
    const n0 = (await h.state()).requests
    await loseAnswer(A, 'A5', { hold: true })
    const parked = await recheckParked('A5')
    info(`A re-read the branch right after the lost answer: ${parked}`)
    await A.edit('t-bank0001', { title: 'Call the bank at nine' })
    if (parked) await h.release({ endpoint: 'getRef', device: 'A5' })
    await sleep(800)
    const mid = await st(A)
    info(`right after the re-check: ${mid.kind}, ${mid.pending} pending`)
    check('the first save counts as done, the later edit stays pending, and A does not show "failed"', mid.pending === 1 && mid.kind !== 'failed', mid)
    await h.clearFaults()
    // No Retry: the app commits the later edit on its own.
    const seen = await watch(A, saved, 45_000)
    info(`A's states: ${line(seen)}`)
    const end = await st(A)
    check('A ends saved, nothing pending', saved(end), end)
    const commits = await landed()
    const files = await h.repoFiles()
    check('both changes reach the repo, in two commits by A', commits.length === 2 && commits.every((c) => c.by === 'A5') && isDone(files[STAMPS]) && (await repoHas(/title: Call the bank at nine\n/)), commits.map((c) => [c.by, c.message]))
    const reqs = await reqsOf('A5', n0)
    const gap = gapToNextCommit(reqs, reqs.find((r) => r.endpoint === 'patchRef'))
    info(`the later edit's commit started ${gap.toFixed(1)} s after the landed ref update`)
    check('the later edit commits 10 s or more after the landed commit', gap >= 9.9, gap)
  })

  await scenario(6, `Lands, answer lost, and the re-check is rate limited (429, retry-after ${RETRY_AFTER_LONG} s)`, async (open) => {
    const A = await open('A6')
    const n0 = (await h.state()).requests
    const released = await loseAnswer(A, 'A6', { status: 429, headers: { 'retry-after': String(RETRY_AFTER_LONG) }, message: 'You have exceeded a secondary rate limit.' })
    const seen = await watch(A, settled, 8000)
    const failedAt = seen.find((s) => s.kind === 'failed')?.at ?? Date.now()
    const s = await st(A)
    const names = await clockNames(A, [released + RETRY_AFTER_LONG * 1000, failedAt + RETRY_AFTER_LONG * 1000])
    info(`A's states: ${line(seen)}; message: ${s.message}`)
    check('A shows "failed", keeps its change, and names the retry-after time', s.kind === 'failed' && s.pending === 1 && names.some((x) => s.message?.includes(x)), { ...s, expected: names })
    // Asked to check, a rate-limited device asks GitHub nothing; then it retries by itself.
    for (let i = 0; i < 3; i++) {
      await A.store((x) => x.remote.check())
      await sleep(1000)
    }
    const done = await watch(A, saved, Math.max(0, failedAt + (RETRY_AFTER_LONG + 20) * 1000 - Date.now()))
    const reqs = await reqsOf('A6', n0)
    const later = reqs.filter((r) => startOf(r) > failedAt)
    const first = later.length ? (startOf(later[0]) - failedAt) / 1000 : NaN
    const byItself = saved(done.at(-1))
    info(`A's requests: ${fmt(reqs)}; the first after the failure came ${first.toFixed(1)} s later`)
    check(`A asks GitHub nothing for ${RETRY_AFTER_LONG} s, then retries and saves by itself`, byItself && first >= RETRY_AFTER_LONG - 1, { first, byItself, states: line(done) })
    if (!byItself) {
      await h.clearFaults()
      await A.store((x) => x.retrySync())
      await A.sync()
    }
    const end = await st(A)
    const commits = await landed()
    check('A ends saved, its change committed exactly once', saved(end) && commits.length === 1 && commits[0].by === 'A6' && (await objectsBy('A6')).length === 1 && isDone((await h.repoFiles())[STAMPS]), { end, commits: commits.map((c) => [c.by, c.message]) })
  })

  await scenario(7, `Lands, answer lost, and the re-check is rate limited (403, retry-after ${RETRY_AFTER_SHORT} s)`, async (open) => {
    const A = await open('A7')
    const n0 = (await h.state()).requests
    const released = await loseAnswer(A, 'A7', { status: 403, headers: { 'retry-after': String(RETRY_AFTER_SHORT) }, message: 'You have exceeded a secondary rate limit.' })
    const seen = await watch(A, settled, 8000)
    const failedAt = seen.find((s) => s.kind === 'failed')?.at ?? Date.now()
    const s = await st(A)
    const names = await clockNames(A, [released + RETRY_AFTER_SHORT * 1000, failedAt + RETRY_AFTER_SHORT * 1000])
    info(`A's states: ${line(seen)}; message: ${s.message}`)
    check('A shows "failed", keeps its change, and names the retry-after time', s.kind === 'failed' && s.pending === 1 && names.some((x) => s.message?.includes(x)), { ...s, expected: names })
    for (let i = 0; i < 3; i++) {
      await A.store((x) => x.remote.check())
      await sleep(1000)
    }
    const later = (await reqsOf('A7', n0)).filter((r) => startOf(r) > failedAt)
    check('asked to check while it waits, A asks GitHub nothing', later.length === 0, fmt(later))
    await h.clearFaults()
    await A.store((x) => x.retrySync())
    const a = await A.sync()
    const commits = await landed()
    check('after Retry: saved, its change committed exactly once', saved({ kind: a.sync.kind, pending: a.pending.length }) && commits.length === 1 && commits[0].by === 'A7' && (await objectsBy('A7')).length === 1 && isDone((await h.repoFiles())[STAMPS]), { sync: a.sync, commits: commits.map((c) => [c.by, c.message]) })
  })

  await scenario(8, 'Lands, answer lost, and the re-check is refused (401)', async (open) => {
    const A = await open('A8')
    await loseAnswer(A, 'A8', { status: 401, message: 'Bad credentials' })
    const seen = await watch(A, settled, 8000)
    await sleep(300)
    const s = await st(A)
    const buttons = await A.page.getByRole('button', { name: /^(Retry|Reconnect)$/ }).allTextContents()
    info(`A's states: ${line(seen)}; message: ${s.message}; band buttons: ${buttons.join(', ') || 'none'}`)
    check('A shows "failed", keeps its change, and offers Reconnect', s.kind === 'failed' && s.pending === 1 && buttons.includes('Reconnect') && !buttons.includes('Retry'), { ...s, buttons })
  })

  await scenario(9, 'A save fails before its ref update (500 on the tree): Retry commits at once', async (open) => {
    const A = await open('A9')
    const n0 = (await h.state()).requests
    await h.fault({ endpoint: 'createTree', device: 'A9', status: 500, times: 1 })
    await A.toggle('t-stamps01')
    await A.store((s) => s.remote.check())
    const failedSeen = await watch(A, (s) => s.kind === 'failed', 15_000)
    check('A shows "failed" after the 500 on the tree', (await st(A)).kind === 'failed', line(failedSeen))
    await sleep(1000)
    const retried = Date.now()
    await A.store((s) => s.retrySync())
    const seen = await watch(A, saved, 20_000)
    info(`A's states after Retry: ${line(seen)}`)
    const tree = (await reqsOf('A9', n0)).filter((r) => r.endpoint === 'createTree' && startOf(r) >= retried)[0]
    const wait = tree ? (startOf(tree) - retried) / 1000 : NaN
    info(`the retry's tree POST went ${wait.toFixed(1)} s after Retry`)
    check('nothing reached the branch, so Retry commits at once (within 3 s), not after a 10 s gap', wait < 3, { wait })
    check('A ends saved, with one commit on the branch', saved(await st(A)) && (await landed()).length === 1, { state: await st(A), commits: (await landed()).length })
  })

  section('hygiene')
  check('no request reached api.github.com', h.realGitHubHits.length === 0, h.realGitHubHits)
  check('no request reached an unhandled mock route', unknownRoutes === 0, unknownRoutes)
  check('no mock warnings', mockWarnings.length === 0, mockWarnings)
  check('no uncaught errors in any page', pageErrors.length === 0, pageErrors)
} catch (e) {
  failed = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok).length
console.log(
  bad || failed
    ? `\nFAILED: ${bad} of ${results.length} checks failed${failed ? ', run aborted' : ''} in ${since()}`
    : `\nPASSED: ${results.length}/${results.length} checks passed in ${since()}`,
)
process.exit(bad || failed ? 1 : 0)
