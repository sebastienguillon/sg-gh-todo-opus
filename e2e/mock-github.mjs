#!/usr/bin/env node
// An in-memory fake of the GitHub endpoints that the To Do app's src/lib/github.ts calls, for one
// private repo (default: test/data, default branch master). Git objects are hashed the way git
// hashes them, so the app's blobSha() matches the tree entries this server returns.
//
// App endpoints (all under the API base the app gets from VITE_GITHUB_API):
//   GET    /repos/:o/:r                              repo info
//   GET    /repos/:o/:r/git/ref/heads/:branch        branch head, ETag + If-None-Match -> 304
//   GET    /repos/:o/:r/git/trees/:sha?recursive=1   tree (commit, tree or branch name)
//   POST   /graphql                                  blob batch: bN: object(oid: "...") { ... on Blob { text } }
//   GET    /repos/:o/:r/git/blobs/:sha               one blob, base64
//   PUT    /repos/:o/:r/contents/:path               create a file (starts an empty repo)
//   POST   /repos/:o/:r/git/trees                    base_tree + entries (content, sha, or sha: null to delete)
//   POST   /repos/:o/:r/git/commits                  commit object
//   PATCH  /repos/:o/:r/git/refs/heads/:branch       fast-forward only unless force; 422 otherwise
//
// Control API (same server, for tests; see README.md): /__control/...
//
// Run on its own:  node mock-github.mjs [--port 5299] [--seed seed.json] [--log]

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const API_VERSION = '2022-11-28'
const DOCS = 'https://docs.github.com/rest'

// ---- git objects ---------------------------------------------------------------

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

function hashObject(type, body) {
  return sha1(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]))
}

/** Git's blob id for a file: sha1("blob <len>\0<bytes>"). */
export function blobSha(content) {
  return hashObject('blob', Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'))
}

/** Git sorts tree entries by name, comparing a subtree's name as if it ended in "/". */
function treeOrder(a, b) {
  return Buffer.compare(Buffer.from(a.name + (a.type === 'tree' ? '/' : '')), Buffer.from(b.name + (b.type === 'tree' ? '/' : '')))
}

const VALID_MODES = new Set(['100644', '100755', '040000', '160000', '120000'])

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

function validPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.endsWith('/') && path.split('/').every((s) => s && s !== '.' && s !== '..' && s !== '.git')
}

class Repo {
  constructor() {
    /** sha -> { type: 'blob', data } | { type: 'tree', entries } | { type: 'commit', tree, parents, message, author, committer } */
    this.objects = new Map()
    this.head = null
    /** Every commit created, in order: { sha, at, by } */
    this.created = []
    this.warnings = []
  }

  putBlob(content) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const sha = hashObject('blob', data)
    if (!this.objects.has(sha)) this.objects.set(sha, { type: 'blob', data })
    return sha
  }

  putTree(entries) {
    const sorted = [...entries].sort(treeOrder)
    const body = Buffer.concat(
      sorted.map((e) => Buffer.concat([Buffer.from(`${e.mode === '040000' ? '40000' : e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')])),
    )
    const sha = hashObject('tree', body)
    if (!this.objects.has(sha)) this.objects.set(sha, { type: 'tree', entries: sorted })
    return sha
  }

  putCommit({ tree, parents, message, by = 'mock' }) {
    const now = new Date()
    const secs = Math.floor(now.getTime() / 1000)
    const who = `${by} <${by.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'mock'}@example.invalid>`
    const body = Buffer.from(
      `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author ${who} ${secs} +0000\ncommitter ${who} ${secs} +0000\n\n${message}`,
      'utf8',
    )
    const sha = hashObject('commit', body)
    if (!this.objects.has(sha)) {
      const person = { name: by, email: who.slice(who.indexOf('<') + 1, -1), date: new Date(secs * 1000).toISOString().replace('.000', '') }
      this.objects.set(sha, { type: 'commit', tree, parents, message, author: person, committer: person })
      this.created.push({ sha, at: now.toISOString(), by })
    }
    return sha
  }

  get(sha, type) {
    const o = this.objects.get(sha)
    return o && (!type || o.type === type) ? o : null
  }

  /** A commit, tree or branch name to its tree sha. */
  treeOf(ish, branch) {
    if (ish === branch || ish === `heads/${branch}` || ish === `refs/heads/${branch}`) ish = this.head
    const o = ish && this.objects.get(ish)
    if (!o) return null
    if (o.type === 'tree') return ish
    if (o.type === 'commit') return o.tree
    return null
  }

  /** Every file in a tree: path -> { mode, type, sha }. */
  flatten(treeSha, prefix = '', out = new Map()) {
    const t = this.get(treeSha, 'tree')
    if (!t) return out
    for (const e of t.entries) {
      const path = prefix + e.name
      if (e.type === 'tree') this.flatten(e.sha, `${path}/`, out)
      else out.set(path, { mode: e.mode, type: e.type, sha: e.sha })
    }
    return out
  }

  /** Build trees for a flat file map; empty folders vanish. */
  writeFlat(flat) {
    const root = new Map()
    for (const [path, e] of flat) {
      const parts = path.split('/')
      let node = root
      for (let i = 0; i < parts.length - 1; i++) {
        let next = node.get(parts[i])
        if (next && !(next instanceof Map)) throw new HttpError(422, `tree.path ${path} conflicts with the file ${parts.slice(0, i + 1).join('/')}`)
        if (!next) node.set(parts[i], (next = new Map()))
        node = next
      }
      const name = parts.at(-1)
      if (node.get(name) instanceof Map) throw new HttpError(422, `tree.path ${path} conflicts with a folder of the same name`)
      node.set(name, e)
    }
    const write = (node) => {
      const entries = []
      for (const [name, v] of node) {
        if (v instanceof Map) {
          if (!v.size) continue
          entries.push({ name, mode: '040000', type: 'tree', sha: write(v) })
        } else {
          entries.push({ name, mode: v.mode, type: v.type, sha: v.sha })
        }
      }
      return this.putTree(entries)
    }
    return write(root)
  }

  /** The Git Data API's tree creation: start from base_tree (or nothing) and apply each entry. */
  createTree(baseTree, entries, by) {
    if (!Array.isArray(entries)) throw new HttpError(422, 'Invalid request.\n\n"tree" wasn\'t supplied.')
    let flat = new Map()
    if (baseTree != null) {
      if (!this.get(baseTree, 'tree')) throw new HttpError(422, 'base_tree is not a valid tree oid', { field: 'base_tree' })
      flat = this.flatten(baseTree)
    }
    for (const e of entries) {
      if (!e || typeof e !== 'object') throw new HttpError(422, 'Invalid tree entry')
      if (!validPath(e.path)) throw new HttpError(422, `tree.path contains a malformed path component: ${JSON.stringify(e.path)}`)
      if (!VALID_MODES.has(e.mode)) throw new HttpError(422, `tree.mode is not valid: ${JSON.stringify(e.mode)}`)
      if (e.type && !['blob', 'tree', 'commit'].includes(e.type)) throw new HttpError(422, `tree.type is not valid: ${JSON.stringify(e.type)}`)
      const hasContent = typeof e.content === 'string'
      const hasSha = 'sha' in e
      if (hasContent && hasSha && e.sha !== undefined) throw new HttpError(422, 'Must supply either tree.sha or tree.content, not both')
      const under = (p) => p.startsWith(`${e.path}/`)
      if (hasSha && e.sha === null) {
        let hit = flat.delete(e.path)
        for (const p of [...flat.keys()]) if (under(p)) hit = flat.delete(p) || hit
        if (!hit) this.warnings.push({ at: new Date().toISOString(), by, message: `tree entry deletes ${e.path}, which is not in base_tree` })
        continue
      }
      for (const p of [...flat.keys()]) if (under(p)) flat.delete(p)
      if (hasContent) {
        if (e.type && e.type !== 'blob') throw new HttpError(422, 'tree.content needs tree.type blob')
        flat.set(e.path, { mode: e.mode, type: 'blob', sha: this.putBlob(e.content) })
      } else if (typeof e.sha === 'string') {
        const o = this.objects.get(e.sha)
        if (!o) throw new HttpError(422, `tree.sha ${e.sha} is not a valid object`)
        if (o.type === 'tree') {
          flat.delete(e.path)
          for (const [p, x] of this.flatten(e.sha)) flat.set(`${e.path}/${p}`, x)
        } else if (o.type === 'blob') {
          flat.set(e.path, { mode: e.mode, type: 'blob', sha: e.sha })
        } else {
          throw new HttpError(422, 'Submodule entries are not supported by this mock')
        }
      } else {
        throw new HttpError(422, 'Must supply either tree.sha or tree.content')
      }
    }
    return this.writeFlat(flat)
  }

  isAncestor(ancestor, descendant) {
    const seen = new Set()
    const stack = [descendant]
    while (stack.length) {
      const s = stack.pop()
      if (s === ancestor) return true
      if (seen.has(s)) continue
      seen.add(s)
      const c = this.get(s, 'commit')
      if (c) stack.push(...c.parents)
    }
    return false
  }

  /** Commit a set of file changes ({path: content | null}) on top of head and move head. */
  commitFiles(files, message, by) {
    const base = this.head ? this.get(this.head, 'commit').tree : null
    const entries = Object.entries(files).map(([path, content]) =>
      content === null ? { path, mode: '100644', type: 'blob', sha: null } : { path, mode: '100644', type: 'blob', content },
    )
    const tree = this.createTree(base, entries, by)
    const sha = this.putCommit({ tree, parents: this.head ? [this.head] : [], message, by })
    this.head = sha
    return sha
  }

  filesAt(commitSha) {
    const out = {}
    const tree = commitSha ? this.treeOf(commitSha) : null
    if (!tree) return out
    for (const [path, e] of this.flatten(tree)) if (e.type === 'blob') out[path] = this.get(e.sha, 'blob').data.toString('utf8')
    return out
  }

  /** Paths a commit changed against its first parent. */
  changesOf(sha) {
    const c = this.get(sha, 'commit')
    const now = this.flatten(c.tree)
    const before = c.parents[0] ? this.flatten(this.get(c.parents[0], 'commit').tree) : new Map()
    const added = []
    const modified = []
    const deleted = []
    for (const [p, e] of now) {
      const b = before.get(p)
      if (!b) added.push(p)
      else if (b.sha !== e.sha || b.mode !== e.mode) modified.push(p)
    }
    for (const p of before.keys()) if (!now.has(p)) deleted.push(p)
    return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() }
  }

  describe(sha) {
    const c = this.get(sha, 'commit')
    const meta = this.created.find((x) => x.sha === sha)
    const changes = this.changesOf(sha)
    return {
      sha,
      message: c.message,
      parents: c.parents,
      tree: c.tree,
      at: meta?.at ?? null,
      by: meta?.by ?? null,
      changed: [...changes.added, ...changes.modified, ...changes.deleted].sort(),
      changes,
    }
  }

  /** First-parent history of head, oldest first. */
  history() {
    const out = []
    for (let s = this.head; s; s = this.get(s, 'commit').parents[0] ?? null) out.push(s)
    return out.reverse()
  }
}

// ---- the server -----------------------------------------------------------------

function deviceOf(token) {
  if (!token) return null
  const m = token.match(/^test-token-?(.*)$/)
  return m ? m[1] || 'default' : token.slice(0, 16)
}

export function createMock({
  owner = 'test',
  repo: repoName = 'data',
  branch = 'master',
  origins = ['http://localhost:5298', 'http://127.0.0.1:5298'],
  log: logToConsole = false,
} = {}) {
  let repo = new Repo()
  let requests = [] // { n, at, method, path, endpoint, device, status, ms, note }
  let seq = 0
  let counters = newCounters()
  let faults = [] // { id, endpoint, device, method, status, message, headers, delayMs, hold, after, times, hits }
  let faultSeq = 0
  let held = [] // { id, endpoint, device, path, since, release(abort) }
  let heldSeq = 0
  const base = `/repos/${owner}/${repoName}`.toLowerCase()

  function newCounters() {
    return { total: {}, status: {}, byDevice: {} }
  }

  function count(endpoint, device, status) {
    counters.total[endpoint] = (counters.total[endpoint] ?? 0) + 1
    const k = `${endpoint} ${status}`
    counters.status[k] = (counters.status[k] ?? 0) + 1
    if (device) {
      const d = (counters.byDevice[device] ??= {})
      d[endpoint] = (d[endpoint] ?? 0) + 1
    }
  }

  function etagOf(sha) {
    return `W/"${sha1(`ref:${branch}:${sha}`)}"`
  }

  function refBody(sha) {
    return {
      ref: `refs/heads/${branch}`,
      node_id: 'REF_mock',
      url: `https://api.github.com${base}/git/refs/heads/${branch}`,
      object: { sha, type: 'commit', url: `https://api.github.com${base}/git/commits/${sha}` },
    }
  }

  function commitBody(sha) {
    const c = repo.get(sha, 'commit')
    return {
      sha,
      node_id: `C_${sha.slice(0, 12)}`,
      url: `https://api.github.com${base}/git/commits/${sha}`,
      html_url: `https://github.com/${owner}/${repoName}/commit/${sha}`,
      author: c.author,
      committer: c.committer,
      message: c.message,
      tree: { sha: c.tree, url: `https://api.github.com${base}/git/trees/${c.tree}` },
      parents: c.parents.map((p) => ({ sha: p, url: `https://api.github.com${base}/git/commits/${p}`, html_url: `https://github.com/${owner}/${repoName}/commit/${p}` })),
      verification: { verified: false, reason: 'unsigned', signature: null, payload: null },
    }
  }

  function treeListing(treeSha, recursive) {
    const out = []
    const walk = (sha, prefix) => {
      for (const e of repo.get(sha, 'tree').entries) {
        const path = prefix + e.name
        const item = { path, mode: e.mode, type: e.type, sha: e.sha, url: `https://api.github.com${base}/git/${e.type === 'tree' ? 'trees' : 'blobs'}/${e.sha}` }
        if (e.type === 'blob') item.size = repo.get(e.sha, 'blob').data.length
        out.push(item)
        if (recursive && e.type === 'tree') walk(e.sha, `${path}/`)
      }
    }
    walk(treeSha, '')
    return { sha: treeSha, url: `https://api.github.com${base}/git/trees/${treeSha}`, tree: out, truncated: false }
  }

  /** Which app endpoint a request is, or null for an unknown route. */
  function route(method, pathname) {
    if (method === 'POST' && pathname === '/graphql') return { endpoint: 'graphql' }
    const lower = pathname.toLowerCase()
    if (!lower.startsWith('/repos/')) return null
    if (lower !== base && !lower.startsWith(`${base}/`)) return { endpoint: 'otherRepo' }
    const rest = pathname.slice(base.length)
    let m
    if (method === 'GET' && rest === '') return { endpoint: 'repo' }
    if (method === 'GET' && (m = rest.match(/^\/git\/refs?\/heads\/(.+)$/))) return { endpoint: 'getRef', branch: m[1] }
    if (method === 'GET' && (m = rest.match(/^\/git\/trees\/([^/]+)$/))) return { endpoint: 'getTree', ish: m[1] }
    if (method === 'GET' && (m = rest.match(/^\/git\/blobs\/([^/]+)$/))) return { endpoint: 'getBlob', sha: m[1] }
    if (method === 'PUT' && (m = rest.match(/^\/contents\/(.+)$/))) return { endpoint: 'putContents', path: m[1] }
    if (method === 'POST' && rest === '/git/trees') return { endpoint: 'createTree' }
    if (method === 'POST' && rest === '/git/commits') return { endpoint: 'createCommit' }
    if (method === 'PATCH' && (m = rest.match(/^\/git\/refs\/heads\/(.+)$/))) return { endpoint: 'patchRef', branch: m[1] }
    return null
  }

  function cors(req, res) {
    const origin = req.headers.origin
    if (origin && (origins.includes(origin) || origins.includes('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Expose-Headers', 'ETag, Link, Location, Retry-After, X-GitHub-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used, X-RateLimit-Resource')
  }

  function send(res, status, body, headers = {}) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    if (body === undefined || status === 204 || status === 304) {
      res.writeHead(status)
      res.end()
      return
    }
    const text = JSON.stringify(body, null, 2)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
    res.end(text)
  }

  async function readBody(req) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      throw new HttpError(400, 'Problems parsing JSON')
    }
  }

  function takeFault(endpoint, device, method) {
    for (const f of faults) {
      if (f.hits >= f.times) continue
      if (f.endpoint !== '*' && f.endpoint !== endpoint) continue
      if (f.device && f.device !== device) continue
      if (f.method && f.method !== method) continue
      f.hits++
      return f
    }
    return null
  }

  // ---- the app's endpoints ----

  async function api(r, req, url, body, device) {
    const need = (cond, status, message) => {
      if (!cond) throw new HttpError(status, message)
    }
    switch (r.endpoint) {
      case 'otherRepo':
        throw new HttpError(404, 'Not Found')
      case 'repo':
        return {
          status: 200,
          body: {
            id: 1,
            node_id: 'R_mock',
            name: repoName,
            full_name: `${owner}/${repoName}`,
            private: true,
            owner: { login: owner, id: 1, type: 'User' },
            html_url: `https://github.com/${owner}/${repoName}`,
            archived: false,
            disabled: false,
            visibility: 'private',
            default_branch: branch,
            permissions: { admin: false, maintain: false, push: true, triage: false, pull: true },
          },
        }
      case 'getRef': {
        const name = decodeURIComponent(r.branch)
        if (!repo.head) throw new HttpError(409, 'Git Repository is empty.')
        need(name === branch, 404, 'Not Found')
        // A `lag` fault answers with the head as it was that many first-parent commits ago (a stale replica).
        const history = repo.history()
        const sha = r.lag ? history[Math.max(0, history.length - 1 - r.lag)] : repo.head
        const etag = etagOf(sha)
        const inm = req.headers['if-none-match']
        if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))) return { status: 304, headers: { ETag: etag } }
        return { status: 200, body: refBody(sha), headers: { ETag: etag, 'Cache-Control': 'private, max-age=60, s-maxage=60' }, note: r.lag ? `lagging by ${r.lag}: ${sha.slice(0, 7)}` : null }
      }
      case 'getTree': {
        if (!repo.head) throw new HttpError(409, 'Git Repository is empty.')
        const tree = repo.treeOf(decodeURIComponent(r.ish), branch)
        need(tree, 404, 'Not Found')
        return { status: 200, body: treeListing(tree, url.searchParams.has('recursive')) }
      }
      case 'getBlob': {
        const b = repo.get(r.sha, 'blob')
        need(b, 404, 'Not Found')
        const b64 = b.data.toString('base64').replace(/(.{60})/g, '$1\n')
        return {
          status: 200,
          body: { sha: r.sha, node_id: `B_${r.sha.slice(0, 12)}`, size: b.data.length, url: `https://api.github.com${base}/git/blobs/${r.sha}`, content: `${b64}\n`, encoding: 'base64' },
        }
      }
      case 'graphql': {
        need(body && typeof body.query === 'string', 400, 'Problems parsing JSON')
        const vars = body.variables ?? {}
        const q = body.query
        const rm = q.match(/repository\s*\(\s*owner\s*:\s*(\$\w+|"[^"]*")\s*,\s*name\s*:\s*(\$\w+|"[^"]*")\s*\)/)
        if (!rm) return { status: 200, body: { errors: [{ message: 'mock: only repository(owner:, name:) { bN: object(oid:) { ... on Blob { text } } } queries are supported' }] } }
        const val = (x) => (x.startsWith('$') ? vars[x.slice(1)] : x.slice(1, -1))
        if (String(val(rm[1])).toLowerCase() !== owner.toLowerCase() || String(val(rm[2])).toLowerCase() !== repoName.toLowerCase())
          return {
            status: 200,
            body: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: `Could not resolve to a Repository with the name '${val(rm[1])}/${val(rm[2])}'.` }] },
          }
        const out = {}
        let n = 0
        const re = /(\w+)\s*:\s*object\s*\(\s*oid\s*:\s*"([0-9a-fA-F]{40})"\s*\)\s*\{\s*\.\.\.\s*on\s+Blob\s*\{\s*text\s*\}\s*\}/g
        for (const m of q.matchAll(re)) {
          n++
          const o = repo.objects.get(m[2].toLowerCase())
          if (!o) out[m[1]] = null
          else if (o.type !== 'blob') out[m[1]] = {}
          else out[m[1]] = { text: o.data.includes(0) ? null : o.data.toString('utf8') }
        }
        return { status: 200, body: { data: { repository: out } }, note: `${n} oids` }
      }
      case 'putContents': {
        need(body && typeof body.message === 'string' && body.message, 422, 'Invalid request.\n\n"message" wasn\'t supplied.')
        need(typeof body.content === 'string', 422, 'Invalid request.\n\n"content" wasn\'t supplied.')
        const path = decodeURIComponent(r.path)
        need(validPath(path), 422, 'path contains a malformed path component')
        if (body.branch && body.branch !== branch) throw new HttpError(404, `Branch ${body.branch} not found`)
        const content = Buffer.from(body.content, 'base64')
        const existing = repo.head ? repo.flatten(repo.get(repo.head, 'commit').tree).get(path) : null
        if (existing && !body.sha) throw new HttpError(422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
        if (existing && body.sha !== existing.sha) throw new HttpError(409, `${path} does not match ${body.sha}`)
        const baseTree = repo.head ? repo.get(repo.head, 'commit').tree : null
        const tree = repo.createTree(baseTree, [{ path, mode: '100644', type: 'blob', sha: repo.putBlob(content) }], device)
        const sha = repo.putCommit({ tree, parents: repo.head ? [repo.head] : [], message: body.message, by: device ?? 'api' })
        repo.head = sha
        const blob = blobSha(content)
        return {
          status: existing ? 200 : 201,
          body: {
            content: { name: path.split('/').at(-1), path, sha: blob, size: content.length, type: 'file', url: `https://api.github.com${base}/contents/${path}` },
            commit: commitBody(sha),
          },
        }
      }
      case 'createTree': {
        need(body, 400, 'Problems parsing JSON')
        const sha = repo.createTree(body.base_tree ?? null, body.tree, device)
        return { status: 201, body: treeListing(sha, false), note: `${body.tree?.length ?? 0} entries` }
      }
      case 'createCommit': {
        need(body && typeof body.message === 'string', 422, 'Invalid request.\n\n"message" wasn\'t supplied.')
        need(typeof body.tree === 'string' && repo.get(body.tree, 'tree'), 422, 'Tree SHA does not exist')
        const parents = body.parents ?? []
        need(Array.isArray(parents) && parents.every((p) => repo.get(p, 'commit')), 422, 'Parent SHA does not exist or is not a commit object')
        const sha = repo.putCommit({ tree: body.tree, parents, message: body.message, by: device ?? 'api' })
        return { status: 201, body: commitBody(sha) }
      }
      case 'patchRef': {
        need(decodeURIComponent(r.branch) === branch && repo.head, 422, 'Reference does not exist')
        need(body && typeof body.sha === 'string', 422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
        need(repo.get(body.sha, 'commit'), 422, 'Object does not exist')
        if (!body.force && !repo.isAncestor(repo.head, body.sha)) throw new HttpError(422, 'Update is not a fast forward')
        const from = repo.head
        repo.head = body.sha
        return { status: 200, body: refBody(body.sha), note: `${from.slice(0, 7)} -> ${body.sha.slice(0, 7)}` }
      }
    }
    throw new HttpError(404, 'Not Found')
  }

  // ---- the control API ----

  function reset(files, message = 'Seed the test repo', by = 'seed') {
    for (const h of held) h.release(true)
    repo = new Repo()
    requests = []
    seq = 0
    counters = newCounters()
    faults = []
    held = []
    if (files && Object.keys(files).length) repo.commitFiles(files, message, by)
    return state()
  }

  function state() {
    return {
      owner,
      repo: repoName,
      branch,
      head: repo.head,
      etag: repo.head ? etagOf(repo.head) : null,
      commits: repo.history().length,
      held: held.map(({ id, endpoint, device, path, since }) => ({ id, endpoint, device, path, since })),
      faults: faults.map(({ id, endpoint, device, method, status, delayMs, lag, hold, after, times, hits }) => ({ id, endpoint, device, method, status, delayMs, lag, hold, after, times, hits })),
      warnings: repo.warnings,
      requests: seq,
    }
  }

  function commits(all) {
    if (!all) return repo.history().map((s) => ({ ...repo.describe(s), onBranch: true }))
    const on = new Set(repo.history())
    const reachable = (s) => repo.head && repo.isAncestor(s, repo.head)
    return repo.created.map(({ sha }) => ({ ...repo.describe(sha), onBranch: on.has(sha) || reachable(sha) }))
  }

  async function control(req, res, url) {
    const p = url.pathname.replace(/^\/__control\/?/, '')
    const body = req.method === 'GET' ? null : await readBody(req)
    const q = url.searchParams
    const ok = (data) => send(res, 200, data)
    if (req.method === 'POST' && p === 'reset') return ok(reset(body?.files ?? null, body?.message, body?.by))
    if (req.method === 'GET' && (p === '' || p === 'state')) return ok(state())
    if (req.method === 'GET' && p === 'files') return ok(repo.filesAt(q.get('ref') ?? repo.head))
    if (req.method === 'GET' && p === 'commits') return ok(commits(q.has('all')))
    if (req.method === 'POST' && p === 'commit') {
      if (!body?.files) throw new HttpError(422, 'files is required: {path: content | null}')
      const sha = repo.commitFiles(body.files, body.message ?? 'Edit by hand', body.by ?? 'external')
      return ok({ sha, head: repo.head })
    }
    if (req.method === 'GET' && p === 'counters') return ok(counters)
    if (req.method === 'POST' && p === 'counters/reset') {
      counters = newCounters()
      return ok(counters)
    }
    if (req.method === 'GET' && p === 'log') {
      const since = Number(q.get('since') ?? 0)
      return ok(requests.filter((r) => r.n > since))
    }
    if (req.method === 'POST' && p === 'fault') {
      if (!body?.endpoint) throw new HttpError(422, 'endpoint is required (an endpoint name, or "*")')
      const f = {
        id: ++faultSeq,
        endpoint: body.endpoint,
        device: body.device ?? null,
        method: body.method ?? null,
        status: body.status ?? null,
        message: body.message ?? null,
        headers: body.headers ?? {},
        delayMs: body.delayMs ?? 0,
        lag: body.lag ?? 0,
        hold: !!body.hold,
        after: !!body.after,
        times: body.times ?? Infinity,
        hits: 0,
      }
      faults.push(f)
      return ok({ id: f.id })
    }
    if ((req.method === 'DELETE' && p === 'fault') || (req.method === 'POST' && p === 'faults/clear')) {
      const id = Number(q.get('id') ?? body?.id ?? 0)
      faults = id ? faults.filter((f) => f.id !== id) : []
      return ok(state().faults)
    }
    if (req.method === 'GET' && p === 'held') return ok(state().held)
    if (req.method === 'POST' && p === 'release') {
      const pick = held.filter((h) => (!body?.id || h.id === body.id) && (!body?.endpoint || h.endpoint === body.endpoint) && (!body?.device || h.device === body.device))
      for (const h of pick) h.release(false)
      return ok({ released: pick.length })
    }
    if (req.method === 'GET' && p === 'warnings') return ok(repo.warnings)
    throw new HttpError(404, `No control route ${req.method} /__control/${p}`)
  }

  // ---- dispatch ----

  async function handle(req, res) {
    const url = new URL(req.url, 'http://mock.invalid')
    cors(req, res)
    if (url.pathname.startsWith('/__control')) {
      try {
        await control(req, res, url)
      } catch (e) {
        send(res, e.status ?? 500, { message: e.message })
      }
      return
    }

    const started = Date.now()
    const token = (req.headers.authorization ?? '').replace(/^(?:Bearer|token)\s+/i, '') || null
    const device = deviceOf(token)
    const entry = { n: ++seq, at: new Date(started).toISOString(), method: req.method, path: url.pathname + url.search, endpoint: null, device, status: 0, ms: 0, note: null }

    if (req.method === 'OPTIONS') {
      entry.endpoint = 'preflight'
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'Authorization, Accept, Content-Type, If-None-Match, X-GitHub-Api-Version')
      res.setHeader('Access-Control-Max-Age', '600')
      entry.status = 204
      requests.push(entry)
      count('preflight', null, 204)
      return send(res, 204)
    }

    const r = route(req.method, url.pathname)
    entry.endpoint = r?.endpoint ?? 'unknown'
    const finish = (status, body, headers, note) => {
      entry.status = status
      entry.ms = Date.now() - started
      if (note) entry.note = note
      requests.push(entry)
      count(entry.endpoint, device, status)
      if (logToConsole) console.log(`[mock] ${entry.method} ${entry.path} ${device ?? '-'} -> ${status}${entry.note ? ` (${entry.note})` : ''}`)
      if (status === 0) {
        req.socket.destroy()
        return
      }
      send(res, status, body, headers)
    }

    let body = null
    try {
      body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req)
    } catch (e) {
      return finish(e.status ?? 400, { message: e.message, documentation_url: DOCS })
    }
    if (!r) return finish(404, { message: `Not Found (mock: no route for ${req.method} ${url.pathname})`, documentation_url: DOCS }, {}, 'unhandled route')
    if (!token) return finish(r.endpoint === 'graphql' ? 401 : 404, { message: r.endpoint === 'graphql' ? 'This endpoint requires you to be authenticated.' : 'Not Found', documentation_url: DOCS })
    if (!/^test-token-/.test(token)) return finish(401, { message: 'Bad credentials', documentation_url: DOCS })
    if (req.headers['x-github-api-version'] && req.headers['x-github-api-version'] !== API_VERSION) entry.note = `api version ${req.headers['x-github-api-version']}`

    const fault = takeFault(r.endpoint, device, req.method)
    if (fault) {
      entry.note = `fault #${fault.id}`
      if (fault.delayMs) await new Promise((ok) => setTimeout(ok, fault.delayMs))
      if (fault.hold) {
        const aborted = await new Promise((resolve) => {
          const h = { id: ++heldSeq, endpoint: r.endpoint, device, path: url.pathname, since: new Date().toISOString(), release: (abort) => {} }
          h.release = (abort) => {
            held = held.filter((x) => x !== h)
            resolve(abort)
          }
          held.push(h)
        })
        if (aborted) return finish(503, { message: 'mock reset while this request was held' })
      }
      if (fault.status !== null && !fault.after) return finish(fault.status, { message: fault.message ?? `mock fault #${fault.id}`, documentation_url: DOCS }, fault.headers)
    }

    if (fault?.lag) r.lag = fault.lag
    try {
      const out = await api(r, req, url, body, device)
      if (fault?.after && fault.status !== null) {
        entry.note = `${entry.note}; applied (${out.status}) then failed`
        return finish(fault.status, { message: fault.message ?? `mock fault #${fault.id}`, documentation_url: DOCS }, fault.headers)
      }
      finish(out.status, out.body, out.headers, out.note ? (entry.note ? `${entry.note}; ${out.note}` : out.note) : null)
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[mock] internal error', e)
      finish(e.status ?? 500, { message: e.message, documentation_url: DOCS, ...(e.extra ?? {}) })
    }
  }

  return {
    handle: (req, res) => {
      handle(req, res).catch((e) => {
        console.error('[mock] handler crashed', e)
        try {
          send(res, 500, { message: String(e) })
        } catch {}
      })
    },
    reset,
    state,
    files: () => repo.filesAt(repo.head),
    commits,
  }
}

/** Listen on both loopback addresses (a browser may resolve localhost to either). */
export async function startMock({ port = 5299, ...opts } = {}) {
  const mock = createMock(opts)
  const servers = []
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer(mock.handle)
    server.keepAliveTimeout = 5000
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve()
        })
      })
      servers.push(server)
    } catch (e) {
      if (host === '::1' && (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT')) continue
      for (const s of servers) s.close()
      throw new Error(`mock-github: can't listen on ${host}:${port}: ${e.code ?? e.message}`)
    }
  }
  return {
    ...mock,
    port,
    url: `http://localhost:${port}`,
    close: () =>
      Promise.all(
        servers.map(
          (s) =>
            new Promise((resolve) => {
              s.close(() => resolve())
              s.closeAllConnections?.()
            }),
        ),
      ),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const port = Number(opt('--port') ?? 5299)
  const mock = await startMock({ port, log: args.includes('--log') })
  const seed = opt('--seed')
  if (seed) mock.reset(JSON.parse(readFileSync(seed, 'utf8')))
  console.log(`mock-github listening on ${mock.url} (repo test/data, branch master); control API at ${mock.url}/__control`)
  const stop = async () => {
    await mock.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
