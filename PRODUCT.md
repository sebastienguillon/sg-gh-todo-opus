# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Svelte + Vite + TypeScript, managed with pnpm. Shipped as a static web app on GitHub Pages from this public repository (`sebastienguillon/sg-gh-todo-opus`), served from **its own hostname, `do.sebastienguillon.com`**, rather than the shared `sebastienguillon.github.io`. It is installable (a PWA) and opens without a network once visited (see Install and offline). There is no app server. A GitHub Actions workflow (`.github/workflows/deploy.yml`) checks, builds and deploys every push to `master`, and can also be run by hand.

## Users

One person: the owner of the GitHub account, using it across several of their own devices. These are desktop and laptop browsers plus a phone, where it lives on the home screen. Desktop and phone get equal care. There are no other users, no sign-up, and no sharing or collaboration.

## Product Purpose

A simple personal to-do app whose only persistence is a private GitHub repository the owner controls. Success means:
- Open it on any of the owner's devices and see the same lists.
- Capture and check off items instantly.
- Keep working offline, and have changes sync later.
- Never lose a change.

## Positioning

The data never lives in a vendor database or on an app server. It is a set of plain files in the owner's own private GitHub repo. Git history serves as a full record of every change. The files can be read or hand-edited on github.com or in any editor. The app itself is just a static site that reads and writes that repo.

## Operating Context

- **Two repositories.** `sebastienguillon/sg-gh-todo-opus` (local folder `~/dev/projects/sebastienguillon/sg-gh-todo-opus`) holds the app code and serves it through GitHub Pages. It is public, which GitHub Pages on a free plan requires, and no secrets live in the code. A separate private data repo, `sebastienguillon/gh-todo-data` (local folder `~/dev/projects/sebastienguillon/gh-todo-data`), holds the to-dos, with a README that describes the data format.
- **Default branch.** In both repos the default branch is `master`, never `main`. The app syncs whichever branch GitHub reports as the data repo's default.
- **Device access.** On first launch, each device asks for a fine-grained personal access token limited to the data repo, with Contents read and write only. The setup screen links to GitHub's token form pre-filled with that permission (only the repo has to be picked by hand), checks the token with one call to the repo, refuses classic tokens, public repos and archived repos, and starts an empty repo with a README. The token is stored only on that device (`localStorage`). Each device has its own token, so a lost device can be revoked on its own. The app has no login of its own. The sync panel can check for changes now, replace the device's token while keeping its pending changes, or disconnect the device, which forgets its token and lists (the repo keeps everything) and warns first about changes that haven't reached GitHub. A device can also look around with demo data first; demo data is never seeded once a repo is connected.
- **Own origin.** Browser storage is per origin, and every GitHub Pages site on the account shares `sebastienguillon.github.io`. So To Do is served from `do.sebastienguillon.com`, a GitHub Pages custom domain (set in the repo's Pages settings, recorded in `public/CNAME`; HTTPS enforced, with plain `http://` redirected to `https://`). DNS for `sebastienguillon.com` is at DreamHost: a CNAME from `do` to `sebastienguillon.github.io`, and a `_github-pages-challenge-sebastienguillon` TXT record that verifies the domain on the GitHub account, so no other account can claim its subdomains for GitHub Pages. Nothing else is served from that hostname, and `me.sebastienguillon.com` is a separate DreamHost site with nothing to do with To Do. That keeps its token storage apart from any other site the owner publishes. On any github.io address the setup screen explains the risk and refuses to store a token, and no service worker is registered (one at `/` there would sit over every Pages site on the account). The Vite build `base` is `/`.
- **Deploys.** The Pages source is GitHub Actions: the workflow runs `pnpm run check` and `pnpm run build` and publishes `dist`. The local `gh` CLI token lacks the `workflow` scope, so the owner pushes commits that change `.github/workflows` from their own terminal.
- **Content Security Policy.** A meta tag in `index.html` limits scripts, styles, fonts, the manifest and the service worker to the app's own origin, images to it and `data:`, and network calls to `https://api.github.com`. The dev server loosens it for its injected styles, HMR websocket and an optional local test API (`vite.config.ts`). A meta policy can't set `frame-ancestors`, and GitHub Pages can't send headers.
- **Transport.** The browser talks to the GitHub REST/GraphQL API (api.github.com). The git endpoints on github.com don't allow cross-origin requests, so the app has no in-browser git clone.
- **Install and offline.** A web app manifest (`public/manifest.webmanifest`: standalone, orange theme colour, pad-white background) and the icons in `public/` make To Do installable on a phone's home screen or a desktop. A service worker (`src/sw.ts`, compiled to `dist/sw.js` by a plugin in `vite.config.ts`) keeps every built file on the device, so after one online visit the app opens with no network. Each build's `sw.js` carries a hash of all built files, so a deploy that changes anything installs a new worker, which caches the new build and drops the old one. Page loads try the network first (waiting at most 3 s once a copy is on the device), so a deploy shows on the next load. The worker answers only the app's own GET requests: calls to api.github.com never touch it, and offline writes wait in the sync queue as before. The dev server registers no worker.
- **Everyday use.** Quick capture and check-off throughout the day on the phone and at the desk. Edits made on one device show up on the others after the next sync.

## Capabilities and Constraints

**First version:**
- Add, check off, edit, delete and reorder to-dos.
- **Multiple lists:** each list is a folder in the data repo. Lists are added from the Index and renamed in place (`r`, the list's heading, or the palette). A rename changes only the `name` in the list's `_list.md`: the folder, number and ink stay, so `>03` and `g 03` keep working. Lists are deleted with `Shift D`, from the heading while renaming, or from the palette: their to-dos go with them, a list with open to-dos asks once, `u` undoes, the other lists keep their numbers, and the last list can't be deleted.
- **Due dates:** optional per to-do, with clear signals for due today and overdue.
- **Notes:** a free-text Markdown body under each to-do's title.
- **Tags:** free-form labels, with filtering.
- **Interface language:** English only.

**Data format (built):**
- Each list is a folder. Its `_list.md` holds the list's `index`, `name` and `ink` as YAML front-matter. A folder's name is the list's id, and it keeps its first name when the list is renamed: the name lives only in `_list.md`.
- Every other `.md` file in a folder is one to-do: YAML front-matter with `id`, `title`, `tags`, `due`, `done`, `doneAt`, `order`, `createdAt` and `updatedAt`, and the note as the Markdown body. The file is named after the title (`fix-dripping-kitchen-tap.md`), with the id added when two to-dos in a list share a title. It is renamed when the title changes or the to-do moves to another list.
- Hand edits are welcome. A file needs only a title (`title:` or a `# Heading`); a missing id, order or index is filled in the same way on every device and written back on the to-do's next change. Root files, `README.md` files and folders starting with `.` or `_` are ignored.
- The app reads the whole repo with one recursive Git Trees call, then fetches only the files whose blob id changed, a hundred per GraphQL call.

**Sync model (built):**
- Local-first. Changes apply to the UI immediately and sync in the background. A queue of pending changes (one entry per file) holds them, survives reloads and offline stretches, and is kept in `localStorage` with the last commit read. The device saves 300 ms after an edit, and at once when the page is hidden or closed, so a change made just before closing the app is kept.
- One file per to-do, so edits to different to-dos on different devices never conflict. Each to-do stores its own sort position, so reordering doesn't rewrite a shared list.
- Writes: once edits settle (1.5 s, at most 8 s), all pending changes go into one commit through the Git Data API (tree, commit, then a fast-forward-only ref update). At most one commit every 10 s, and at least 1 s between write requests. A list delete's commit waits while its undo is on offer (up to 30 s), so an undo never reaches GitHub.
- Reads: the branch ref is polled with `If-None-Match` every 60 s while the app is visible, and on focus or return to the tab. GitHub doesn't count 304 "not modified" replies against the rate limit. The ETag kept is always from a read of the commit the device holds, so the first read after a reload is a free 304 too, and a branch reset to an older commit is still seen. A read naming a commit the device moved past less than a minute ago is taken, once, for a lagging copy of the branch and ignored, so it can't undo the device's own commits on screen.
- Conflicts: if the branch moved (a newer head before committing, or a 422 non-fast-forward on the ref update), the app re-reads, merges and retries, up to three times. Each to-do is merged field by field against the last version both sides shared: a field changed on one side takes that side's value; a field changed on both takes the latest write (`updatedAt`), and the band then shows a conflict naming the file. The conflict banner stays until it is dismissed, whatever sync does meanwhile; while the device is offline or a save has failed, the band's word says that instead, and the banner stays under it. A to-do deleted here and changed on GitHub keeps the later of the two; a to-do deleted on GitHub and changed here keeps the change. Deleting a list removes only what that device had seen: a to-do another device changed, added or moved into the list before seeing the delete stays, keeps the list with GitHub's name, number and ink, and the band says so. A reorder alone doesn't count, and a rename or ink change alone never keeps a deleted list. Either way round, both devices end up with the same files. A list's `_list.md` merges the same way, field by field (`index`, `name`, `ink`): a field changed on one device takes that device's value, and a field changed on two (a list renamed on both) keeps the value of the device that syncs last, without a conflict banner. A rename on one device and edits to that list's to-dos on another never meet, since they are different files.
- Failures: the band turns to ink with Retry, and the app retries by itself after 30 s, doubling up to 10 min (or at the time a rate limit names). When the last step of a save, the ref update, gets no answer (a server error or a dropped connection), the app reads the branch once: if it names the commit just made, the save landed and nothing fails; otherwise the save is retried as above. A token GitHub rejects, one without write access, or one that can't find the repo or its branch shows Reconnect instead, which opens the setup screen for a new token without touching pending changes.

**GitHub limits to stay inside** (checked against GitHub's docs on 2026-10-15):
- **Primary rate limit:** 5,000 REST requests per hour per user. This budget is shared by every token and device on the account.
- **Secondary limits:** about 80 write requests per minute and 500 per hour. Leave about 1 second between write requests.
- **Pushes:** at most about 6 per minute per repository, so changes are batched into commits rather than committed per keystroke. Changes that touch many files (e.g. clearing completed items or deleting a list) go in one commit through the Git Data API or GraphQL `createCommitOnBranch`.
- **Directory size:** about 3,000 entries at most per directory, so completed to-dos eventually move to an archive folder.
- **Terms of Service:** a GitHub login may be used by only one person. The app must never ship with embedded credentials or be shared with other people on one account. If it ever becomes multi-user, each user brings their own account and data repo.

**Open decisions:**
- Archiving completed to-dos before a folder nears GitHub's ~3,000-entry limit.
- Whether a deleted list should go to an archive folder instead of being deleted (decide with the question above). For now the git history is the archive.
- Several tabs or windows of To Do on one device each sync on their own, and the last to save its local state wins in `localStorage`. A change saved by a tab that closes before committing can be overwritten by another open tab's next save.

## Brand Commitments

- **Name:** To Do. `sg-gh-todo-opus` is only the repository name.

## Evidence on Hand

The main screen and the first-run setup screen are built (see DESIGN.md), and sync with a data repo works: it was tested on 2026-10-17 against a throwaway private repo through a local proxy, covering adds, edits, moves, check-offs, deletes, hand edits made on github.com, an outage, a same-field conflict and a branch that moved mid-commit. To Do is live at `https://do.sebastienguillon.com`; the first deploy was a manual run of the workflow once Pages was switched on. On 2026-10-17 the owner connected a first device to `sebastienguillon/gh-todo-data` with a fine-grained token and confirmed it works. Syncing between two real devices hasn't been confirmed yet. Deleting a list was tested on 2026-10-18 against an in-memory fake of the GitHub API (with git-correct blob and tree ids), with two browser profiles as two devices. The tests covered every case of a delete meeting another device's change, in both sync orders, plus a device offline for a day, a folder deleted by hand, two devices each deleting one of the last two lists, and single-device cases: undo inside and after the commit hold, a reload before the commit, a delete during a commit in flight, a stale hand copy in the folder, and reuse of the folder's name. All 1,201 checks passed. It hasn't been tried against GitHub itself. Installing and opening offline were checked on 2026-10-17 in desktop Chrome against the built preview: no installability errors, the app opened from the worker with the server stopped, a rebuilt app showed on the first reload after it was served, and an api.github.com call went past the worker. Not yet tried on a phone. The demo data (`src/lib/demo.ts`) is synthetic and only appears on a device that chose to look around before connecting. No logo or marketing copy exist yet.

## Product Principles

1. **Instant, then sync.** No interaction waits on the network. The device's local state drives the UI, and GitHub is where every device's changes come together.
2. **Never lose a change.** Every edit eventually reaches the repo. Conflicts resolve the same way every time, and the sync state can always be seen.
3. **The repo stays readable.** The data is plain files a person can read and edit on github.com, and the app must cope with hand edits.
4. **Be a good GitHub citizen.** Batch writes, use conditional polling, and stay well inside rate limits and the Terms of Service.
5. **Simple by default.** One user, no accounts, and few settings. Lists, dates, notes and tags stay lightweight additions to a plain to-do list.
