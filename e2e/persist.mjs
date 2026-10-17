#!/usr/bin/env node
// Persist suite (sync fix plan, problems 1 and 1b): a change made just before the page goes away
// survives, and a new connection is saved under its repo's name.
//
//   APP_DIR=/path/to/app APP_PORT=5610 MOCK_PORT=5611 node persist.mjs
//   (HEADED=1 to watch, VERBOSE=1 for mock, vite and console output; about 40 s)
//
// Every scenario starts from h.reset. "In localStorage" is read at the start of the next document,
// before the reloaded app's own code runs (an init script), so it is what the page left behind.
//
//   - control: an add left 400 ms before a reload is kept (true before the fix too: proves the method)
//   - each action kind (add, check off, edit title, move, reschedule, delete a to-do, rename a list,
//     delete a list, add a list), then an immediate reload: the change and its pending entry are in
//     localStorage, and in the repo after a sync. After the add, the reloaded app shows the to-do.
//   - a tab closed right after an add, with and without runBeforeUnload
//   - hidden, then the renderer killed (Page.crash): the iOS "swiped away" pattern
//   - demo mode (no connection): an add right before a reload
//   - two tabs: a clean tab hiding leaves REPO_KEY byte-identical; a dirty tab hiding writes at once
//   - a held list delete is still released when the page is hidden, with its undo still on offer
//   - 1b: connect from the setup screen, reload at once: REPO_KEY's repo is test/data and the reopen
//     reads no tree
//   - INFO only, not required: a crash while visible within 300 ms of an edit, and two tabs where the
//     last to save wins (add X in A, close A at once, edit in B, reopen)
//
// Prints PASS/FAIL per check, then "PASSED: n/n checks passed in Xs" or "FAILED: k of n checks
// failed in Xs", and exits 1 on any failure.

import { APP, CONNECTION_KEY, REPO_KEY, listFile, sleep, startHarness, todoFile } from './harness.mjs'

const DEMO_KEY = 'gh-todo:v1'

const t0 = Date.now()
const results = []
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, '\n      ')}`)
}

const info = (name, text) => console.log(`INFO  ${name}: ${text}`)

function section(title) {
  console.log(`\n== ${title}  [${since()}]`)
}

const SEED = {
  'README.md': '# To Do data\n\nTest repo.\n',
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank', order: 1 }),
  'inbox/buy-stamps.md': todoFile({ id: 't-stamps01', title: 'Buy stamps', order: 2 }),
  'work/_list.md': listFile({ index: 2, name: 'Work', ink: 2 }),
  'work/send-the-report.md': todoFile({ id: 't-report01', listId: 'work', title: 'Send the report', order: 1 }),
}

// ---- helpers ----------------------------------------------------------------------------------

/** Runs at the start of every document in a context, before the app: what localStorage holds then. */
function recordLeft(keys) {
  window.__left = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, localStorage.getItem(key)]))
}

const parse = (s) => {
  try {
    return JSON.parse(s ?? 'null')
  } catch {
    return null
  }
}

/** What the page before this one left in localStorage, parsed, plus the raw strings. */
async function left(page) {
  const raw = await page.evaluate(() => window.__left ?? null)
  if (!raw) throw new Error('no record of localStorage at the start of this document')
  return { raw, repo: parse(raw.repo), demo: parse(raw.demo), connection: parse(raw.connection) }
}

const rawItem = (page, key) => page.evaluate((k) => localStorage.getItem(k), key)
const hasTitle = (saved, title) => !!saved?.todos?.some((t) => t.title === title)
/** A short account of a saved state, for a failure's detail: the last few to-dos and lists. */
const brief = (saved) => {
  if (!saved) return saved
  const last = (xs, f) => (xs ? [...(xs.length > 6 ? [`(${xs.length - 6} more)`] : []), ...xs.slice(-6).map(f)] : xs)
  return {
    repo: saved.repo,
    todos: last(saved.todos, (t) => `${t.id} ${t.listId} ${t.title}${t.done ? ' (done)' : ''}${t.due ? ` due ${t.due}` : ''}`),
    lists: last(saved.lists, (l) => `${l.id} ${l.name}`),
    pending: saved.pending?.map((c) => `${c.kind} ${c.id}`),
  }
}

/** The paths of to-do files with this id. */
const todoPaths = (files, id) => Object.keys(files).filter((p) => !p.endsWith('/_list.md') && new RegExp(`^id: ${id}$`, 'm').test(files[p]))
const fileOf = (files, id) => {
  const paths = todoPaths(files, id)
  return paths.length === 1 ? { path: paths[0], text: files[paths[0]] } : null
}

async function waitUntil(fn, timeout, every = 100) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await fn()) return true
    if (Date.now() > deadline) return false
    await sleep(every)
  }
}

/** Pretend the page went to the background: the app's listeners read document.visibilityState. */
async function hide(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** Kill the renderer with no unload event at all (an OS kill, an out-of-memory, a crash). */
async function crash(page) {
  const cdp = await page.context().newCDPSession(page)
  const crashed = page.waitForEvent('crash', { timeout: 10_000 })
  void cdp.send('Page.crash').catch(() => {}) // never answers: the renderer is gone
  await crashed
  await sleep(200)
}

async function closeTab(page, runBeforeUnload = false) {
  const closed = page.waitForEvent('close', { timeout: 10_000 })
  await page.close({ runBeforeUnload })
  await closed
}

/** Is this text on screen? Waits up to `timeout` for it. */
const shown = (page, text, timeout = 3000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout }).then(
    () => true,
    () => false,
  )

const pageErrors = []
const extraPages = []

/** A new tab in the same context (same localStorage), loaded but not touched. */
async function reopen(context) {
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(`extra tab: ${e.message}`))
  extraPages.push(page)
  await page.goto(`${APP}/`, { waitUntil: 'load' })
  return page
}

/** Wait until a tab opened with reopen() has finished its first exchange with the mock and gone quiet. */
async function settled(page) {
  await page.waitForFunction(() => window.__e2e && window.__e2e.ended >= 1 && window.__e2e.inflight === 0 && Date.now() - window.__e2e.lastActivity > 500, null, {
    timeout: 20_000,
    polling: 100,
  })
}

/** The app's store in a tab opened with reopen(), proven to be the instance on screen (as the harness does). */
async function storeIn(page) {
  const probe = await page.evaluate(async () => {
    const urls = [...new Set(performance.getEntriesByType('resource').map((r) => r.name))].filter((n) => /\/src\/lib\/store\.svelte\.ts(?:\?|$)/.test(n))
    if (!urls.length) return 'no store module URL'
    const u = new URL(urls[0])
    const { store } = await import(u.pathname + u.search)
    const before = store.announcement
    const mark = `e2e-probe-${Math.random().toString(36).slice(2)}`
    store.announcement = mark
    await new Promise((r) => setTimeout(r, 30))
    const same = [...document.querySelectorAll('[aria-live="polite"]')].some((el) => el.textContent.includes(mark))
    store.announcement = before
    window.__tab = store
    return same ? 'same-instance' : 'DIFFERENT-INSTANCE'
  })
  if (probe !== 'same-instance') throw new Error(`the second tab's store: ${probe}`)
}

// ---- the actions ------------------------------------------------------------------------------

// `act` runs in the page as source text: literals only.
const ACTIONS = [
  {
    label: 'add',
    act: (s) => void s.add('Captured then reloaded'),
    saved: (r) => {
      const t = r.todos.find((x) => x.title === 'Captured then reloaded')
      return !!t && r.pending.some((c) => c.id === t.id && c.kind !== 'list')
    },
    committed: (f) => Object.keys(f).some((p) => p.startsWith('inbox/') && /^title: Captured then reloaded$/m.test(f[p])),
  },
  {
    label: 'check off',
    act: (s) => s.toggle('t-bank0001'),
    saved: (r) => r.todos.find((t) => t.id === 't-bank0001')?.done === true && r.pending.some((c) => c.id === 't-bank0001'),
    committed: (f) => /^done: true$/m.test(fileOf(f, 't-bank0001')?.text ?? ''),
  },
  {
    label: 'edit title',
    act: (s) => s.update('t-stamps01', { title: 'Buy stamps today' }),
    saved: (r) => r.todos.find((t) => t.id === 't-stamps01')?.title === 'Buy stamps today' && r.pending.some((c) => c.id === 't-stamps01'),
    committed: (f) => /^title: Buy stamps today$/m.test(fileOf(f, 't-stamps01')?.text ?? ''),
  },
  {
    label: 'move',
    act: (s) => s.move('t-stamps01', 'work'),
    saved: (r) => r.todos.find((t) => t.id === 't-stamps01')?.listId === 'work' && r.pending.some((c) => c.id === 't-stamps01'),
    committed: (f) => !!fileOf(f, 't-stamps01')?.path.startsWith('work/'),
  },
  {
    label: 'reschedule',
    act: (s) => s.reschedule('t-bank0001', '2026-11-02'),
    saved: (r) => r.todos.find((t) => t.id === 't-bank0001')?.due === '2026-11-02' && r.pending.some((c) => c.id === 't-bank0001'),
    committed: (f) => /^due: 2026-11-02$/m.test(fileOf(f, 't-bank0001')?.text ?? ''),
  },
  {
    label: 'delete a to-do',
    act: (s) => s.remove('t-report01'),
    saved: (r) => !r.todos.some((t) => t.id === 't-report01') && r.pending.some((c) => c.id === 't-report01' && c.kind === 'removed'),
    committed: (f) => todoPaths(f, 't-report01').length === 0 && 'work/_list.md' in f,
  },
  {
    label: 'rename a list',
    act: (s) => s.renameList('work', 'Office'),
    saved: (r) => r.lists.find((l) => l.id === 'work')?.name === 'Office' && r.pending.some((c) => c.kind === 'list' && c.id === 'work'),
    committed: (f) => /^name: Office$/m.test(f['work/_list.md'] ?? ''),
  },
  {
    label: 'delete a list',
    act: (s) => s.deleteList('work'),
    saved: (r) =>
      !r.lists.some((l) => l.id === 'work') &&
      !r.todos.some((t) => t.listId === 'work') &&
      r.pending.some((c) => c.kind === 'list' && c.id === 'work') &&
      r.pending.some((c) => c.id === 't-report01'),
    committed: (f) => !Object.keys(f).some((p) => p.startsWith('work/')) && 'inbox/_list.md' in f,
  },
  {
    label: 'add a list',
    act: (s) => void s.addList('Errands'),
    saved: (r) => {
      const l = r.lists.find((x) => x.name === 'Errands')
      return !!l && r.pending.some((c) => c.kind === 'list' && c.id === l.id)
    },
    committed: (f) => Object.keys(f).some((p) => /^[^/]+\/_list\.md$/.test(p) && /^name: Errands$/m.test(f[p])),
  },
]

// ---- the run ----------------------------------------------------------------------------------

let h
let aborted = false
const devices = []
let live = []
let unhandled = {}

async function open(name, opts) {
  const d = await h.device(name, opts)
  devices.push(d)
  live.push(d)
  await d.context.addInitScript(recordLeft, { repo: REPO_KEY, demo: DEMO_KEY, connection: CONNECTION_KEY })
  return d
}

async function scenario(title, fn) {
  section(title)
  await h.reset(SEED)
  try {
    await fn()
  } catch (e) {
    check(`${title}: the scenario ran to the end`, false, e.stack ?? String(e))
  } finally {
    const c = await h.counters()
    for (const k of ['unknown', 'otherRepo']) if (c.total[k]) unhandled[k] = (unhandled[k] ?? 0) + c.total[k]
    for (const d of live) await d.close().catch(() => {})
    live = []
  }
}

try {
  section('start')
  h = await startHarness()

  await scenario('control: add, wait 400 ms, reload', async () => {
    const d = await open('A')
    await d.add('Control after 400 ms')
    await sleep(400)
    await d.reload({ ready: 'none' })
    const { repo } = await left(d.page)
    check('control: a to-do left 400 ms before a reload is in localStorage', hasTitle(repo, 'Control after 400 ms'), brief(repo))
  })

  for (const a of ACTIONS) {
    await scenario(`"${a.label}", then an immediate reload`, async () => {
      const d = await open('A')
      await d.store(a.act)
      await d.reload({ ready: 'none' })
      const { repo } = await left(d.page)
      check(`reload right after "${a.label}": the change and its pending entry are in localStorage`, !!repo && a.saved(repo), brief(repo))
      if (a.label === 'add') {
        const kept = await d.store((s) => s.todos.some((t) => t.title === 'Captured then reloaded'))
        check('add, reload at once: the to-do is kept (in the reloaded app and on screen)', kept && (await shown(d.page, 'Captured then reloaded')), { inStore: kept })
      }
      await d.sync()
      const files = await h.repoFiles()
      check(`reload right after "${a.label}": the change is in the repo after a sync`, a.committed(files), Object.keys(files))
    })
  }

  for (const runBeforeUnload of [false, true]) {
    await scenario(`a tab closed right after an add (runBeforeUnload ${runBeforeUnload})`, async () => {
      const d = await open('B')
      const title = `Closed at once ${runBeforeUnload ? 'with' : 'without'} beforeunload`
      await d.add(title)
      await closeTab(d.page, runBeforeUnload)
      const page = await reopen(d.context)
      const { repo } = await left(page)
      check(`tab closed right after an add (runBeforeUnload ${runBeforeUnload}): the to-do is in localStorage`, hasTitle(repo, title), brief(repo))
    })
  }

  await scenario('hidden, then the renderer killed (no pagehide)', async () => {
    const d = await open('K')
    await d.add('Captured then app switched')
    await hide(d.page)
    await crash(d.page)
    const page = await reopen(d.context)
    const { repo } = await left(page)
    check('hidden then killed right after an add: the to-do is in localStorage', hasTitle(repo, 'Captured then app switched'), brief(repo))
  })

  await scenario('the renderer dies while visible (no event at all)', async () => {
    const d = await open('V')
    await d.add('Captured then crashed')
    await crash(d.page)
    const page = await reopen(d.context)
    const { repo } = await left(page)
    info('crash while visible within 300 ms of an add', hasTitle(repo, 'Captured then crashed') ? 'kept' : 'lost (out of scope: only a write in the same task as the edit covers it)')
  })

  await scenario('demo mode: add, then an immediate reload', async () => {
    const d = await open('D', { connection: false, path: '/?demo', ready: 'none' })
    const mode = await d.store((s) => s.mode)
    await d.add('Demo captured then reloaded')
    await d.reload({ ready: 'none' })
    const { demo } = await left(d.page)
    check(`demo: a to-do added right before a reload is in localStorage (mode ${mode})`, mode === 'demo' && hasTitle(demo, 'Demo captured then reloaded'), brief(demo))
    const kept = await d.store((s) => s.mode === 'demo' && s.todos.some((t) => t.title === 'Demo captured then reloaded'))
    check('demo: the reloaded demo shows it', kept && (await shown(d.page, 'Demo captured then reloaded')), { inStore: kept })
  })

  await scenario('two tabs on one device', async () => {
    const e = await open('E')
    const tab2 = await reopen(e.context) // opened before the edits: its memory lacks them
    await settled(tab2)
    await e.offline(true) // both tabs: no commit or pull can write localStorage from here on
    await e.add('Made in tab 1')
    await sleep(400) // tab 1's own 300 ms save has run
    const before = await rawItem(e.page, REPO_KEY)
    // localStorage reaches another tab asynchronously: wait until tab 2 reads the same bytes.
    const synced = await waitUntil(async () => (await rawItem(tab2, REPO_KEY)) === before, 3000)
    await hide(tab2)
    await tab2.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
    await sleep(100)
    const after2 = await rawItem(tab2, REPO_KEY) // tab 2's own write, if any, shows here at once
    await sleep(200)
    const after1 = await rawItem(e.page, REPO_KEY)
    check(
      'two tabs: a clean tab hiding (visibilitychange and pagehide) leaves REPO_KEY byte-identical',
      synced && before === after2 && before === after1 && hasTitle(parse(before), 'Made in tab 1'),
      { synced, sameInTab2: before === after2, sameInTab1: before === after1, after2: brief(parse(after2)) },
    )
    await e.add('Second in tab 1')
    await hide(e.page)
    const now = parse(await rawItem(e.page, REPO_KEY))
    check('two tabs: a dirty tab hiding writes its change in localStorage at once', hasTitle(now, 'Second in tab 1'), brief(now))
  })

  await scenario('two tabs, the last to save wins (informational)', async () => {
    const f = await open('F')
    const tab2 = await reopen(f.context)
    await settled(tab2)
    await storeIn(tab2)
    await f.add('Residual X')
    await closeTab(f.page)
    await tab2.evaluate(() => window.__tab.toggle('t-bank0001'))
    await sleep(500) // tab 2's 300 ms save, from a memory without X
    const page = await reopen(f.context)
    const { repo } = await left(page)
    info('add X in tab A, close A at once, edit in tab B, reopen', hasTitle(repo, 'Residual X') ? 'X kept' : 'X lost: tab B saved over it (known, PRODUCT.md: several tabs, last to save wins)')
  })

  await scenario('a held list delete is released when the page is hidden', async () => {
    const d = await open('L')
    await d.store((s) => s.deleteList('work'))
    const undo = d.page.getByRole('button', { name: /^Undo/ })
    await undo.hover() // a pointer over the toast pauses its 8 s timer, so only the hide can release the hold
    await sleep(3000)
    let files = await h.repoFiles()
    const held = Object.keys(files).some((p) => p.startsWith('work/'))
    check('held list delete: 3 s later, with its undo on offer, nothing is committed', held && (await undo.isVisible()), Object.keys(files))
    const t = Date.now()
    await hide(d.page)
    const gone = await waitUntil(async () => !Object.keys(await h.repoFiles()).some((p) => p.startsWith('work/')), 15_000, 200)
    const ms = Date.now() - t
    check('held list delete: hiding the page releases it (committed in under 15 s, not 30), the undo still on offer', gone && (await undo.isVisible()), { gone, ms })
    if (gone) console.log(`      info: committed ${ms} ms after the hide`)
  })

  await scenario('1b: connect from the setup screen, then reload at once', async () => {
    // The harness can't attach to the setup screen (its own live region fails the same-instance probe).
    // So the device opens on the demo, drops it, goes to the first-run setup screen and is driven
    // through that screen's form alone; the harness attaches again after the reload.
    const c = await open('C', { connection: false, path: '/?demo', ready: 'none' })
    await c.page.evaluate((k) => localStorage.removeItem(k), DEMO_KEY)
    await c.page.goto(`${APP}/`, { waitUntil: 'load' })
    const onSetup = await shown(c.page, 'Connect To Do to GitHub')
    await c.page.getByLabel('Repo', { exact: true }).fill('test/data')
    await c.page.getByLabel('Token', { exact: true }).fill('test-token-C')
    await c.page.getByRole('button', { name: 'Connect', exact: true }).click()
    // connect() saves the connection and the repo in one synchronous run, so once one is there, both are.
    await c.page.waitForFunction((k) => !!JSON.parse(localStorage.getItem(k) ?? 'null')?.token, CONNECTION_KEY, { timeout: 20_000, polling: 'raf' })
    const treesBefore = (await h.counters()).byDevice.C?.getTree ?? 0
    await c.reload({ ready: 'checked' })
    const l = await left(c.page)
    const conn = l.connection
    check(
      '1b: the setup screen connected and saved the connection',
      onSetup && conn?.token === 'test-token-C' && conn?.owner === 'test' && conn?.repo === 'data' && conn?.branch === 'master',
      { onSetup, connection: conn && { ...conn, token: conn.token === 'test-token-C' ? 'test-token-C' : '(other)' } },
    )
    check("1b: reload at once after connecting: REPO_KEY's repo is test/data", l.repo?.repo === 'test/data', brief(l.repo))
    await c.sync()
    const treesAfter = (await h.counters()).byDevice.C?.getTree ?? 0
    check('1b: the reopen reads no tree (per-device counters)', treesBefore >= 1 && treesAfter === treesBefore, { getTreeAtConnect: treesBefore, getTreeAfterReopen: treesAfter })
    const snap = await c.snapshot()
    check("1b: the reopened app shows the repo's to-dos", ['t-bank0001', 't-report01', 't-stamps01'].every((id) => snap.todos.some((t) => t.id === id)), snap.todos)
  })

  section('hygiene')
  check('no request reached an unhandled mock route', !Object.keys(unhandled).length, unhandled)
  check('nothing tried to reach api.github.com', h.realGitHubHits.length === 0, h.realGitHubHits)
  const errors = [...devices.flatMap((d) => d.errors.filter((e) => e.startsWith('pageerror')).map((e) => `${d.name} ${e}`)), ...pageErrors]
  check('no uncaught errors in any page', errors.length === 0, errors)
} catch (e) {
  aborted = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok).length + (aborted ? 1 : 0)
const total = results.length + (aborted ? 1 : 0)
console.log(bad ? `\nFAILED: ${bad} of ${total} checks failed in ${since()}${aborted ? ' (run aborted)' : ''}` : `\nPASSED: ${total}/${total} checks passed in ${since()}`)
process.exit(bad ? 1 : 0)
