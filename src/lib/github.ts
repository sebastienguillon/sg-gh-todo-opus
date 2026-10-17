// The browser's only line to the data repo: GitHub's REST and GraphQL APIs
// (github.com's git endpoints don't allow cross-origin requests).

// `VITE_GITHUB_API` lets a dev server talk to a local test proxy instead; builds leave it unset.
const API: string = import.meta.env.VITE_GITHUB_API ?? 'https://api.github.com'
/** Leave about a second between write requests (GitHub's secondary rate limits). */
const WRITE_GAP_MS = 1000
/** Shared by every client on the page: setup and sync both write. */
let lastWrite = 0

export interface Connection {
  token: string
  owner: string
  repo: string
  branch: string
}

export type ErrorKind =
  | 'network' // no answer at all
  | 'auth' // 401: the token is wrong, expired or revoked
  | 'forbidden' // 403: the token lacks a permission
  | 'missing' // 404: no such repo or branch, or the token can't see it
  | 'empty' // 409: the repo has no commits yet
  | 'stale' // the branch moved since it was read
  | 'rate' // rate limited; `retryAt` says when to try again
  | 'invalid' // 422 and other refusals
  | 'server' // 5xx

export class GitHubError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly status = 0,
    readonly retryAt: number | null = null,
  ) {
    super(message)
  }
}

export interface RepoInfo {
  owner: string
  name: string
  private: boolean
  archived: boolean
  defaultBranch: string
}

export interface TreeEntry {
  path: string
  sha: string
  type: 'blob' | 'tree' | 'commit'
}

/** A file to write (`content`) or delete (`content: null`) in a commit. */
export interface FileChange {
  path: string
  content: string | null
}

async function toError(res: Response): Promise<GitHubError> {
  let message = res.statusText
  try {
    message = ((await res.json()) as { message?: string }).message ?? message
  } catch {
    // Not JSON; keep the status text.
  }
  const s = res.status
  const h = res.headers
  if (s === 403 || s === 429) {
    const after = Number(h.get('retry-after'))
    if (after > 0) return new GitHubError('rate', message, s, Date.now() + after * 1000)
    if (h.get('x-ratelimit-remaining') === '0') return new GitHubError('rate', message, s, Number(h.get('x-ratelimit-reset')) * 1000)
    if (/rate limit/i.test(message)) return new GitHubError('rate', message, s, Date.now() + 60_000)
    return new GitHubError('forbidden', message, s)
  }
  if (s === 401) return new GitHubError('auth', message, s)
  if (s === 404) return new GitHubError('missing', message, s)
  if (s === 409) return new GitHubError(/empty/i.test(message) ? 'empty' : 'stale', message, s)
  if (s === 422) return new GitHubError(/fast.?forward|reference cannot be updated/i.test(message) ? 'stale' : 'invalid', message, s)
  if (s >= 500) return new GitHubError('server', message, s)
  return new GitHubError('invalid', message, s)
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function unbase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export class GitHub {
  readonly #token: string
  readonly #repoPath: string
  readonly owner: string
  readonly name: string

  constructor(token: string, owner: string, name: string) {
    this.#token = token
    this.owner = owner
    this.name = name
    this.#repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  }

  async #request(path: string, init: RequestInit & { etag?: string | null } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.#token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (init.body) headers['Content-Type'] = 'application/json'
    if (init.etag) headers['If-None-Match'] = init.etag
    const write = init.method && init.method !== 'GET'
    if (write) {
      const at = Math.max(Date.now(), lastWrite + WRITE_GAP_MS)
      lastWrite = at
      if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()))
    }
    let res: Response
    try {
      // `no-store` keeps the browser's cache out of the way, so a 304 reaches this code as a 304.
      res = await fetch(API + path, { ...init, headers, cache: 'no-store' })
    } catch {
      throw new GitHubError('network', 'GitHub did not answer.')
    }
    if (res.status === 304) return res
    if (!res.ok) throw await toError(res)
    return res
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.#request(path, init)).json()) as T
  }

  /** The one call that checks a token against a repo. */
  async repo(): Promise<RepoInfo> {
    const r = await this.#json<{ name: string; owner: { login: string }; private: boolean; archived: boolean; default_branch: string }>(
      this.#repoPath,
    )
    return { owner: r.owner.login, name: r.name, private: r.private, archived: r.archived, defaultBranch: r.default_branch }
  }

  /** The branch head. A 304 for an unchanged ETag doesn't count against the rate limit. */
  async head(branch: string, etag: string | null): Promise<{ changed: false } | { changed: true; sha: string; etag: string | null }> {
    const res = await this.#request(`${this.#repoPath}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { etag })
    if (res.status === 304) return { changed: false }
    const body = (await res.json()) as { object: { sha: string } }
    return { changed: true, sha: body.object.sha, etag: res.headers.get('etag') }
  }

  /** Every file at a commit, in one recursive call. */
  async tree(commit: string): Promise<{ sha: string; entries: TreeEntry[] }> {
    const body = await this.#json<{ sha: string; tree: TreeEntry[]; truncated: boolean }>(
      `${this.#repoPath}/git/trees/${commit}?recursive=1`,
    )
    if (body.truncated) throw new GitHubError('invalid', 'The data repo has too many files to read in one call.')
    return { sha: body.sha, entries: body.tree }
  }

  /** File contents by blob id: a hundred per GraphQL call, then one REST call for each that GraphQL didn't return. */
  async blobs(shas: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const wanted = [...new Set(shas)].filter((s) => /^[0-9a-f]{40}$/.test(s))
    try {
      for (let i = 0; i < wanted.length; i += 100) {
        const chunk = wanted.slice(i, i + 100)
        const fields = chunk.map((sha, j) => `b${j}: object(oid: "${sha}") { ... on Blob { text } }`).join('\n')
        const body = await this.#json<{ data?: { repository: Record<string, { text: string | null } | null> }; errors?: { message: string }[] }>(
          '/graphql',
          {
            method: 'POST',
            body: JSON.stringify({
              query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
              variables: { owner: this.owner, name: this.name },
            }),
          },
        )
        if (body.errors?.length || !body.data) throw new GitHubError('invalid', body.errors?.[0]?.message ?? 'GraphQL refused.')
        chunk.forEach((sha, j) => {
          const text = body.data!.repository[`b${j}`]?.text
          if (typeof text === 'string') out.set(sha, text)
        })
      }
    } catch (e) {
      if (e instanceof GitHubError && ['network', 'auth', 'rate'].includes(e.kind)) throw e
    }
    const rest = wanted.filter((s) => !out.has(s))
    for (let i = 0; i < rest.length; i += 4) {
      await Promise.all(
        rest.slice(i, i + 4).map(async (sha) => {
          const blob = await this.#json<{ content: string }>(`${this.#repoPath}/git/blobs/${sha}`)
          out.set(sha, unbase64(blob.content))
        }),
      )
    }
    return out
  }

  /** The first commit in an empty repo; the Git Data API can't start a branch. */
  async init(path: string, content: string, message: string): Promise<{ commit: string; tree: string }> {
    const body = await this.#json<{ commit: { sha: string; tree: { sha: string } } }>(`${this.#repoPath}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: base64(content) }),
    })
    return { commit: body.commit.sha, tree: body.commit.tree.sha }
  }

  /** Every change in one commit (Git Data API). A branch that moved meanwhile throws `stale`. */
  async commit(branch: string, parent: string, baseTree: string, changes: FileChange[], message: string): Promise<{ commit: string; tree: string }> {
    const tree = await this.#json<{ sha: string }>(`${this.#repoPath}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: changes.map((c) =>
          c.content === null
            ? { path: c.path, mode: '100644', type: 'blob', sha: null }
            : { path: c.path, mode: '100644', type: 'blob', content: c.content },
        ),
      }),
    })
    const commit = await this.#json<{ sha: string }>(`${this.#repoPath}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
    })
    await this.#request(`${this.#repoPath}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
    return { commit: commit.sha, tree: tree.sha }
  }
}
