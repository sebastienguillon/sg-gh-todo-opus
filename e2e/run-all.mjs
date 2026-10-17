// Run every suite at once, each with its own mock and dev server ports, and report.
//
//   node run-all.mjs              every suite
//   node run-all.mjs smoke stale  only these
//
// Each suite's output goes to logs/<suite>.log. Exits 1 if any suite fails.

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const KNOWN = ['smoke', 'delete-multi-1', 'delete-multi-2', 'delete-single', 'persist', 'conflict', 'etag', 'stale', 'sync-faults']
const here = fileURLToPath(new URL('.', import.meta.url))
// Ports stay tied to a suite's place in KNOWN, so a missing suite doesn't shift the others.
const SUITES = KNOWN.filter((s) => existsSync(`${here}${s}.mjs`))
const wanted = process.argv.slice(2)
const suites = wanted.length ? SUITES.filter((s) => wanted.includes(s)) : SUITES
const unknown = wanted.filter((s) => !SUITES.includes(s))
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(', ')}. Known: ${SUITES.join(', ')}`)
  process.exit(2)
}
mkdirSync(`${here}logs`, { recursive: true })

const started = Date.now()
const results = await Promise.all(
  suites.map(
    (name, i) =>
      new Promise((resolve) => {
        const port = 5500 + KNOWN.indexOf(name) * 10
        const log = createWriteStream(`${here}logs/${name}.log`)
        const child = spawn(process.execPath, [`${name}.mjs`], {
          cwd: here,
          env: { ...process.env, APP_PORT: String(port), MOCK_PORT: String(port + 1) },
        })
        let tail = ''
        const keep = (chunk) => {
          log.write(chunk)
          tail = (tail + chunk).slice(-4000)
        }
        child.stdout.on('data', keep)
        child.stderr.on('data', keep)
        child.on('close', (code) => {
          log.end()
          const summary = tail.trim().split('\n').filter((l) => /checks? passed|FAILED|PASSED|ALL PASS|\d+ FAILED/.test(l)).at(-1) ?? ''
          resolve({ name, code, summary, i })
        })
      }),
  ),
)

for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(15)} ${r.summary}`)
console.log(`${Math.round((Date.now() - started) / 1000)} s; logs in e2e/logs/`)
process.exit(results.every((r) => r.code === 0) ? 0 : 1)
