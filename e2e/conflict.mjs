#!/usr/bin/env node
// Conflict notice and Reconnect suite: problems 2 and 2b of the sync-fixes plan.
//
// 2. The conflict notice (a to-do changed here and on GitHub, or a list kept or dropped over a delete)
//    stands until the user dismisses it, whatever sync does meanwhile: the device going offline, an
//    edit made offline, a failed save and its Retry, a token replaced for the same repo. While offline
//    or failed, the band takes that word and the banner stays under it; the popover gives both
//    sentences, the band word's first. Dismissing while offline leaves the band on offline. The notice
//    isn't saved across reloads, and disconnecting clears it.
//    The band word, first match wins: offline, failed, conflict, demo, saving, saved.
//    The review states combine: ?sync=offline&sync=conflict and ?sync=failed&sync=conflict.
// 2b. A failure only a new token fixes (Reconnect) comes back once the device is online again, an
//    edit keeps it, and Reconnect opens setup with the pending changes kept.
//
// Not covered: connect() with a DIFFERENT repo clearing the notice. The mock serves one repo
// (test/data), so a second one can't be opened; disconnect() clearing it is checked instead.
//
// The checks read behaviour only: the store's sync and conflict notice (snapshot().conflict, which
// reads the same on the app before and after fix 2), localStorage, repo files, commits, request
// counters, and visible text: the band word, its Retry or Reconnect button, the popover's
// sentences, the banner and the row's conflict mark.
//
//   APP_DIR=/path/to/app APP_PORT=5620 MOCK_PORT=5621 node conflict.mjs     (about 2 min)
//   HEADED=1 to watch, VERBOSE=1 for mock, vite and console output.
// Every scenario starts from h.reset with fresh devices. Prints PASS/FAIL per check and a summary
// line; exits 1 on any failure.

import { deepStrictEqual } from 'node:assert'
import { APP, APP_PORT, REPO_KEY, listFile, sleep, startHarness, todoFile } from './harness.mjs'

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

const info = (t) => console.log(`      ${t}`)

const BANK = 't-bank0001'
const STAMPS = 't-stamps01'
const TAP = 't-tap00001'
const SEED = {
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile({ id: BANK, title: 'Call the bank', order: 1 }),
  'inbox/buy-stamps.md': todoFile({ id: STAMPS, title: 'Buy stamps', order: 2 }),
  'home/_list.md': listFile({ index: 2, name: 'Home', ink: 2 }),
  'home/fix-the-tap.md': todoFile({ id: TAP, title: 'Fix the tap', order: 1 }),
  'home/paint-the-door.md': todoFile({ id: 't-door0001', title: 'Paint the door', order: 2 }),
}
/** The notice a same-field conflict on "Call the bank" leaves: the to-do, and its file as on GitHub. */
const BANK_NOTICE = { id: BANK, path: 'inbox/call-the-bank.md' }

// The app's own words, as the popover says them.
const SAYS = {
  offline: "You're offline.",
  conflict: 'changed on GitHub and here at once',
  saved: 'Everything saved',
}

/** `first` and `then` are both in `text`, `first` before. */
function inOrder(text, first, then) {
  const i = text.indexOf(first)
  const j = text.indexOf(then)
  return i >= 0 && j >= 0 && i < j
}

/** The conflict sentence is in the popover, and nothing saved-or-saving comes before it. */
function conflictFirst(text) {
  const c = text.indexOf(SAYS.conflict)
  const s = Math.min(...[text.indexOf(SAYS.saved), text.indexOf('Saving ')].map((i) => (i < 0 ? Infinity : i)))
  return c >= 0 && c < s
}

/** What a page shows: the store's sync state and notice, the band, its popover, the banner, the row marks. */
async function view(page) {
  await sleep(150)
  return page.evaluate(() => {
    const s = window.__e2e.store
    const squash = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
    const band = document.querySelector('header.band')
    const word = band?.querySelector('[popovertarget="sync-details"]')
    const fix = [...(band?.querySelectorAll('button') ?? [])].filter((b) => !b.closest('#sync-details')).map((b) => squash(b.textContent)).find((t) => t === 'Retry' || t === 'Reconnect') ?? null
    const banner = document.querySelector('.conflict[role="alert"]')
    return {
      mode: s.mode,
      online: navigator.onLine,
      sync: JSON.parse(JSON.stringify(s.sync)),
      conflict: window.__e2e.conflict(),
      pending: s.pending.length,
      setupOpen: !!s.setupOpen,
      word: word ? squash(word.textContent) : null,
      alarm: !!band?.classList.contains('alarm'),
      fix,
      banner: banner ? squash(banner.textContent) : null,
      popover: squash(document.querySelector('#sync-details')?.textContent),
      marks: document.querySelectorAll('[title="Changed on GitHub and here at once"]').length,
      heading: squash(document.querySelector('h1')?.textContent),
    }
  })
}

let h
let aborted = false
const pageErrors = []
const demoHits = []
let strayRoutes = 0

/** Wait until the device's last commit is over 10 s old, so its next check commits at once. */
async function outOfGap(D) {
  const mine = (await h.commits()).filter((c) => c.by === D.name).at(-1)
  const wait = mine?.at ? Date.parse(mine.at) + 10_500 - Date.now() : 0
  if (wait > 0) await sleep(wait)
}

/** D holds a same-field conflict on "Call the bank": it edits the title offline, GitHub gets a later one, D comes back. */
async function makeConflict(D, n) {
  await D.offline(true)
  await D.edit(BANK, { title: `Call the bank (${D.name} ${n})` })
  await sleep(30)
  await h.externalCommit({ 'inbox/call-the-bank.md': todoFile({ id: BANK, title: `Call the bank (GitHub ${n})`, order: 1, updatedAt: new Date().toISOString() }) }, `Edit by hand ${n}`)
  await D.offline(false)
  await D.sync()
  return view(D.page)
}

/** Poll `fn(store)` in the page; resolves false instead of throwing when it never holds. */
async function holds(D, fn, timeout) {
  try {
    await D.waitFor(fn, null, { timeout })
    return true
  } catch {
    return false
  }
}

/** A scenario: reset the repo, open fresh devices through `open`, close them whatever happens. */
async function scenario(title, fn) {
  console.log(`\n== ${title}  [${since()}]`)
  const opened = []
  const open = async (name, opts) => {
    const d = await h.device(name, opts)
    opened.push(d)
    return d
  }
  try {
    await h.reset(SEED)
    await fn(open)
  } catch (e) {
    check(`${title.split('.')[0]}. the scenario ran to the end`, false, String(e.stack ?? e))
  } finally {
    const c = await h.counters().catch(() => null)
    strayRoutes += (c?.total.unknown ?? 0) + (c?.total.otherRepo ?? 0)
    for (const d of opened) {
      pageErrors.push(...d.errors.filter((e) => e.startsWith('pageerror')).map((e) => `${d.name} ${e}`))
      await d.close()
    }
  }
}

/** A device with no repo connected, on a review URL: its own context, with the store attached by hand. */
async function demoPage(browser, path, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  await context.route(/^https:\/\/api\.github\.com\//, (r) => {
    demoHits.push(r.request().url())
    r.abort('blockedbyclient')
  })
  await context.routeWebSocket((url) => url.port === String(APP_PORT), () => {})
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(`demo ${path} pageerror: ${e.message}`))
  await page.goto(`${APP}${path}`, { waitUntil: 'load' })
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/lib\/store\.svelte\.ts(?:\?|$)/.test(n))
    const u = new URL(url)
    const e2e = (window.__e2e = { store: (await import(u.pathname + u.search)).store })
    // As in harness.mjs: the notice on either app.
    e2e.conflict = () => {
      const s = e2e.store
      const c = s?.conflict ?? (s?.sync?.kind === 'conflict' ? s.sync : null)
      return c ? JSON.parse(JSON.stringify({ path: c.path, id: c.id, message: c.message })) : null
    }
  })
  const offline = async (on) => {
    await context.setOffline(on)
    await page.waitForFunction((v) => navigator.onLine === v, !on)
  }
  return { page, context, offline }
}

try {
  h = await startHarness()

  await scenario('0. The band without a notice: saving, then saved', async (open) => {
    const W = await open('W0')
    await W.edit(STAMPS, { title: 'Buy stamps today' })
    let v = await view(W.page)
    check('0a. an edit online: the band says "saving · 1 pending", no notice', v.sync.kind === 'saving' && v.word === 'saving · 1 pending' && !v.conflict && !v.banner, v)
    await W.sync()
    v = await view(W.page)
    check('0b. once committed: the band says "saved …" and the popover "Everything saved"', /^saved/.test(v.word ?? '') && v.popover.includes(SAYS.saved) && !v.banner, v)
  })

  await scenario('1. A conflict, then the device goes offline and back', async (open) => {
    const B = await open('B1')
    let v = await makeConflict(B, 1)
    check('1a. after the merge: the notice names the to-do and its file as on GitHub', same(v.conflict, BANK_NOTICE), v.conflict)
    check('1b. the banner names the file, and the row carries the conflict mark', /Conflict\./.test(v.banner ?? '') && v.banner.includes(BANK_NOTICE.path) && v.marks === 1, v)
    check('1c. the band word reads "conflict" (over saved); the popover gives the conflict first', v.word === 'conflict' && conflictFirst(v.popover), v)
    await B.offline(true)
    v = await view(B.page)
    info(`offline: word "${v.word}", banner ${v.banner ? 'shown' : 'GONE'}, sync ${JSON.stringify(v.sync)}, conflict ${JSON.stringify(v.conflict)}`)
    check('1d. offline: the notice stands', same(v.conflict, BANK_NOTICE), v)
    check('1e. offline: the banner and the row mark stay', !!v.banner && v.marks === 1, v)
    check('1f. offline: the band says "offline · 0 kept here" (offline over conflict)', v.sync.kind === 'offline' && v.word === 'offline · 0 kept here', v)
    check('1g. offline: the popover says offline first, then the conflict', inOrder(v.popover, SAYS.offline, SAYS.conflict), v.popover)
    await B.offline(false)
    await B.sync()
    v = await view(B.page)
    info(`back online: word "${v.word}", banner ${v.banner ? 'shown' : 'GONE'}`)
    check('1h. back online: the notice, the banner and the row mark are still there', same(v.conflict, BANK_NOTICE) && !!v.banner && v.marks === 1, v)
    check('1i. back online: the band word reads "conflict" again', v.word === 'conflict', v)
    await B.store((s) => s.dismissConflict())
    v = await view(B.page)
    check('1j. Dismiss clears it: no notice, no banner, no mark, and the band says saved', !v.conflict && !v.banner && v.marks === 0 && /^saved/.test(v.word ?? ''), v)
  })

  await scenario('2. A conflict, then an edit offline, then Dismiss while offline', async (open) => {
    const B = await open('B2')
    let v = await makeConflict(B, 2)
    check('2a. after the merge: the notice and its banner show', same(v.conflict, BANK_NOTICE) && !!v.banner, v)
    await B.offline(true)
    await B.edit(STAMPS, { title: 'Buy stamps today' })
    v = await view(B.page)
    info(`offline edit: word "${v.word}", banner ${v.banner ? 'shown' : 'GONE'}`)
    check('2b. an edit offline: the notice and its banner stand', same(v.conflict, BANK_NOTICE) && !!v.banner, v)
    check('2c. an edit offline: the band says "offline · 1 kept here"', v.word === 'offline · 1 kept here' && v.pending === 1, v)
    await B.store((s) => s.dismissConflict())
    v = await view(B.page)
    info(`dismissed offline: word "${v.word}", sync ${JSON.stringify(v.sync)}`)
    check('2d. Dismiss while offline: the notice and banner go', !v.conflict && !v.banner, v)
    check('2e. Dismiss while offline: the band stays on "offline · 1 kept here", not saving or saved', v.sync.kind === 'offline' && v.word === 'offline · 1 kept here', v)
    await B.offline(false)
    const b = await B.sync()
    v = await view(B.page)
    check('2f. back online: the edit is saved; the band says saved, with no notice', b.pending.length === 0 && /^saved/.test(v.word ?? '') && !v.conflict && !v.banner, v)
    const files = await h.repoFiles()
    check('2g. the offline edit reached the repo', /\ntitle: Buy stamps today\n/.test(files['inbox/buy-stamps-today.md'] ?? '') && !('inbox/buy-stamps.md' in files), Object.keys(files))
  })

  await scenario('3. A conflict, then a 500 on the save, then Retry', async (open) => {
    const B = await open('B3')
    let v = await makeConflict(B, 3)
    check('3a. after the merge: the notice and its banner show', same(v.conflict, BANK_NOTICE) && !!v.banner, v)
    await outOfGap(B)
    await h.fault({ endpoint: 'createTree', device: 'B3', status: 500, times: 1 })
    await B.edit(STAMPS, { title: 'Buy stamps, second class' })
    await B.store((s) => s.remote.check())
    if (!(await holds(B, (s) => s.sync.kind === 'failed', 15_000))) info('(never showed failed)')
    v = await view(B.page)
    info(`after a 500: word "${v.word}", alarm ${v.alarm}, button ${v.fix}, banner ${v.banner ? 'shown' : 'GONE'}`)
    check('3b. the save fails: the band turns to alarm, says "Sync failed · 1 kept here" and offers Retry (failed over conflict)', v.alarm && v.word === 'Sync failed · 1 kept here' && v.fix === 'Retry', v)
    check('3c. failed: the notice, its banner and the row mark stand', same(v.conflict, BANK_NOTICE) && !!v.banner && v.marks === 1, v)
    check('3d. failed: the popover gives the failure first, then the conflict', !!v.sync.message && inOrder(v.popover, v.sync.message, SAYS.conflict), v.popover)
    const retry = B.page.getByRole('button', { name: 'Retry', exact: true })
    if (await retry.count()) await retry.first().click()
    else await B.store((s) => s.retrySync())
    const b = await B.sync()
    v = await view(B.page)
    info(`after Retry: word "${v.word}", banner ${v.banner ? 'shown' : 'GONE'}`)
    const files = await h.repoFiles()
    check('3e. Retry saves the edit: nothing pending, the new title in the repo', b.pending.length === 0 && /\ntitle: Buy stamps, second class\n/.test(files['inbox/buy-stamps-second-class.md'] ?? ''), { pending: b.pending, files: Object.keys(files) })
    check('3f. after Retry: the notice and its banner are still there', same(v.conflict, BANK_NOTICE) && !!v.banner, v)
    check('3g. after Retry: the band word reads "conflict"', v.word === 'conflict' && !v.alarm && !v.fix, v)
  })

  await scenario('4. A list notice (a delete met a change here), then offline and back, then a reload', async (open) => {
    const B = await open('B4')
    await B.offline(true)
    await B.edit(TAP, { title: 'Fix the tap properly' })
    await h.externalCommit({ 'home/_list.md': null, 'home/fix-the-tap.md': null, 'home/paint-the-door.md': null }, 'Delete list Home by hand')
    await B.offline(false)
    await B.sync()
    let v = await view(B.page)
    const notice = v.conflict
    info(`list notice: ${JSON.stringify(notice)}`)
    check('4a. the list notice names home/ and says it was kept; the banner shows its words', notice?.path === 'home/' && /deleted on another device/.test(notice?.message ?? '') && !!v.banner?.includes(notice.message), v)
    check('4b. the band word reads "conflict"', v.word === 'conflict', v)
    await B.offline(true)
    v = await view(B.page)
    check('4c. offline: the list notice stands, in the store and on screen', !!notice && same(v.conflict, notice) && !!v.banner?.includes(notice.message), v)
    check('4d. offline: the band says offline', /^offline/.test(v.word ?? ''), v)
    check('4e. offline: the popover says offline first, then the notice', !!notice && inOrder(v.popover, SAYS.offline, notice.message), v.popover)
    await B.offline(false)
    await B.sync()
    v = await view(B.page)
    check('4f. back online: the list notice stands and the band word reads "conflict"', !!notice && same(v.conflict, notice) && !!v.banner && v.word === 'conflict', v)
    await B.reload()
    v = await view(B.page)
    check('4g. a reload drops the notice: it is not saved across reloads', !v.conflict && !v.banner && /^saved/.test(v.word ?? ''), v)
  })

  await scenario('5. A conflict over saving and saved, then a token replaced for the same repo, then disconnect', async (open) => {
    const B = await open('B5')
    let v = await makeConflict(B, 5)
    check('5a. after the merge: the notice and its banner show', same(v.conflict, BANK_NOTICE) && !!v.banner, v)
    await outOfGap(B)
    await B.edit(STAMPS, { title: 'Buy stamps today' })
    v = await view(B.page)
    check('5b. an edit online with the notice up: the band word reads "conflict" (over saving)', v.word === 'conflict' && v.pending === 1 && !!v.banner && conflictFirst(v.popover), v)
    const b = await B.sync()
    v = await view(B.page)
    check('5c. once saved: the band word still reads "conflict"', b.pending.length === 0 && v.word === 'conflict' && same(v.conflict, BANK_NOTICE), v)
    await B.store((s) => s.connect('test-token-B5', 'test/data', () => {}))
    await B.sync()
    v = await view(B.page)
    info(`after a token replace: word "${v.word}", banner ${v.banner ? 'shown' : 'GONE'}`)
    check('5d. a token replaced for the same repo keeps the notice and its banner', same(v.conflict, BANK_NOTICE) && !!v.banner, v)
    check('5e. ... and the band word reads "conflict"', v.word === 'conflict', v)
    await B.store((s) => s.disconnect())
    v = await view(B.page)
    check('5f. disconnecting clears the notice', v.mode === 'setup' && !v.conflict && !v.banner, v)
    info('not covered: connect() with a different repo, which the one-repo mock cannot serve')
  })

  await scenario('6. Review states and demo mode (a device with no repo connected)', async (open) => {
    const Z = await open('Z6')
    const browser = Z.context.browser()
    const phone = { width: 390, height: 760 }
    {
      const D = await demoPage(browser, '/?sync=conflict')
      let v = await view(D.page)
      check('6a. ?sync=conflict: the banner, and the band word "conflict" (over demo)', !!v.banner && v.word === 'conflict' && v.conflict?.path === 'home/fix-dripping-kitchen-tap.md', v)
      await D.offline(true)
      v = await view(D.page)
      info(`?sync=conflict offline: word "${v.word}", banner ${v.banner ? 'shown' : 'GONE'}`)
      check('6b. ?sync=conflict offline: the banner stays', !!v.banner && !!v.conflict, v)
      check('6c. ?sync=conflict offline: the band says offline (over conflict)', /^offline/.test(v.word ?? ''), v)
      await D.page.evaluate(() => window.__e2e.store.dismissConflict())
      v = await view(D.page)
      info(`?sync=conflict dismissed offline: word "${v.word}"`)
      check('6d. ?sync=conflict dismissed while offline: no banner, and the band stays on offline', !v.banner && !v.conflict && /^offline/.test(v.word ?? ''), v)
      await D.offline(false)
      await sleep(1800)
      v = await view(D.page)
      check('6e. back online: "demo data", no banner', v.word === 'demo data' && !v.banner, v)
      await D.context.close()
    }
    {
      const D = await demoPage(browser, '/?sync=offline')
      let v = await view(D.page)
      check('6f. ?sync=offline: pinned on "offline · 2 kept here", no banner', v.word === 'offline · 2 kept here' && !v.banner && !v.conflict, v)
      await D.offline(true)
      await D.offline(false)
      await sleep(1800)
      v = await view(D.page)
      check('6g. ?sync=offline stays pinned through offline and back', v.word === 'offline · 2 kept here', v)
      await D.context.close()
    }
    {
      const D = await demoPage(browser, '/?sync=failed')
      const v = await view(D.page)
      check('6h. ?sync=failed: alarm band, "Sync failed · 2 kept here", Retry, no banner', v.alarm && v.word === 'Sync failed · 2 kept here' && v.fix === 'Retry' && !v.banner && !v.conflict, v)
      await D.context.close()
    }
    for (const [label, viewport, words] of [
      ['desktop', undefined, { offline: 'offline · 2 kept here', failed: 'Sync failed · 2 kept here' }],
      ['phone', phone, { offline: 'offline', failed: 'not saved' }],
    ]) {
      {
        const D = await demoPage(browser, '/?sync=offline&sync=conflict', viewport)
        const v = await view(D.page)
        info(`?sync=offline&sync=conflict, ${label}: word "${v.word}", banner ${v.banner ? 'shown' : 'none'}`)
        check(`6i. ?sync=offline&sync=conflict, ${label}: the band says "${words.offline}"`, v.word === words.offline && !v.alarm, v)
        check(`6j. ?sync=offline&sync=conflict, ${label}: the banner shows under it`, !!v.banner && v.conflict?.path === 'home/fix-dripping-kitchen-tap.md', v)
        check(`6k. ?sync=offline&sync=conflict, ${label}: the popover says offline first, then the conflict`, inOrder(v.popover, SAYS.offline, SAYS.conflict), v.popover)
        await D.context.close()
      }
      {
        const D = await demoPage(browser, '/?sync=failed&sync=conflict', viewport)
        const v = await view(D.page)
        info(`?sync=failed&sync=conflict, ${label}: word "${v.word}", banner ${v.banner ? 'shown' : 'none'}`)
        check(`6l. ?sync=failed&sync=conflict, ${label}: alarm band, "${words.failed}", Retry`, v.alarm && v.word === words.failed && v.fix === 'Retry', v)
        check(`6m. ?sync=failed&sync=conflict, ${label}: the banner shows under it`, !!v.banner && v.conflict?.path === 'home/fix-dripping-kitchen-tap.md', v)
        check(`6n. ?sync=failed&sync=conflict, ${label}: the popover gives the failure first, then the conflict`, !!v.sync.message && inOrder(v.popover, v.sync.message, SAYS.conflict), v.popover)
        await D.context.close()
      }
    }
    {
      const D = await demoPage(browser, '/?demo')
      let v = await view(D.page)
      check('6o. ?demo: "demo data", no banner', v.word === 'demo data' && !v.banner, v)
      await D.page.evaluate(() => window.__e2e.store.add('Water the plants'))
      v = await view(D.page)
      check('6p. ?demo, an edit: the band still says "demo data" while it settles (demo over saving)', v.sync.kind === 'saving' && v.word === 'demo data', v)
      await D.offline(true)
      v = await view(D.page)
      check('6q. ?demo offline: the band says offline', /^offline/.test(v.word ?? ''), v)
      await D.offline(false)
      await sleep(1800)
      v = await view(D.page)
      check('6r. ?demo back online: "demo data"', v.word === 'demo data', v)
      await D.context.close()
    }
  })

  await scenario('7. Reconnect after going offline (2b): a refused token, then offline and back', async (open) => {
    const R = await open('R7')
    const trees = async () => (await h.counters()).byDevice.R7?.createTree ?? 0
    await h.fault({ endpoint: 'createTree', device: 'R7', status: 401, times: 1 })
    await R.edit(STAMPS, { title: 'Buy stamps today' })
    await R.store((s) => s.remote.check())
    if (!(await holds(R, (s) => s.sync.kind === 'failed', 15_000))) info('(never showed failed)')
    let v = await view(R.page)
    check('7a. a 401 on the save: alarm band, "Sync failed · 1 kept here", and Reconnect', v.alarm && v.word === 'Sync failed · 1 kept here' && v.fix === 'Reconnect' && v.sync.fix === 'reconnect', v)
    await R.offline(true)
    v = await view(R.page)
    check('7b. offline: the band says "offline · 1 kept here" (offline over failed)', v.word === 'offline · 1 kept here' && !v.alarm && !v.fix, v)
    await R.offline(false)
    await holds(R, (s) => s.sync.kind === 'failed', 3000)
    v = await view(R.page)
    info(`back online: word "${v.word}", sync ${JSON.stringify(v.sync)}`)
    check('7c. back online: Reconnect is back, with the alarm band and "Sync failed · 1 kept here"', v.sync.kind === 'failed' && v.sync.fix === 'reconnect' && v.alarm && v.word === 'Sync failed · 1 kept here' && v.fix === 'Reconnect', v)
    await R.edit(BANK, { title: 'Call the bank today' })
    v = await view(R.page)
    info(`an edit: word "${v.word}", sync ${JSON.stringify(v.sync)}`)
    check('7d. an edit back online keeps it failed: "Sync failed · 2 kept here", Reconnect', v.sync.kind === 'failed' && v.alarm && v.word === 'Sync failed · 2 kept here' && v.fix === 'Reconnect', v)
    await sleep(2500)
    check('7e. no save is tried with the refused token: one tree request in all', (await trees()) === 1, await h.counters())
    const reconnect = R.page.getByRole('button', { name: 'Reconnect', exact: true })
    const offered = (await reconnect.count()) > 0
    if (offered) await reconnect.first().click()
    v = await view(R.page)
    check("7f. Reconnect opens setup, to replace this device's token", offered && v.setupOpen && /Replace this device.s token/.test(v.heading), { offered, setupOpen: v.setupOpen, heading: v.heading })
    const stored = await R.page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.pending?.length ?? null, REPO_KEY)
    check('7g. the 2 pending changes are kept, on the device and in localStorage', v.pending === 2 && stored === 2, { pending: v.pending, stored })
    await R.store((s) => s.connect('test-token-R7', 'test/data', () => {}))
    const r = await R.sync()
    v = await view(R.page)
    const files = await h.repoFiles()
    const last = (await h.commits()).at(-1)
    check(
      '7h. a new token for the same repo saves both kept changes in one commit; the band says saved',
      r.pending.length === 0 && last.by === 'R7' && last.changed.length === 4 && /\ntitle: Buy stamps today\n/.test(files['inbox/buy-stamps-today.md'] ?? '') && /\ntitle: Call the bank today\n/.test(files['inbox/call-the-bank-today.md'] ?? '') && /^saved/.test(v.word ?? '') && !v.fix,
      { pending: r.pending, last, word: v.word },
    )
  })

  console.log(`\n== hygiene  [${since()}]`)
  check('nothing reached api.github.com', h.realGitHubHits.length === 0 && demoHits.length === 0, { devices: h.realGitHubHits, demo: demoHits })
  check('no request reached an unhandled mock route', strayRoutes === 0, strayRoutes)
  check('no uncaught errors in any page', pageErrors.length === 0, pageErrors)
} catch (e) {
  aborted = true
  console.log(`FAIL  the run stopped: ${e.stack ?? e}`)
} finally {
  await h?.stop()
}

const bad = results.filter((r) => !r.ok)
const n = results.length
console.log(
  bad.length || aborted
    ? `\nFAILED: ${bad.length} of ${n} checks failed${aborted ? ', run aborted' : ''} in ${since()}`
    : `\nPASSED: ${n}/${n} checks passed in ${since()}`,
)
process.exit(bad.length || aborted ? 1 : 0)
