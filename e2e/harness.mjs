// End-to-end harness for the To Do app's GitHub sync: an in-memory GitHub (mock-github.mjs), the
// app's own Vite dev server pointed at it, and simulated devices (one Chrome context each).
//
//   const h = await startHarness()
//   await h.reset({ 'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }) })
//   const a = await h.device('A')
//   await a.store((s) => s.add('Buy milk'))
//   await a.sync()
//   console.log(await h.repoFiles(), await h.commits())
//   await h.stop()
//
// See README.md for the helper API and the timing gotchas.

import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startMock } from './mock-github.mjs'

/** The app: this folder's parent, unless APP_DIR points at a copy. */
export const APP_DIR = process.env.APP_DIR ?? fileURLToPath(new URL('..', import.meta.url))
export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const MOCK_PORT = Number(process.env.MOCK_PORT ?? 5299)
export const APP_PORT = Number(process.env.APP_PORT ?? 5298)
export const API = `http://localhost:${MOCK_PORT}`
export const APP = `http://localhost:${APP_PORT}`
export const CONNECTION_KEY = 'gh-todo:github'
export const REPO_KEY = 'gh-todo:repo:v1'
/** Dummy tokens only. The mock tells devices apart by what follows this prefix. */
export const TOKEN_PREFIX = 'test-token-'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- the data repo's file format (a copy of writeTodo / writeList in src/lib/repo.ts) ----------

const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/

function scalar(value, inFlow = false) {
  const plain =
    value.length > 0 &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value) &&
    !/:\s|:$|\s#/.test(value) &&
    !(inFlow && /[,[\]{}]/.test(value)) &&
    !RESERVED.test(value) &&
    !/^[-+]?\.?\d/.test(value)
  return plain ? value : JSON.stringify(value)
}

function stamp(value, pattern) {
  if (value === null || value === undefined) return 'null'
  return pattern.test(value) ? value : JSON.stringify(value)
}

/** A to-do file, as the app writes it. Missing fields get the app's defaults. */
export function todoFile(t) {
  const created = t.createdAt ?? '2026-10-01T09:00:00.000Z'
  const lines = [
    '---',
    `id: ${scalar(t.id)}`,
    `title: ${scalar(t.title)}`,
    `tags: [${(t.tags ?? []).map((tag) => scalar(tag, true)).join(', ')}]`,
    `due: ${stamp(t.due ?? null, DAY)}`,
    `done: ${!!t.done}`,
    `doneAt: ${stamp(t.doneAt ?? null, STAMP)}`,
    `order: ${Number.isFinite(t.order) ? t.order : 0}`,
    `createdAt: ${stamp(created, STAMP)}`,
    `updatedAt: ${stamp(t.updatedAt ?? created, STAMP)}`,
    '---',
  ]
  const note = (t.note ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  return lines.join('\n') + '\n' + (note ? `\n${note}\n` : '')
}

/** A list's `_list.md`, as the app writes it. */
export function listFile(l) {
  return ['---', `index: ${l.index}`, `name: ${scalar(l.name)}`, `ink: ${l.ink}`, '---', ''].join('\n')
}

/** A copy of slugify in src/lib/repo.ts, for expected file names. */
export function slugify(text) {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'untitled'
  )
}

// ---- processes ------------------------------------------------------------------------------

function portInUse(port) {
  return new Promise((resolve) => {
    const s = connect({ port, host: 'localhost' })
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

async function waitFor(what, fn, { timeout = 30_000, every = 150 } = {}) {
  const deadline = Date.now() + timeout
  let last
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`)
    await sleep(every)
  }
}

// ---- in-page instrumentation -----------------------------------------------------------------

/**
 * Runs before the app on every load: seeds the connection (only when absent, so reloads keep the
 * device's state) and wraps fetch to count the app's requests to the API.
 */
function initScript({ key, connection, api }) {
  try {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(connection))
  } catch {}
  const e2e = (window.__e2e = { started: 0, inflight: 0, ended: 0, refStarted: 0, lastStatus: null, lastActivity: Date.now(), cycles: 0, log: [], store: null })
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(api)) return original(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    const rec = { n: ++e2e.started, method, path: url.slice(api.length), at: Date.now(), status: null, ms: 0 }
    if (method === 'GET' && /\/git\/ref\/heads\//.test(url)) e2e.refStarted = rec.n
    e2e.inflight++
    e2e.lastActivity = Date.now()
    e2e.log.push(rec)
    if (e2e.log.length > 1000) e2e.log.shift()
    try {
      const res = await original(input, init)
      rec.status = res.status
      return res
    } catch (err) {
      rec.status = 'network-error'
      throw err
    } finally {
      rec.ms = Date.now() - rec.at
      e2e.inflight--
      e2e.ended++
      e2e.lastStatus = rec.status
      e2e.lastActivity = Date.now()
    }
  }
}

/**
 * After load: import the store module at the exact URL the app loaded it from (so it is the app's
 * own singleton), prove that by writing to it and reading the DOM, and hook `remote.lastCheckedAt`
 * so the harness can count finished sync cycles.
 */
async function attachScript() {
  const e2e = window.__e2e
  const urls = [...new Set(performance.getEntriesByType('resource').map((r) => r.name))].filter((n) => /\/src\/lib\/store\.svelte\.ts(?:\?|$)/.test(n))
  const url = urls.length ? new URL(urls[0]).pathname + new URL(urls[0]).search : '/src/lib/store.svelte.ts'
  const { store } = await import(url)
  e2e.store = store
  e2e.storeUrls = urls

  // Same instance as the screen? Write a probe into the live region's state and look for it.
  let probe = 'no-live-region'
  const regions = () => [...document.querySelectorAll('[aria-live="polite"]')]
  if (regions().length && 'announcement' in store) {
    const before = store.announcement
    const mark = `e2e-probe-${Math.random().toString(36).slice(2)}`
    store.announcement = mark
    await new Promise((r) => setTimeout(r, 30))
    probe = regions().some((el) => el.textContent.includes(mark)) ? 'same-instance' : 'DIFFERENT-INSTANCE'
    store.announcement = before
  }

  // Count finished cycles: `lastCheckedAt` is set once at the end of every successful sync cycle.
  let hook = 'ok'
  const remote = store.remote
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(remote), 'lastCheckedAt')
  if (!remote.__e2eHooked && d?.get && d?.set) {
    Object.defineProperty(remote, 'lastCheckedAt', {
      configurable: true,
      enumerable: true,
      get() {
        return d.get.call(this)
      },
      set(v) {
        d.set.call(this, v)
        if (v !== null) e2e.cycles++
      },
    })
    remote.__e2eHooked = true
  } else if (!remote.__e2eHooked) {
    hook = 'missing: Remote.prototype has no lastCheckedAt accessor'
  }
  return { url, urls, probe, hook, mode: store.mode }
}

function snapshotScript(full) {
  const s = window.__e2e.store
  const plain = (x) => JSON.parse(JSON.stringify(x ?? null))
  const lists = [...s.lists].sort((a, b) => a.index - b.index).map((l) => (full ? plain(l) : { id: l.id, index: l.index, name: l.name, ink: l.ink }))
  const todos = [...s.todos]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => (full ? plain(t) : { id: t.id, listId: t.listId, title: t.title, done: t.done }))
  return {
    mode: s.mode,
    online: navigator.onLine,
    lists,
    todos,
    pending: s.pending.map((c) => ({ kind: c.kind, id: c.id, title: c.title, path: c.path, seq: c.seq })),
    sync: plain(s.sync),
    head: s.remote.base?.head ?? null,
    lastCheckedAt: s.remote.lastCheckedAt,
  }
}

// ---- the harness ----------------------------------------------------------------------------

/**
 * Start the mock GitHub (5299), the app's dev server (5298, VITE_GITHUB_API pointing at the mock)
 * and Chrome. `hmr: false` (default) mutes Vite's HMR socket in every device, so an edit to the
 * app's source mid-test can't hot-swap a second store into a running page.
 */
export async function startHarness({ headless = process.env.HEADED ? false : true, verbose = !!process.env.VERBOSE, hmr = false, appDir = APP_DIR } = {}) {
  const log = (...a) => verbose && console.log('[harness]', ...a)
  for (const port of [MOCK_PORT, APP_PORT]) if (await portInUse(port)) throw new Error(`Port ${port} is already in use; stop whatever listens there first.`)

  const mock = await startMock({ port: MOCK_PORT, origins: [APP, `http://127.0.0.1:${APP_PORT}`], log: verbose })
  log('mock on', mock.url)

  let vite = null
  let viteOut = ''
  let browser = null
  const devices = new Set()
  const realGitHubHits = []
  let stopped = false

  const killVite = (signal = 'SIGTERM') => {
    if (vite && vite.exitCode === null && vite.signalCode === null) {
      try {
        process.kill(-vite.pid, signal)
      } catch {
        try {
          vite.kill(signal)
        } catch {}
      }
    }
  }
  const onExit = () => killVite('SIGKILL')
  process.once('exit', onExit)
  const onSignal = (sig) => {
    killVite('SIGKILL')
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  async function stop() {
    if (stopped) return
    stopped = true
    for (const d of [...devices]) await d.close().catch(() => {})
    await browser?.close().catch(() => {})
    if (vite && vite.exitCode === null && vite.signalCode === null) {
      const exited = new Promise((resolve) => vite.once('exit', resolve))
      killVite('SIGTERM')
      await Promise.race([exited, sleep(5000)])
      killVite('SIGKILL')
    }
    await mock.close()
    process.off('exit', onExit)
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    log('stopped')
  }

  try {
    vite = spawn('./node_modules/.bin/vite', ['--port', String(APP_PORT), '--strictPort'], {
      cwd: appDir,
      env: { ...process.env, VITE_GITHUB_API: API, BROWSER: 'none', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    vite.stdout.on('data', (b) => {
      viteOut += b
      if (verbose) process.stdout.write(`[vite] ${b}`)
    })
    vite.stderr.on('data', (b) => {
      viteOut += b
      if (verbose) process.stderr.write(`[vite] ${b}`)
    })
    let viteExit = null
    vite.once('exit', (code, sig) => (viteExit = `exited (${code ?? sig})`))
    await waitFor(
      `the dev server on ${APP}`,
      async () => {
        if (viteExit) throw new Error(`vite ${viteExit}:\n${viteOut}`)
        const res = await fetch(`${APP}/`)
        const html = await res.text()
        if (!res.ok) return false
        // The dev CSP lists the mock's origin only when VITE_GITHUB_API reached the config.
        if (!html.includes(`connect-src https://api.github.com 'self' ws: wss: ${API}`))
          throw new Error(`the dev server's CSP doesn't list ${API}; VITE_GITHUB_API didn't reach vite.config.ts`)
        return true
      },
      { timeout: 60_000 },
    )
    log('vite on', APP)

    browser = await chromium.launch({ executablePath: CHROME, headless })
    // Warm up: let Vite transform the modules (and optimise deps) once, outside any test device.
    {
      const ctx = await browser.newContext({ serviceWorkers: 'block' })
      await ctx.route(/^https:\/\/api\.github\.com\//, (r) => r.abort('blockedbyclient'))
      const p = await ctx.newPage()
      await p.goto(`${APP}/?e2e-warmup`, { waitUntil: 'networkidle' })
      await ctx.close()
    }
  } catch (e) {
    await stop()
    throw e
  }

  // ---- control API ----

  async function control(method, path, body) {
    const res = await fetch(`${mock.url}/__control/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`control ${method} ${path}: ${res.status} ${data.message}`)
    return data
  }

  const h = {
    mock,
    appUrl: APP,
    apiUrl: API,
    realGitHubHits,
    /** Replace the repo with these files ({path: content}) in one seed commit; null for an empty repo. Clears counters, faults and logs. */
    reset: (files, message) => control('POST', 'reset', { files, message }),
    /** {path: content} at the branch head (or at `ref`). */
    repoFiles: (ref) => control('GET', `files${ref ? `?ref=${ref}` : ''}`),
    /** First-parent history, oldest first: {sha, message, parents, changed, changes, by, at}. `{all: true}` adds commits never on the branch. */
    commits: ({ all = false } = {}) => control('GET', `commits${all ? '?all=1' : ''}`),
    state: () => control('GET', 'state'),
    counters: () => control('GET', 'counters'),
    resetCounters: () => control('POST', 'counters/reset'),
    /** Request log ({n, method, path, endpoint, device, status, note}); `since` is a request number. */
    requests: (since = 0) => control('GET', `log?since=${since}`),
    warnings: () => control('GET', 'warnings'),
    /** {endpoint, device?, method?, status?, message?, headers?, delayMs?, hold?, after?, times?} -> {id} */
    fault: (spec) => control('POST', 'fault', spec),
    clearFaults: (id) => control('DELETE', `fault${id ? `?id=${id}` : ''}`),
    held: () => control('GET', 'held'),
    release: (filter = {}) => control('POST', 'release', filter),
    /** Wait until a request matching {endpoint, device} is parked by a `hold` fault. */
    waitHeld: (filter = {}, timeout = 30_000) =>
      waitFor(
        `a held ${filter.endpoint ?? ''} request${filter.device ? ` from ${filter.device}` : ''}`,
        async () => {
          const held = await control('GET', 'held')
          return held.find((x) => (!filter.endpoint || x.endpoint === filter.endpoint) && (!filter.device || x.device === filter.device))
        },
        { timeout, every: 100 },
      ),
    /** A commit made outside the app (a hand edit on github.com): {path: content | null}. */
    externalCommit: (files, message = 'Edit by hand') => control('POST', 'commit', { files, message }),
    device: (name, opts) => openDevice(name, opts),
    stop,
  }

  // ---- devices ----

  async function openDevice(name, { connection, path = '/', viewport = { width: 1280, height: 900 }, ready = 'checked', timeout = 30_000 } = {}) {
    const conn = connection ?? { token: `${TOKEN_PREFIX}${name}`, owner: 'test', repo: 'data', branch: 'master' }
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    // Belt and braces: nothing reaches the real GitHub.
    await context.route(/^https:\/\/api\.github\.com\//, (route) => {
      realGitHubHits.push({ device: name, url: route.request().url() })
      route.abort('blockedbyclient')
    })
    if (!hmr) await context.routeWebSocket((url) => url.port === String(APP_PORT), () => {})
    await context.addInitScript(initScript, { key: CONNECTION_KEY, connection: conn, api: API })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`)
      if (verbose) console.log(`[${name}] ${m.type()}: ${m.text()}`)
    })

    let attached = null
    async function attach() {
      attached = await page.evaluate(attachScript)
      if (attached.probe === 'DIFFERENT-INSTANCE') throw new Error(`${name}: the imported store is not the one on screen (${attached.urls.join(', ')})`)
      if (attached.urls.length > 1) errors.push(`warning: several store module URLs loaded: ${attached.urls.join(', ')}`)
      if (ready === 'checked') {
        await waitFor(
          `${name}'s first sync check`,
          () => page.evaluate(() => {
            const s = window.__e2e.store
            if (s.sync.kind === 'failed') throw new Error(s.sync.message)
            return s.mode === 'connected' && (s.remote.lastCheckedAt !== null || !navigator.onLine)
          }),
          { timeout, every: 100 },
        )
      }
      log(`${name} ready`, attached)
    }

    const state = () =>
      page.evaluate(() => {
        const e = window.__e2e
        const s = e.store
        return {
          cycles: e.cycles,
          started: e.started,
          inflight: e.inflight,
          ended: e.ended,
          quietFor: Date.now() - e.lastActivity,
          lastStatus: e.lastStatus,
          pending: s.pending.length,
          kind: s.sync.kind,
          message: s.sync.message ?? null,
          online: navigator.onLine,
        }
      })

    const dev = {
      name,
      token: conn.token,
      page,
      context,
      errors,
      get attached() {
        return attached
      },
      /** Run `fn(store, arg)` in the page against the app's store; returns a JSON copy of the result. `fn` can't close over Node variables. */
      store: (fn, arg) =>
        page.evaluate(`(async () => {
          const store = window.__e2e.store
          const out = await (${fn.toString()})(store, ${JSON.stringify(arg ?? null)})
          return out === undefined ? null : JSON.parse(JSON.stringify(out))
        })()`),
      /** Lists, to-dos and pending changes (sorted, so two devices compare with deepEqual). `{full: true}` for every field. */
      snapshot: ({ full = false } = {}) => page.evaluate(snapshotScript, full),
      state,
      /** The app's API requests seen in the page: {n, method, path, status, ms}. */
      requests: () => page.evaluate(() => window.__e2e.log),

      add: (text, listId) => dev.store((s, [t, l]) => s.add(t, l ?? undefined), [text, listId ?? null]),
      toggle: (id) => dev.store((s, i) => s.toggle(i), id),
      edit: (id, patch) => dev.store((s, [i, p]) => s.update(i, p), [id, patch]),
      remove: (id) => dev.store((s, i) => s.remove(i), id),
      todo: (match) =>
        dev.store((s, m) => s.todos.find((t) => t.id === m || t.title === m) ?? null, match),

      /**
       * Ask GitHub now and wait until this device has nothing pending and no cycle running.
       * A check with pending changes commits at once (no 1.5 s settle) unless the device committed
       * less than 10 s ago; then it waits for the gap, like the app does.
       */
      async sync({ timeout = 60_000, allowFailed = false } = {}) {
        const deadline = Date.now() + timeout
        let phase = 'kick' // kick -> cycle -> [pending -> kick -> cycle]
        let base = 0
        let silent = 0
        let st
        for (;;) {
          if (phase === 'kick') {
            const k = await page.evaluate(() => {
              const e = window.__e2e
              const before = e.refStarted
              const cycles = e.cycles
              if (navigator.onLine) e.store.remote.check()
              // A free engine reads the branch synchronously inside check(); a busy one ignores it.
              return { kicked: e.refStarted > before, cycles }
            })
            if (k.kicked) {
              phase = 'cycle'
              base = k.cycles
            }
          }
          st = await state()
          if (!st.online) throw new Error(`${name}.sync(): the device is offline`)
          if (st.kind === 'failed') {
            if (allowFailed) return dev.snapshot()
            throw new Error(`${name}.sync(): sync failed: ${st.message}`)
          }
          if (phase === 'cycle') {
            if (st.cycles > base) {
              if (st.pending === 0 && st.inflight === 0) return dev.snapshot()
              phase = 'pending'
            } else if (st.inflight === 0 && st.quietFor > 3000) {
              // The cycle ended without finishing (a quiet failure: a 5xx or network error with nothing to save).
              if (++silent >= 3) throw new Error(`${name}.sync(): three cycles in a row ended without finishing (last status ${st.lastStatus})`)
              phase = 'kick'
            }
          } else if (phase === 'pending' && st.pending === 0 && st.inflight === 0) {
            phase = 'kick'
          }
          if (Date.now() > deadline) throw new Error(`${name}.sync(): timed out in phase ${phase}: ${JSON.stringify(st)}`)
          await sleep(phase === 'kick' ? 150 : 100)
        }
      },

      /** Wait without asking for anything until nothing is pending and no request is in flight. */
      async waitSaved({ timeout = 60_000 } = {}) {
        await waitFor(`${name} to save`, async () => {
          const st = await state()
          if (st.kind === 'failed') throw new Error(st.message)
          return st.pending === 0 && st.inflight === 0 && st.kind !== 'saving'
        }, { timeout, every: 100 })
        return dev.snapshot()
      },

      /** Wait for `fn(store, arg)` to return something truthy. */
      waitFor: (fn, arg, { timeout = 30_000, what = 'a condition' } = {}) => waitFor(`${name}: ${what}`, () => dev.store(fn, arg), { timeout, every: 100 }),

      /** Go offline or online (Chrome flips navigator.onLine and fires the events). */
      async offline(on = true) {
        await context.setOffline(on)
        await waitFor(`${name} navigator.onLine === ${!on}`, () => page.evaluate((v) => navigator.onLine === v, !on), { timeout: 5000, every: 50 })
      },

      /** Reload the page (localStorage stays), then re-attach. Needs the device online: the dev server serves the page. */
      async reload({ ready: r = ready } = {}) {
        await page.reload({ waitUntil: 'load' })
        const prev = ready
        ready = r
        try {
          await attach()
        } finally {
          ready = prev
        }
        return dev.snapshot()
      },

      /** localStorage, parsed: {connection, repo}. */
      storage: () =>
        page.evaluate(([ck, rk]) => ({ connection: JSON.parse(localStorage.getItem(ck) ?? 'null'), repo: JSON.parse(localStorage.getItem(rk) ?? 'null') }), [CONNECTION_KEY, REPO_KEY]),

      async close() {
        devices.delete(dev)
        await context.close().catch(() => {})
      },
    }

    await page.goto(`${APP}${path}`, { waitUntil: 'load' })
    await attach()
    devices.add(dev)
    return dev
  }

  return h
}
