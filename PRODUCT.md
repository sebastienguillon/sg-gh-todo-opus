# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Svelte + Vite + TypeScript, managed with pnpm. Shipped as a static, installable web app (PWA) on GitHub Pages from this repository (`sebastienguillon/sg-gh-todo-opus`), served from **its own hostname, `do.sebastienguillon.com`**, rather than the shared `sebastienguillon.github.io`. There is no app server. A GitHub Actions workflow (`.github/workflows/deploy.yml`) checks, builds and deploys every push to `main`.

## Users

One person: the owner of the GitHub account, using it across several of their own devices. These are desktop and laptop browsers plus a phone, where it is installed as a home-screen app. Desktop and phone get equal care. There are no other users, no sign-up, and no sharing or collaboration.

## Product Purpose

A simple personal to-do app whose only persistence is a private GitHub repository the owner controls. Success means:
- Open it on any of the owner's devices and see the same lists.
- Capture and check off items instantly.
- Keep working offline, and have changes sync later.
- Never lose a change.

## Positioning

The data never lives in a vendor database or on an app server. It is a set of plain files in the owner's own private GitHub repo. Git history serves as a full record of every change. The files can be read or hand-edited on github.com or in any editor. The app itself is just a static site that reads and writes that repo.

## Operating Context

- **Two repositories.** This repo holds the app code and serves it through GitHub Pages. A separate private data repo holds the to-dos. The data repo's name is not decided yet.
- **Device access.** On first launch, each device asks for a fine-grained personal access token limited to the data repo, with Contents read and write only. The setup screen links to GitHub's token form pre-filled with that permission (only the repo has to be picked by hand), checks the token with one call to the repo, refuses classic tokens and public repos, and starts an empty repo with a README. The token is stored only on that device (`localStorage`). Each device has its own token, so a lost device can be revoked on its own. The app has no login of its own. A device can also look around with demo data first; demo data is never seeded once a repo is connected.
- **Own origin.** Browser storage is per origin, and every GitHub Pages site on the account shares `sebastienguillon.github.io`. So To Do is served from `do.sebastienguillon.com`, a GitHub Pages custom domain (set in the repo's Pages settings, recorded in `public/CNAME`; DNS is a CNAME from `do` to `sebastienguillon.github.io`; HTTPS enforced). Nothing else is served from that hostname. That keeps its token storage apart from any other site the owner publishes. On any github.io address the setup screen explains the risk and refuses to store a token. The Vite build `base` is `/`.
- **Content Security Policy.** A meta tag in `index.html` limits scripts, styles and fonts to the app's own origin, images to it and `data:`, and network calls to `https://api.github.com`. The dev server loosens it for its injected styles, HMR websocket and an optional local test API (`vite.config.ts`). A meta policy can't set `frame-ancestors`, and GitHub Pages can't send headers.
- **Transport.** The browser talks to the GitHub REST/GraphQL API (api.github.com). The git endpoints on github.com don't allow cross-origin requests, so the app has no in-browser git clone.
- **Everyday use.** Quick capture and check-off throughout the day on the phone and at the desk. Edits made on one device show up on the others after the next sync.

## Capabilities and Constraints

**First version:**
- Add, check off, edit, delete and reorder to-dos.
- **Multiple lists:** each list is a folder in the data repo.
- **Due dates:** optional per to-do, with clear signals for due today and overdue.
- **Notes:** a free-text Markdown body under each to-do's title.
- **Tags:** free-form labels, with filtering.
- **Interface language:** English only.

**Data format (built):**
- Each list is a folder. Its `_list.md` holds the list's `index`, `name` and `ink` as YAML front-matter. A folder's name is the list's id.
- Every other `.md` file in a folder is one to-do: YAML front-matter with `id`, `title`, `tags`, `due`, `done`, `doneAt`, `order`, `createdAt` and `updatedAt`, and the note as the Markdown body. The file is named after the title (`fix-dripping-kitchen-tap.md`), with the id added when two to-dos in a list share a title. It is renamed when the title changes or the to-do moves to another list.
- Hand edits are welcome. A file needs only a title (`title:` or a `# Heading`); a missing id, order or index is filled in the same way on every device and written back on the to-do's next change. Root files, `README.md` files and folders starting with `.` or `_` are ignored.
- The app reads the whole repo with one recursive Git Trees call, then fetches only the files whose blob id changed, a hundred per GraphQL call.

**Sync model (built):**
- Local-first. Changes apply to the UI immediately and sync in the background. A queue of pending changes (one entry per file) holds them, survives reloads and offline stretches, and is kept in `localStorage` with the last commit read.
- One file per to-do, so edits to different to-dos on different devices never conflict. Each to-do stores its own sort position, so reordering doesn't rewrite a shared list.
- Writes: once edits settle (1.5 s, at most 8 s), all pending changes go into one commit through the Git Data API (tree, commit, then a fast-forward-only ref update). At most one commit every 10 s, and at least 1 s between write requests.
- Reads: the branch ref is polled with `If-None-Match` every 60 s while the app is visible, and on focus or return to the tab. GitHub doesn't count 304 "not modified" replies against the rate limit.
- Conflicts: if the branch moved (a newer head before committing, or a 422 non-fast-forward on the ref update), the app re-reads, merges and retries, up to three times. Each to-do is merged field by field against the last version both sides shared: a field changed on one side takes that side's value; a field changed on both takes the latest write (`updatedAt`), and the band then shows a conflict naming the file. A delete and an edit of the same to-do also resolve by latest write.
- Failures: the band turns to ink with Retry, and the app retries by itself after 30 s, doubling up to 10 min (or at the time a rate limit names). A token GitHub rejects, or one without write access, shows Reconnect instead, which opens the setup screen for a new token without touching pending changes.

**GitHub limits to stay inside** (checked against GitHub's docs on 2026-10-15):
- **Primary rate limit:** 5,000 REST requests per hour per user. This budget is shared by every token and device on the account.
- **Secondary limits:** about 80 write requests per minute and 500 per hour. Leave about 1 second between write requests.
- **Pushes:** at most about 6 per minute per repository, so changes are batched into commits rather than committed per keystroke. Changes that touch many files (e.g. clearing completed items) go in one commit through the Git Data API or GraphQL `createCommitOnBranch`.
- **Directory size:** about 3,000 entries at most per directory, so completed to-dos eventually move to an archive folder.
- **Terms of Service:** a GitHub login may be used by only one person. The app must never ship with embedded credentials or be shared with other people on one account. If it ever becomes multi-user, each user brings their own account and data repo.

**Open decisions:**
- Data repo name.
- Archiving completed to-dos before a folder nears GitHub's ~3,000-entry limit.
- Several tabs or windows of To Do on one device each sync on their own, and the last to save its local state wins in `localStorage`.
- Whether this code repo stays public. GitHub Pages on a free plan needs a public repo, and no secrets live in the code.

## Brand Commitments

- **Name:** To Do. `sg-gh-todo-opus` is only the repository name.

## Evidence on Hand

The main screen and the first-run setup screen are built (see DESIGN.md), and sync with a data repo works: it was tested on 2026-10-17 against a throwaway private repo, covering adds, edits, moves, check-offs, deletes, hand edits made on github.com, an outage, a same-field conflict and a branch that moved mid-commit. The demo data (`src/lib/demo.ts`) is synthetic and only appears on a device that chose to look around before connecting. No real to-dos, logo or marketing copy exist yet.

## Product Principles

1. **Instant, then sync.** No interaction waits on the network. The device's local state drives the UI, and GitHub is where every device's changes come together.
2. **Never lose a change.** Every edit eventually reaches the repo. Conflicts resolve the same way every time, and the sync state can always be seen.
3. **The repo stays readable.** The data is plain files a person can read and edit on github.com, and the app must cope with hand edits.
4. **Be a good GitHub citizen.** Batch writes, use conditional polling, and stay well inside rate limits and the Terms of Service.
5. **Simple by default.** One user, no accounts, and few settings. Lists, dates, notes and tags stay lightweight additions to a plain to-do list.
