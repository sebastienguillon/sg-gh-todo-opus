#!/usr/bin/env node
// Reproductions of app sync behaviours found while building the harness (not part of the smoke).
//   node probes.mjs
// Each probe prints what the app did; "CONFIRMED" marks the behaviour described in README.md.

import { listFile, sleep, startHarness, todoFile } from './harness.mjs'

const SEED = {
  'inbox/_list.md': listFile({ index: 1, name: 'Inbox', ink: 1 }),
  'inbox/call-the-bank.md': todoFile({ id: 't-bank0001', title: 'Call the bank', order: 1 }),
  'inbox/buy-stamps.md': todoFile({ id: 't-stamps01', title: 'Buy stamps', order: 2 }),
}
const say = (ok, text) => console.log(`${ok ? 'CONFIRMED' : 'not seen '}  ${text}`)

const h = await startHarness()
try {
  await h.reset(SEED)
  const A = await h.device('A')
  const B = await h.device('B')

  console.log('\n-- 1. An edit then a reload within 300 ms (the store saves to localStorage 300 ms after an edit; nothing flushes on pagehide)')
  await A.add('Captured then closed')
  await A.reload()
  let a = await A.snapshot()
  const kept = a.todos.some((x) => x.title === 'Captured then closed')
  say(!kept && a.pending.length === 0, `the to-do is ${kept ? 'kept' : 'gone'} after the reload, with ${a.pending.length} pending change(s)`)

  console.log('\n-- 2. A conflict notice is wiped when the device goes offline before it is dismissed')
  await A.offline(true)
  await B.offline(true)
  await A.edit('t-bank0001', { title: 'Call the bank today' })
  await sleep(30)
  await B.edit('t-bank0001', { title: 'Call the bank now' })
  await A.offline(false)
  await A.sync()
  await B.offline(false)
  let b = await B.sync()
  // The banner is snapshot.conflict; the band word follows it unless offline or failed.
  const shows = (x) => (x.conflict ? 'conflict' : x.sync.kind)
  const had = shows(b)
  await B.offline(true)
  await B.offline(false)
  b = await B.sync()
  say(had === 'conflict' && !b.conflict, `B showed "${had}", went offline and back, now shows "${shows(b)}" (never dismissed)`)

  console.log('\n-- 3. The ref moved but the answer was lost (502 after the write)')
  await A.sync()
  await sleep(10_500) // out of A's commit gap
  const before = (await h.commits()).length
  await h.fault({ endpoint: 'patchRef', device: 'A', after: true, status: 502, times: 1 })
  await A.toggle('t-stamps01')
  a = await A.sync({ allowFailed: true })
  const landed = (await h.commits()).length - before
  console.log(`           A shows "${a.sync.kind}" with ${a.pending.length} pending, though ${landed} commit landed; retrying...`)
  await A.store((s) => s.remote.retry())
  a = await A.sync()
  say(a.pending.length === 0 && (await h.commits()).length - before === 1, `after retry: "${a.sync.kind}", ${a.pending.length} pending, ${(await h.commits()).length - before} commit in all (no duplicate): handled well`)

  console.log('\n-- 4. A ref read staler than what the device last saw (a lagging replica) rolls the device back until the next read')
  await B.sync()
  await B.edit('t-stamps01', { title: 'Buy stamps by Friday' })
  await B.sync()
  await A.sync()
  const good = (await A.snapshot()).head
  await h.fault({ endpoint: 'getRef', device: 'A', lag: 2, times: 1 })
  await A.store((s) => s.remote.check())
  await sleep(2500)
  a = await A.snapshot()
  const title = a.todos.find((x) => x.id === 't-stamps01').title
  say(a.head !== good && title !== 'Buy stamps by Friday', `after one stale read A's head is ${a.head === good ? 'current' : 'an older commit'} and the title reads "${title}"`)
  await A.sync()
  a = await A.snapshot()
  console.log(`           after the next read: head ${a.head === good ? 'current' : 'still old'}, title "${a.todos.find((x) => x.id === 't-stamps01').title}"`)

  console.log('\n-- 5. The stored ETag lags: the first read after a reload is a 200, not a 304')
  const n0 = (await h.state()).requests
  await A.reload()
  const first = (await h.requests(n0)).find((r) => r.device === 'A' && r.endpoint === 'getRef')
  say(first?.status === 200, `first branch read after the reload answered ${first?.status}`)
} finally {
  await h.stop()
}
