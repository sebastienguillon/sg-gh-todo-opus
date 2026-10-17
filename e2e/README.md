# To Do sync e2e harness

Two (or more) simulated devices run the To Do app's real sync code against an in-memory fake GitHub.

| File | What it is |
| --- | --- |
| `mock-github.mjs` | In-memory GitHub for one private repo, `test/data`, branch `master`, plus a control API under `/__control`. |
| `harness.mjs` | Starts the mock (port 5299), the app's Vite dev server (port 5298, `VITE_GITHUB_API=http://localhost:5299`) and Chrome. `device(name)` opens one device. |
| `smoke.mjs` | The smoke test: seed, two devices, add/check off, offline edits, a same-field conflict, a ref-update race. Prints PASS/FAIL per check and exits 1 on any failure. |
| `probes.mjs` | Reproductions of app behaviours found while building the harness (see the end of this file). |
| `run-all.mjs` | Runs every suite at once, each on its own ports, and reports; logs go to `logs/`. |
| `delete-multi-1.mjs`, `delete-multi-2.mjs`, `delete-single.mjs` | List deletion: every delete-versus-change case on two devices in both sync orders, offline, hand edits, and the single-device cases (undo inside and after the commit hold, a reload before the commit, a delete during a commit in flight). |
| `persist.mjs` | An edit followed at once by a reload, a closed tab, a hidden page then a crash, in demo and connected mode, two tabs, and a new connection saved under its repo's name (plan problems 1 and 1b). |
| `etag.mjs` | The ETag a device keeps is always its head's: after a pull, an own commit, a reload, a refused ref update, an upgrade from an older build, and a force-push back to the parent (problem 3). |
| `stale.mjs` | Lagging branch reads naming a head the device moved past: ignored once, without reverting, losing a pending change or a failed band (problem 4). `STALE_S7=1` adds a slow case. |
| `sync-faults.mjs` | A save whose ref update answer is lost, fails, or whose check after it fails, is rate limited or refused, and a failure before the ref update (problem 5). |
| `conflict.mjs` | The conflict notice against every status change (offline, an edit offline, a failed save and Retry, a token replaced, Dismiss while offline), a list notice, the band word order, the `?sync=` review states alone and combined, and Reconnect surviving a trip offline (plan problems 2 and 2b). |

Nothing here talks to api.github.com: the app's API base is the mock, and every device context also aborts any request to `https://api.github.com/`, recorded in `h.realGitHubHits`. Tokens are dummies, `test-token-<device>`.

## Run

```sh
cd e2e
pnpm install          # playwright-core only; Chrome is the installed /Applications/Google Chrome.app
node run-all.mjs      # every suite at once, each on its own ports; logs in e2e/logs/ (about 3 min)
node run-all.mjs smoke delete-single   # only these
node smoke.mjs        # one suite on its own, about 50 s
HEADED=1 node smoke.mjs     # watch the two windows
VERBOSE=1 node smoke.mjs    # mock requests, vite output, page console
node probes.mjs       # about 40 s
node conflict.mjs     # about 50 s; persist.mjs, etag.mjs and stale.mjs take under 90 s, sync-faults.mjs about 3 min
node mock-github.mjs [--port 5299] [--seed seed.json] [--log]   # the mock on its own
```

You need:

- Node 24.
- The app in this folder's parent, with its `node_modules` installed. Point `APP_DIR=…` at a copy of the app to test that instead and the Chrome binary with `CHROME=…`.
- Ports 5298 and 5299 free, or other ones set with `APP_PORT` and `MOCK_PORT`. The harness refuses to start on a busy port. `run-all.mjs` gives suite *n* ports 5500 + 10*n* and 5501 + 10*n*.

This folder is a separate pnpm project with its own lockfile: the app's install and CI don't touch it, and nothing in it is built or deployed.

The harness starts and stops the mock and the dev server itself, and kills Vite's process group on exit or Ctrl-C.

## Harness API

```js
import { startHarness, todoFile, listFile, slugify, sleep } from './harness.mjs'
const h = await startHarness({ headless: true, verbose: false, hmr: false })
```

### Repo and control (`h.*`, all over the HTTP control API)

| Call | Does |
| --- | --- |
| `reset(files, message?)` | Replaces the repo with `{path: content}` in one seed commit. `null` gives an empty repo, to exercise the app's `contents` PUT init. Also clears counters, faults, held requests, the log and warnings. |
| `repoFiles(ref?)` | `{path: content}` at the branch head, or at a commit. |
| `commits({all})` | First-parent history, oldest first: `{sha, message, parents, tree, by, at, changed, changes: {added, modified, deleted}, onBranch}`. `all: true` adds commits that never reached the branch, such as a refused race commit. |
| `counters()` / `resetCounters()` | `{total: {endpoint: n}, status: {'endpoint status': n}, byDevice: {A: {endpoint: n}}}` |
| `requests(sinceN)` | The request log `{n, method, path, endpoint, device, status, ms, note}`. A GraphQL note says `N oids`. Use `(await h.state()).requests` as a bookmark. |
| `state()` | `{head, etag, commits, held, faults, warnings, requests}` |
| `fault(spec)` / `clearFaults(id?)` | Fault injection; see below. |
| `held()`, `waitHeld({endpoint, device})`, `release({endpoint?, device?, id?})` | Requests parked by a `hold` fault. |
| `externalCommit({path: content \| null}, message)` | A commit made outside the app, like a hand edit on github.com or a third device. |
| `warnings()` | Mock leniencies that occurred. Today the only one is a tree entry deleting a path not in `base_tree`. |
| `stop()` | Closes devices, Chrome, Vite and the mock. |

Endpoint names, used in counters, the log and faults: `repo`, `getRef`, `getTree`, `graphql`, `getBlob`, `putContents`, `createTree`, `createCommit`, `patchRef`, `preflight`, `unknown` (an unhandled route; it should stay at 0), `otherRepo`.

### Faults

`h.fault({...})` takes these fields:

| Field | Meaning |
| --- | --- |
| `endpoint` | An endpoint name, or `'*'`. Required. |
| `device` | Match one device only (`'A'`). |
| `method` | Match one HTTP method only. |
| `times` | How many matching requests it applies to. Default: unlimited. |
| `delayMs` | Wait this long first. The fast-forward check runs after the delay, so another device can land a commit meanwhile. |
| `hold: true` | Park the request until `release()`. Same as `delayMs`, but deterministic. |
| `status`, `message`, `headers` | Answer with this error instead of doing the work. Examples: `{status: 403, headers: {'retry-after': '5'}}` is a rate limit, `401` is a revoked token, `500` is a server error. |
| `after: true` | Do the work, then answer with `status`. "The ref moved but the answer was lost": use `502`, not `0` (see the gotchas). |
| `status: 0` | Destroy the socket: a network error. |
| `lag: n` | On `getRef`, answer with the head as it was `n` commits ago, like a stale replica. |

### Devices

`const a = await h.device('A', {connection?, path?, ready?})` opens a fresh browser context. It seeds `localStorage['gh-todo:github']` with `{token: 'test-token-A', owner: 'test', repo: 'data', branch: 'master'}` in an init script, only when the key is absent, so reloads keep the device's state. It then opens `http://localhost:5298/` and waits for the first sync check.

| Helper | Does |
| --- | --- |
| `a.store(fn, arg)` | Runs `(store, arg) => …` in the page against the app's own store singleton and returns a JSON copy. `fn` is sent as source text, so it can't close over Node variables; pass `arg`. |
| `a.snapshot({full})` | `{mode, online, lists: [{id, index, name, ink}], todos: [{id, listId, title, done}], pending: [{kind, id, title, path, seq}], sync, conflict, head, lastCheckedAt}`. Sorted, so two devices compare with `deepStrictEqual`. `full: true` returns every field of lists and to-dos. `conflict` is the banner; see below. |
| `a.sync({timeout, allowFailed})` | Asks GitHub now and waits until the device has nothing pending and no cycle running. It throws if the device is offline or shows `failed`; with `allowFailed`, it returns the snapshot instead. |
| `a.waitSaved()` | Waits for the app's own schedule without asking for anything. |
| `a.waitFor(fn, arg)` | Waits for `fn(store, arg)` to be truthy. |
| `a.offline(bool)` | `context.setOffline`. Chrome flips `navigator.onLine` and fires `online`/`offline` itself; verified, so no manual events are needed. |
| `a.reload()` | Reloads the page; localStorage stays. Needs the device online, because the dev server serves the page and there is no service worker in dev. |
| `a.close()` | Closes the device's browser context. |
| `a.add(text, listId?)`, `a.toggle(id)`, `a.edit(id, patch)`, `a.remove(id)`, `a.todo(idOrTitle)` | Thin wrappers over `store.add/toggle/update/remove`. |
| `a.requests()` | The app's API requests as the page saw them. |
| `a.storage()` | `{connection, repo}` from localStorage. |
| `a.state()` | The in-page sync counters. |
| `a.errors` | Page errors, console errors and console warnings. |
| `a.page`, `a.context` | The Playwright objects. |

`todoFile(t)` and `listFile(l)` are copies of `writeTodo` and `writeList` in `src/lib/repo.ts`, for seeds and expected contents. `slugify` is a copy of the app's.

### Reading the conflict banner

Read the banner from `snapshot().conflict`, never from `sync.kind`. It is `{path, id?, message?}`, or `null` when no banner shows: `path` is the file (or `folder/` for a list notice) as it is on GitHub, `id` the to-do when known, and `message` a list notice's own wording.

It reads the same on both shapes of the app. Since fix 2 of the sync-fixes plan, the notice is `store.conflict` and `store.sync` is never of kind `'conflict'`. Before it, the notice was a `store.sync` of kind `'conflict'`, which any status change could replace.

- "No banner": `!snap.conflict`.
- "Shows saved", in the sense the band says saved: `snap.sync.kind === 'saved' && !snap.conflict`. Since fix 2, `sync.kind` can be `'saved'` while a banner shows, and the band then says "conflict".
- Inside the page, in a function passed to `a.store()` or `a.waitFor()`, call `window.__e2e.conflict()` for the same value, for example `A.waitFor(() => !!window.__e2e.conflict())`.

## How `sync()` knows the device is done

- The app's request flow isn't observable from outside: `#busy` is private. So the init script wraps `fetch` to count the app's API requests, and the harness hooks the `remote.lastCheckedAt` setter, which the app sets once at the end of every successful cycle.
- A free engine starts its branch read synchronously inside `store.remote.check()`. A busy one ignores the call. `sync()` therefore calls `check()` until a branch read starts, and waits for that cycle to finish.
- If the cycle leaves changes pending (the 10 s gap), `sync()` waits for them to go, then runs one more check. This proves the device is idle and up to date.
- A cycle that dies quietly (a 5xx or network error while nothing is pending, which the app doesn't surface) is detected after 3 s without requests and retried. After 3 such cycles, `sync()` throws.
- On attach, the harness imports the store at the exact URL the app loaded it from, found in Resource Timing. It then proves it is the same instance: it writes a probe into `store.announcement` and finds it in the page's live region. `a.attached.probe` must be `same-instance`.

## Timings and gotchas

- **App constants** (`src/lib/remote.svelte.ts`, `github.ts`): settle 1.5 s after the last edit, at most 8 s after the first. At most one commit per 10 s. A gap of 1 s or more between any two write requests, shared by everything on the page; a GraphQL blob read is a POST, so it counts as a write too. A poll every 60 s while the page is visible. A focus or visibility recheck if the last check is over 10 s old.
- **Cost of one cycle:**
  - A commit is tree POST, commit POST and ref PATCH, spaced 1 s apart, so `sync()` with a commit takes about 2.8 s.
  - A pull is a ref read, a tree read and a GraphQL read: 0.2 to 1.2 s.
  - An idle `sync()` is one 304, about 0.1 s.
  - Left alone, the first edit commits about 3.5 s after it is made. A second edit within 10 s of a commit waits for the gap, about 12 s.
- **Making a device commit right away:** `store.remote.check()` with pending changes commits immediately and skips the 1.5 s settle. This is what `sync()` does. The exception is when the device committed less than 10 s ago: the check then only reads, and the commit runs when the gap ends (`sync()` waits for it). `store.remote.retry()` does the same and also clears a failure backoff (30 s, doubling).
- **Going online commits:** the `online` event runs a cycle at once, committing if the gap allows. A device brought online with `offline(false)` is usually already mid-cycle when you call `sync()`, which handles that.
- **Forcing a pull:** call `sync()`. Every check reads the ref with the stored ETag, and any new head is pulled. The 60 s poll is too slow to wait for in a test. To force a full re-read, set `store.remote.base.etag = null` before `check()`. Headless pages report `visible`, so the 60 s poll does run during long tests; it is harmless.
- **Commits right after a device's own commit:** the device keeps the ETag from before its commit, so its next read is a 200, not a 304. It doesn't pull, because the sha matches its base.
- **Racing two devices deterministically:** use `fault({endpoint: 'patchRef', device: 'A', hold: true, times: 1})`, then `waitHeld`. Let B commit, then `release()`. A then gets a 422 "Update is not a fast forward", re-reads, merges and commits again (smoke step 5).
- **`status: 0` with `after: true` on a write is masked by Chrome:** when a keep-alive connection dies after the request was sent, Chrome silently resends it. A second PATCH with the same sha then succeeds as a no-op fast-forward. Use `after: true, status: 502` to simulate "applied, answer lost".
- **Chrome logs every 4xx** as a console error ("Failed to load resource … 422"). The smoke expects exactly one, from the race.
- **HMR is muted:** another engineer may be editing the app while tests run. The harness therefore answers each device's Vite HMR websocket itself (`routeWebSocket`), and the page never hears about edits. Without that, an edit to `store.svelte.ts` would hot-load a second `Store`, and a second sync engine, into a running page. A device runs the code it loaded; `reload()` picks up the current code. `startHarness({hmr: true})` turns HMR back on.
- **The tested code is the working tree,** uncommitted edits included. Vite serves whatever is on disk.
- **Shared Vite cache:** the dev server writes and reads the app's `node_modules/.vite`, the same dependency cache as any other dev server running on the app, such as one on port 5173. That is harmless unless dependencies change mid-run.
- **Mock leniencies and gaps:**
  - A tree entry with `sha: null` for a path missing from `base_tree` is accepted with a warning (`h.warnings()`), since GitHub's exact answer to that is unverified. The smoke checks there are none.
  - Not modelled: rate limits (inject them with faults), token scopes, `truncated` trees, and the delays of real GitHub.
  - Commit and tree shas are git-correct: tree hashing was checked against `git write-tree`, and blob shas against `git hash-object`. The app's `blobSha` therefore matches, and a device never re-downloads what it wrote. The smoke checks this.

## App behaviours found while building the harness

`probes.mjs` reproduces each one. On today's app it prints "not seen" for the first four; the fifth checks that a lost answer leaves no duplicate commit, and prints "CONFIRMED … handled well". Found against the app of 2026-10-17 (HEAD `d2e87f8ad` plus the list-delete work), and fixed on 2026-10-18:

1. **An edit closed or reloaded within 300 ms was lost.** The store now saves at once on `pagehide` and when the page turns hidden, if a save is waiting. Guarded by `persist.mjs`, which also covers a new connection that was saved under an empty repo name.
2. **Going offline wiped an undismissed conflict notice.** The notice is now `store.conflict`, apart from the sync state, and a token GitHub refuses keeps showing Reconnect across a trip offline. Guarded by `conflict.mjs`.
3. **A branch read staler than the last one seen made the device adopt the older commit.** A read naming a head the device moved past less than a minute ago is now ignored once. Guarded by `stale.mjs`.
4. **The stored ETag lagged the head.** It is now always the ETag of the head held (null right after an own commit), and an ETag saved by an older build is dropped on load. Guarded by `etag.mjs`.
5. **A save whose answer was lost showed "failed" for 30 s.** The device now reads the branch once after a lost answer and counts the save as landed only if the branch names the commit just made. Guarded by `sync-faults.mjs`.

Still open, and not covered: several tabs saving over each other (the last to save wins), a crash while the page is visible within 300 ms of an edit, a title or note still focused when the app closes, `localStorage` filling up, and request timeouts.

The setup screen has its own live region, so `h.device()` can't attach its same-instance probe there; `persist.mjs` drives the setup form without attaching, and attaches after the reload.
