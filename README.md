# To Do

To Do is a personal to-do app for one person across their own devices. It is a static web app with no server of its own: the only place your lists live is a private GitHub repository that you own, as plain Markdown files you can read and edit anywhere. Changes show on screen at once, are kept on the device while offline, and are committed to the repo in the background.

Live at **https://do.sebastienguillon.com**.

## Using it

### Connect a device

Each device gets its own token, so a lost one can be shut out on its own.

1. Make a **private** repo for your to-dos, such as `you/todo-data`. An empty one is fine: To Do starts it with a README.
2. Make a **fine-grained personal access token** for this device. Under Repository access, choose Only select repositories and pick the data repo. Give it **Contents: Read and write** and nothing else. The setup screen's "New token on GitHub" link opens GitHub's form with that permission and a name such as `To Do · iPhone · 2026-10-17` already filled in; only the repo has to be picked by hand.
3. Open https://do.sebastienguillon.com, paste the repo (`owner/name` or its github.com URL) and the token, and choose Connect.

The setup screen checks the token with one call to the repo. It refuses classic tokens (they reach every repo on the account), public repos and archived repos. To Do syncs with the repo's default branch.

### Install it

To Do can live on a phone's home screen or in a desktop app window:

- **iPhone or iPad (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** the ⋮ menu → Add to Home screen (or Install app).
- **Desktop (Chrome or Edge):** the install icon at the right of the address bar.

Installed, it opens on its own, without the browser's address bar, under the orange band. After one visit with a network, the app itself is kept on the device, so it opens with no network too. Lists and pending changes were already kept there, and they sync once the network is back. When online, each load checks for a newer version, so a deploy shows the next time the app is opened.

### Demo mode

On the setup screen, "Look around with demo data" opens the app on synthetic lists. Demo data stays in this browser and nothing is sent anywhere. To connect later, open the sync word in the band and choose Connect a repo; connecting replaces the demo lists on this device with what the repo holds.

### Replacing a token, disconnecting, revoking a device

The sync word in the band opens the Sync panel:

- **Replace token** connects the same repo with a new token. Changes waiting on the device stay and are sent once the new token works.
- **Disconnect** forgets the token and the lists on this device. The repo keeps everything it has. Changes that haven't reached GitHub yet would be lost, and the panel says how many before you confirm.

To shut out a device you no longer have, delete its token on GitHub at https://github.com/settings/personal-access-tokens (tokens are named after the device and the day they were made). That device then shows that GitHub no longer accepts its token and stops syncing. If a token expires or is revoked on a device you still use, the band shows Reconnect, which opens the setup screen for a new token without touching pending changes.

### Keyboard

Press `?` (or the keyboard button in the band) to show this list in the app.

| Keys | What it does |
| --- | --- |
| `j` `k` | Next or previous row |
| `x` | Done, or reopen |
| `>` | Move to a list |
| `<` | Reschedule |
| `t` | Edit tags |
| `Enter` | Open the row: title, note, actions |
| `n` | Log a task |
| `g` `07` | Jump to list 07 |
| `g` `t` | Jump to Today |
| `r` | Rename the list |
| `Shift` `D` | Delete the list |
| `⌘` `K` | Search or jump |
| `#` | Show only a tag |
| `Alt` `↑` | Move a row up or down |
| `Delete` | Delete the row |
| `u` | Undo a delete, a clear or a rename |
| `Esc` | Close, or clear the tag filter |

`⌘` `K` is `Ctrl` `K` on Windows and Linux.

### Logging a task

When logging a task, `#` adds a tag, `>` files it in a list, and `<` sets a date:

```text
Buy stamps #post >03 <fri
```

- `>` takes a list's two-digit number (`>03`) or the start of its name (`>home`).
- `<` takes a single date word: `today`, `tomorrow` (or `tom`), a weekday (`fri`), a day and month (`24.10`), or a number of days ahead (`+3`).
- Without `>`, the task goes to the list selected in the Index, the one marked in blue. A list is selected by clicking it in the Index, by `g` and its number, or from the search palette. Going to Today clears the selection, and the task then goes to the first list (the Inbox, in a repo To Do started).
- Below the field, a hint shows where Enter will file the task and with which date and tags. The selected list shows there in blue too. On a phone, where the hint is hidden, the field's placeholder names the selected list.
- `Esc` clears the field.

### Lists

- **Add a list** from the Index: choose New list and type its name. It takes the next number and an ink of its own.
- **Rename a list** by pressing `r` on one of its rows (in Today too) or on its heading, by clicking or tapping its name in the heading, or by choosing Rename a list in the search palette (`⌘` `K`, then the list's number or name). Enter, or leaving the field, saves; `Esc` cancels; `u` undoes. Only the name changes: the list keeps its number, ink and folder, so `>03` and `g 03` still work, and the repo records the rename as a change to that folder's `_list.md`.
- **Delete a list** with `Shift` `D` on one of its rows (in Today too) or on its heading, with Delete beside its name while you rename it, or by choosing Delete a list in the search palette (`⌘` `K`, then the list's number or name). A list with open to-dos asks once and says how many go with it; an empty one, or one with only done to-dos, goes at once. `u` undoes it, and nothing reaches GitHub while the undo is on offer. The other lists keep their numbers, and the last list can't be deleted. If another device changed one of its to-dos meanwhile, the list stays with just those, and the band says so.
- Changing a list's number or ink and reordering lists are done in the data repo by hand for now.

### On a phone

- **Swipe a row right** about 80 px to mark it done (or reopen a done row).
- **Swipe a row left** to open a tray with **Move** (`>`) and **Later** (`<`). Swipe back, or tap outside the rows, to close it.
- **Tap a title** to open the row: its title, note and actions, with done, move and reschedule stacked in the gutter.
- **Tap a list's name** in its heading to rename it, or tap Delete beside it to delete the list.
- Tap the bullet to mark a row done.

A drag only counts as a swipe once it is clearly sideways; otherwise the page scrolls. Every action a swipe offers also has a button and a key.

## How the data is stored

The data repo holds one folder per list and one Markdown file per to-do:

- Each folder is a list. Its `_list.md` holds the list's number, name and colour. Renaming a list in To Do rewrites only its `name:`; the folder keeps its first name.
- Every other `.md` file in the folder is one to-do, named after its title (`fix-dripping-kitchen-tap.md`), with its fields as YAML front-matter and its note as the Markdown body.
- Deleting a list in To Do deletes its `_list.md` and its to-do files in one commit (“Delete list …”). Anything else you put in the folder stays.

The full format is in the data repo's own README, which To Do writes when it starts an empty repo. For this owner that is [`sebastienguillon/gh-todo-data`](https://github.com/sebastienguillon/gh-todo-data) (private), whose default branch is `master`.

Files can be edited by hand on github.com or in any editor; a file added by hand needs only a title. To Do batches edits into commits (at most one every 10 seconds) and checks for other devices' commits every 60 seconds while it is visible, and when it regains focus. The git history is a record of every change: a deleted list can be brought back from the commit before its “Delete list …” commit.

## Develop

Requirements: Node 24 and pnpm 12 (the versions the deploy workflow uses).

Install dependencies:

```bash
pnpm install
```

Start the dev server (Vite prints the address, http://localhost:5173 by default):

```bash
pnpm run dev
```

Type-check the app, the Vite config and the service worker (svelte-check, then tsc):

```bash
pnpm run check
```

Build the static site into `dist/`:

```bash
pnpm run build
```

Serve the build locally, with the Content-Security-Policy and service worker it ships with:

```bash
pnpm run preview
```

The dev server registers no service worker; only a build does. To start a preview tab afresh, remove its worker and storage in the browser's developer tools (Application → Storage → Clear site data in Chrome).

### Icons

The home-screen icons (`public/icon-192.png`, `public/icon-512.png` and `public/apple-touch-icon.png`) are drawn from `public/favicon.svg`. After changing the SVG, redraw them with [Inkscape](https://inkscape.org) 1.x installed:

```bash
pnpm run icons
```

### Pointing the dev server at a test API

By default the app talks to `https://api.github.com`. Set `VITE_GITHUB_API` to send its REST and GraphQL calls to a local test proxy instead. The dev server then adds that URL's origin to the policy's `connect-src` (`vite.config.ts`). Builds leave it unset, and the shipped policy only allows `https://api.github.com`. For example:

```bash
VITE_GITHUB_API=http://localhost:8787 pnpm run dev
```

It can also go in a `.env.development.local` file, which git ignores and which `pnpm run build` doesn't read.

### Review flags

On a device with no repo connected, two URL flags help review the screen without a real repo. Both are ignored once a repo is connected.

- `?demo` opens the demo data straight away, without the setup screen and without remembering the choice.
- `?sync=failed` and `?sync=offline` open the demo data with the sync indicator pinned in that state and two sample pending changes; in the failed state, Retry releases the pin. `?sync=conflict` shows the conflict banner, naming `home/fix-dripping-kitchen-tap.md`, until it is dismissed. They combine, as in `?sync=offline&sync=conflict`, to show both at once.

For example, http://localhost:5173/?sync=conflict.

## Deploy

Every push to `master` runs `.github/workflows/deploy.yml`, which installs with pnpm 12 on Node 24, runs `pnpm run check` and `pnpm run build`, and publishes `dist/` to GitHub Pages. Both this repo and the data repo use `master` as the default branch, never `main`.

To deploy without a push, open the repo's Actions tab, pick **Deploy to GitHub Pages** and choose **Run workflow**.

A push that changes a file under `.github/workflows/` needs a GitHub credential with the `workflow` scope. The owner's local `gh` token doesn't have it, so the owner pushes those commits from their own terminal.

The site is set up once, in GitHub and in DNS:

- **Pages.** In this repo's Settings → Pages, the source is GitHub Actions and the custom domain is `do.sebastienguillon.com`. `public/CNAME` records the same domain in the build. The Vite `base` is `/`.
- **DNS.** At the DNS host for `sebastienguillon.com` (DreamHost), a CNAME record points `do` to `sebastienguillon.github.io`. A TXT record, `_github-pages-challenge-sebastienguillon`, verifies `sebastienguillon.com` on the GitHub account (account Settings → Pages → Verified domains), which stops anyone else claiming its subdomains for GitHub Pages. Other subdomains, such as `me.sebastienguillon.com`, are separate sites with nothing to do with To Do.
- **HTTPS.** Enforce HTTPS is on, so `http://` requests redirect to `https://`.

## Security notes

- **A token per device, kept in that browser.** Each device stores its own token in `localStorage`, and the shipped app sends it only to `api.github.com`. Tokens are fine-grained and limited to the data repo with Contents read and write, so a lost device is shut out by deleting its token alone. No credential is built into the app or this repo, and none should ever be committed.
- **Its own origin.** Browser storage is per origin, and every GitHub Pages site on the account shares `sebastienguillon.github.io`, so any of them could read a token stored there. To Do is served from `do.sebastienguillon.com`, which serves nothing else. On any `github.io` address the setup screen explains the risk and refuses to store a token (`sharedOrigin` in `src/lib/remote.svelte.ts`).
- **A private data repo is required.** This code repo is public; the lists are not. The setup screen refuses a public data repo.
- **Content-Security-Policy.** A meta tag in `index.html` limits scripts, styles, fonts, the manifest and the service worker to the app's own origin, images to it and `data:`, and network calls to `https://api.github.com`; `base-uri` and `form-action` are `'none'`. Since the token sits in `localStorage`, keeping every other script out matters. The dev server loosens the policy for its injected styles, HMR websocket and the optional test API (`vite.config.ts`).
- **The service worker stays out of GitHub calls.** The worker (`src/sw.ts`) answers only the app's own GET requests, from a cache of the built files. It lets calls to `api.github.com` go straight to the network and never caches them or the token they carry. It is never registered on a `github.io` address, where a worker at `/` would sit over every Pages site on the account.
- **Framing isn't blocked.** A meta-tag policy can't set `frame-ancestors`, and GitHub Pages can't send response headers, so nothing stops another site from embedding To Do in a frame.

## Project docs

- [`PRODUCT.md`](PRODUCT.md): who To Do is for, the operating context, the data format, the sync model, the GitHub limits it stays inside and the open decisions.
- [`DESIGN.md`](DESIGN.md): the design system: colours, type, layout, components and the rules behind them.
- [`CLAUDE.md`](CLAUDE.md): instructions for coding agents working in this repo.
- [`.impeccable/`](.impeccable): working files from the Impeccable design process: `design.json` (the design system as data), `mocks/decision/` (the HTML mockups compared when picking a direction), `review/` (desktop and phone screenshots from design reviews) and `surfaces/` (the brief for the main screen).
