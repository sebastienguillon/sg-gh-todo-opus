#!/usr/bin/env node
// Smoke test: two devices against the mock GitHub, through the app's real sync code.
//   node smoke.mjs            (HEADED=1 to watch, VERBOSE=1 for mock, vite and console output)
// Prints PASS/FAIL per check and exits non-zero on any failure.

import { deepStrictEqual } from 'node:assert'
import { listFile, slugify, startHarness, todoFile } from './harness.mjs'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

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

function section(title) {
  console.log(`\n== ${title}  [${since()}]`)
}

/** Lists and to-dos with every field: what two converged devices must agree on. */
const model = (snap) => ({ lists: snap.lists, todos: snap.todos })

/** GraphQL oids and REST blob reads one device made since request number `n`. */
async function blobReads(h, device, n) {
  const reqs = (await h.requests(n)).filter((r) => r.device === device)
  const oids = reqs.filter((r) => r.endpoint === 'graphql').reduce((sum, r) => sum + Number(/(\d+) oids/.exec(r.note ?? '')?.[1] ?? 0), 0)
  return { oids, rest: reqs.filter((r) => r.endpoint === 'getBlob').length }
}

const SEED_TODOS = [
  { id: 't-bank0001', listId: 'inbox', title: 'Call the bank', order: 1 },
  { id: 't-stamps01', listId: 'inbox', title: 'Buy stamps', order: 2 },
  { id: 't-report01', listId: 'work', title: 'Send the report', order: 1 },
]
const SEED = {
  'README.md': '# To Do data\n\nTest repo.\n',
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile(SEED_TODOS[0]),
  'inbox/buy-stamps.md': todoFile(SEED_TODOS[1]),
  'work/_list.md': listFile({ index: 2, name: 'Work', ink: 2 }),
  'work/send-the-report.md': todoFile(SEED_TODOS[2]),
}

let h
let failed = false
try {
  section('start')
  h = await startHarness()
  await h.reset(SEED)
  const A = await h.device('A')
  const B = await h.device('B')
  console.log(`      started mock, dev server, Chrome and two devices in ${since()}`)

  check('A: the store imported by the harness is the one on screen', A.attached.probe === 'same-instance' && A.attached.hook === 'ok', A.attached)
  check('B: the store imported by the harness is the one on screen', B.attached.probe === 'same-instance' && B.attached.hook === 'ok', B.attached)

  // ---- 1. first read ----
  section('1. both devices read the seeded repo')
  let a = await A.snapshot()
  let b = await B.snapshot()
  const seedLists = [
    { id: 'inbox', index: 1, name: 'Inbox', ink: 1 },
    { id: 'work', index: 2, name: 'Work', ink: 2 },
  ]
  const seedTodos = SEED_TODOS.map(({ id, listId, title }) => ({ id, listId, title, done: false })).sort((x, y) => x.id.localeCompare(y.id))
  check('A sees the two seeded lists', same(a.lists, seedLists), a.lists)
  check('A sees the three seeded to-dos', same(a.todos, seedTodos), a.todos)
  check('B sees the same lists and to-dos as A', same(model(a), model(b)), { a: model(a), b: model(b) })
  check('neither device has pending changes after the first read', a.pending.length === 0 && b.pending.length === 0, { a: a.pending, b: b.pending })
  const store = await A.storage()
  check('A keeps the dummy connection in localStorage', store.connection?.token === 'test-token-A' && store.connection?.branch === 'master', store.connection)

  // ---- 2. add and check off on A ----
  section('2. A adds a to-do and checks one off; B pulls')
  const milk = await A.add('Buy milk')
  await A.toggle('t-bank0001')
  a = await A.snapshot()
  check('A records two pending changes', same(a.pending.map((c) => c.kind), ['added', 'done']), a.pending)
  let t = Date.now()
  a = await A.sync()
  console.log(`      A.sync() took ${Date.now() - t} ms`)
  check('A has nothing pending after sync, and shows saved', a.pending.length === 0 && a.sync.kind === 'saved', { pending: a.pending, sync: a.sync })

  let commits = await h.commits()
  let last = commits.at(-1)
  check('one new commit on master', commits.length === 2, commits.map((c) => c.message))
  check('the commit message lists both changes', last.message === '2 changes\n\n- Add “Buy milk”\n- Check off “Call the bank”', last.message)
  check('the commit touches exactly the two to-do files', same(last.changed, ['inbox/buy-milk.md', 'inbox/call-the-bank.md']), last.changed)
  check('the commit was made by A, on the seed commit', last.by === 'A' && last.parents[0] === commits[0].sha, last)
  check('A now reads the new head', a.head === last.sha, { head: a.head, sha: last.sha })

  let files = await h.repoFiles()
  const milkFull = await A.todo(milk.id)
  const bankFull = await A.todo('t-bank0001')
  check('inbox/buy-milk.md is written in the app format', files['inbox/buy-milk.md'] === todoFile(milkFull), { got: files['inbox/buy-milk.md'], want: todoFile(milkFull) })
  check('the new to-do went to Inbox with the next order', milkFull.listId === 'inbox' && milkFull.order === 3, milkFull)
  check('inbox/call-the-bank.md says done, with doneAt', /\ndone: true\n/.test(files['inbox/call-the-bank.md'] ?? '') && files['inbox/call-the-bank.md'] === todoFile(bankFull), files['inbox/call-the-bank.md'])
  check('the other files are untouched', ['README.md', 'inbox/_list.md', 'inbox/buy-stamps.md', 'work/_list.md', 'work/send-the-report.md'].every((p) => files[p] === SEED[p]))

  let n0 = (await h.state()).requests
  b = await B.sync()
  const bReads = await blobReads(h, 'B', n0)
  check('B sees the new to-do and the checked-off one', same(model(b), model(await A.snapshot())), { a: model(await A.snapshot()), b: model(b) })
  check('B fetched only the two changed files', bReads.oids === 2 && bReads.rest === 0, bReads)
  check('B has nothing pending', b.pending.length === 0, b.pending)

  // ---- 3. offline edits to different to-dos ----
  section('3. both offline, each edits a different to-do, then both sync')
  await A.offline(true)
  await B.offline(true)
  await A.edit('t-stamps01', { title: 'Buy stamps and envelopes' })
  await B.edit('t-report01', { note: 'Draft attached' })
  a = await A.snapshot()
  b = await B.snapshot()
  check('A shows offline with one pending change', a.sync.kind === 'offline' && a.pending.length === 1, { sync: a.sync, pending: a.pending })
  check('B shows offline with one pending change', b.sync.kind === 'offline' && b.pending.length === 1, { sync: b.sync, pending: b.pending })

  t = Date.now()
  await A.offline(false)
  a = await A.sync()
  console.log(`      A online + sync took ${Date.now() - t} ms (the 10 s gap after its last commit applies)`)
  await B.offline(false)
  n0 = (await h.state()).requests
  b = await B.sync()
  const bPull = await blobReads(h, 'B', n0)
  n0 = (await h.state()).requests
  a = await A.sync()
  const aPull = await blobReads(h, 'A', n0)

  a = await A.snapshot({ full: true })
  b = await B.snapshot({ full: true })
  check('A and B converge (every field of every list and to-do)', same(model(a), model(b)), { a: model(a), b: model(b) })
  check('both have nothing pending', a.pending.length === 0 && b.pending.length === 0, { a: a.pending, b: b.pending })
  const stamps = a.todos.find((x) => x.id === 't-stamps01')
  const report = a.todos.find((x) => x.id === 't-report01')
  check('both edits survive', stamps?.title === 'Buy stamps and envelopes' && report?.note === 'Draft attached', { stamps, report })
  files = await h.repoFiles()
  check('the renamed to-do moved to inbox/buy-stamps-and-envelopes.md', !('inbox/buy-stamps.md' in files) && files['inbox/buy-stamps-and-envelopes.md'] === todoFile(stamps), Object.keys(files))
  check('the note is the body of work/send-the-report.md', files['work/send-the-report.md'] === todoFile(report) && files['work/send-the-report.md'].endsWith('---\n\nDraft attached\n'), files['work/send-the-report.md'])
  commits = await h.commits()
  check('two more commits, one per device', same(commits.slice(-2).map((c) => [c.by, c.message]), [['A', 'Edit “Buy stamps and envelopes”'], ['B', 'Edit “Send the report”']]), commits.map((c) => [c.by, c.message]))
  check("A's rename commit deletes the old file and adds the new one", same(commits.at(-2).changes, { added: ['inbox/buy-stamps-and-envelopes.md'], modified: [], deleted: ['inbox/buy-stamps.md'] }), commits.at(-2).changes)
  check("B's commit changes only the report", same(commits.at(-1).changed, ['work/send-the-report.md']), commits.at(-1).changed)
  check('B pulled one file to take in A\'s commit', bPull.oids === 1 && bPull.rest === 0, bPull)
  check("A pulled only B's file: its own blob ids matched the repo's (git-correct blobSha)", aPull.oids === 1 && aPull.rest === 0, aPull)

  // ---- 4. same-field conflict ----
  section('4. same field edited on both devices: conflict on the device that merges second')
  await A.offline(true)
  await B.offline(true)
  await A.edit(milk.id, { title: 'Buy oat milk' })
  await new Promise((r) => setTimeout(r, 50))
  await B.edit(milk.id, { title: 'Buy almond milk' }) // later updatedAt: B's title wins
  await A.offline(false)
  a = await A.sync()
  check('A committed its title first', (await h.commits()).at(-1).message === 'Edit “Buy oat milk”', (await h.commits()).at(-1).message)
  await B.offline(false)
  b = await B.sync()
  check('B, merging second, shows the conflict for that to-do', b.sync.kind === 'conflict' && b.sync.id === milk.id, b.sync)
  check('the conflict names the file as it is on GitHub', b.sync.path === 'inbox/buy-oat-milk.md', b.sync.path)
  a = await A.sync()
  check('A, which had nothing pending, shows no conflict', a.sync.kind === 'saved', a.sync)
  a = await A.snapshot({ full: true })
  b = await B.snapshot({ full: true })
  check('A and B converge after the conflict', same(model(a), model(b)), { a: model(a), b: model(b) })
  check('the later edit (B) wins the title', a.todos.find((x) => x.id === milk.id)?.title === 'Buy almond milk', a.todos.find((x) => x.id === milk.id))
  files = await h.repoFiles()
  check('the repo holds inbox/buy-almond-milk.md and no other milk file', 'inbox/buy-almond-milk.md' in files && Object.keys(files).filter((p) => p.includes('milk')).length === 1, Object.keys(files))
  commits = await h.commits()
  check('B committed the winning title on top of A', commits.at(-1).by === 'B' && commits.at(-1).message === 'Edit “Buy almond milk”' && commits.at(-1).parents[0] === commits.at(-2).sha, commits.slice(-2).map((c) => [c.by, c.message]))
  await B.store((s) => s.dismissConflict())
  b = await B.snapshot()
  check('dismissing the conflict on B returns it to saved', b.sync.kind === 'saved', b.sync)

  // ---- 5. a race: A's ref update held while B commits ----
  section("5. race: A's ref update is held in flight while B commits; A must re-read, merge and retry")
  await h.fault({ endpoint: 'patchRef', device: 'A', hold: true, times: 1 })
  await A.toggle('t-stamps01')
  await B.toggle('t-bank0001')
  const aSync = A.sync({ timeout: 90_000 })
  const heldReq = await h.waitHeld({ endpoint: 'patchRef', device: 'A' }, 40_000)
  check("A's ref update is parked by the mock", !!heldReq, heldReq)
  b = await B.sync()
  check('B commits while A waits', (await h.commits()).at(-1).message === 'Reopen “Call the bank”', (await h.commits()).at(-1).message)
  await h.release({ endpoint: 'patchRef', device: 'A' })
  a = await aSync
  b = await B.sync()
  const counters = await h.counters()
  check("the mock refused A's first ref update as not a fast-forward", counters.status['patchRef 422'] === 1, counters.status)
  commits = await h.commits()
  const all = await h.commits({ all: true })
  check('A retried on top of B: B then A on master', same(commits.slice(-2).map((c) => [c.by, c.message]), [['B', 'Reopen “Call the bank”'], ['A', 'Check off “Buy stamps and envelopes”']]) && commits.at(-1).parents[0] === commits.at(-2).sha, commits.slice(-2).map((c) => [c.by, c.message, c.parents[0]?.slice(0, 7), c.sha.slice(0, 7)]))
  check("A's refused commit is left off the branch", all.filter((c) => !c.onBranch).length === 1 && all.find((c) => !c.onBranch)?.by === 'A', all.map((c) => [c.by, c.message, c.onBranch]))
  a = await A.snapshot({ full: true })
  b = await B.snapshot({ full: true })
  check('A and B converge after the race', same(model(a), model(b)), { a: model(a), b: model(b) })
  check('both race edits are kept', a.todos.find((x) => x.id === 't-stamps01')?.done === true && a.todos.find((x) => x.id === 't-bank0001')?.done === false)
  check('A is saved, with nothing pending', a.sync.kind === 'saved' && a.pending.length === 0, { sync: a.sync, pending: a.pending })

  // ---- 6. the whole repo, and the run's hygiene ----
  section('6. final repo and hygiene')
  files = await h.repoFiles()
  const want = { 'README.md': SEED['README.md'], 'inbox/_list.md': SEED['inbox/_list.md'], 'work/_list.md': SEED['work/_list.md'] }
  for (const x of a.todos) want[`${x.listId}/${slugify(x.title)}.md`] = todoFile(x)
  check('the repo is exactly the devices\' lists and to-dos, in the app format', same(files, want), { files: Object.keys(files), want: Object.keys(want) })
  n0 = (await h.state()).requests
  await A.reload()
  const afterReload = (await h.requests(n0)).filter((r) => r.device === 'A' && r.endpoint !== 'preflight')
  check(
    'A reload keeps its state (localStorage) and fetches no files',
    same(model(await A.snapshot({ full: true })), model(a)) && !afterReload.some((r) => ['getTree', 'graphql', 'getBlob'].includes(r.endpoint)),
    afterReload.map((r) => `${r.endpoint} ${r.status}`),
  )
  console.log(`      info: after the reload A's first branch read answered ${afterReload.find((r) => r.endpoint === 'getRef')?.status} (304 would mean the stored ETag was current)`)
  check('ETag polling answered 304s', (counters.status['getRef 304'] ?? 0) > 0, counters.status)
  check('no request reached an unhandled mock route', !counters.total.unknown && !counters.total.otherRepo, counters.total)
  check('no tree entry deleted a path missing from its base tree', (await h.warnings()).length === 0, await h.warnings())
  check('nothing tried to reach api.github.com', h.realGitHubHits.length === 0, h.realGitHubHits)
  const pageErrors = [...A.errors, ...B.errors].filter((e) => e.startsWith('pageerror'))
  check('no uncaught errors in either page', pageErrors.length === 0, pageErrors)
  // Chrome logs every 4xx; the one 422 is the refused ref update of the race, expected.
  const notes = [...A.errors.map((e) => `A ${e}`), ...B.errors.map((e) => `B ${e}`)].filter((e) => !e.includes('pageerror'))
  const unexpected = notes.filter((e) => !/status of 422/.test(e))
  check('the only console error is the race\'s expected 422', notes.length - unexpected.length === 1, notes)
  if (unexpected.length) console.log(`      info: other console output (not failures):\n      ${unexpected.join('\n      ')}`)
} catch (e) {
  failed = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${bad.length || failed ? 'FAILED' : 'PASSED'}: ${results.length - bad.length}/${results.length} checks passed${failed ? ', run aborted' : ''} in ${since()}`)
process.exit(bad.length || failed ? 1 : 0)
