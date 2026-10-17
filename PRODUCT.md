# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Svelte + Vite + TypeScript, managed with pnpm. Shipped as a static, installable web app (PWA) on GitHub Pages from this repository (`sebastienguillon/sg-gh-todo-opus`). There is no app server.

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
- **Device access.** On first launch, each device asks for a fine-grained personal access token limited to the data repo, with Contents read and write only. The token is stored only on that device. Each device has its own token, so a lost device can be revoked on its own. The app has no login of its own.
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

**Sync model (from the feasibility analysis, not yet built):**
- Local-first. Changes apply to the UI immediately and sync in the background. A queue holds changes while offline.
- One file per to-do, so edits to different to-dos on different devices never conflict. Each to-do stores its own sort position, so reordering doesn't rewrite a shared list.
- Conflicts on the same to-do come back from the API as a 409 (the file's hash has changed). The app refetches and retries, and the latest write wins.
- No webhooks are possible without a server, so other devices' changes arrive by polling the branch with conditional (ETag) requests. GitHub doesn't count 304 "not modified" replies against the rate limit.

**GitHub limits to stay inside** (checked against GitHub's docs on 2026-10-15):
- **Primary rate limit:** 5,000 REST requests per hour per user. This budget is shared by every token and device on the account.
- **Secondary limits:** about 80 write requests per minute and 500 per hour. Leave about 1 second between write requests.
- **Pushes:** at most about 6 per minute per repository, so changes are batched into commits rather than committed per keystroke. Changes that touch many files (e.g. clearing completed items) go in one commit through the Git Data API or GraphQL `createCommitOnBranch`.
- **Directory size:** about 3,000 entries at most per directory, so completed to-dos eventually move to an archive folder.
- **Terms of Service:** a GitHub login may be used by only one person. The app must never ship with embedded credentials or be shared with other people on one account. If it ever becomes multi-user, each user brings their own account and data repo.

**Open decisions:**
- Product name. `sg-gh-todo-opus` is only the repository name.
- Data repo name and file format details (front-matter fields, file naming).
- Sync and poll intervals, and how the app shows pending, synced and failed states.
- Whether this code repo stays public. GitHub Pages on a free plan needs a public repo, and no secrets live in the code.

## Evidence on Hand

This is a new project: no code, content, assets, logo or copy exist yet. The only reference material is the feasibility discussion summarized above.

## Product Principles

1. **Instant, then sync.** No interaction waits on the network. The device's local state drives the UI, and GitHub is where every device's changes come together.
2. **Never lose a change.** Every edit eventually reaches the repo. Conflicts resolve the same way every time, and the sync state can always be seen.
3. **The repo stays readable.** The data is plain files a person can read and edit on github.com, and the app must cope with hand edits.
4. **Be a good GitHub citizen.** Batch writes, use conditional polling, and stay well inside rate limits and the Terms of Service.
5. **Simple by default.** One user, no accounts, and few settings. Lists, dates, notes and tags stay lightweight additions to a plain to-do list.
