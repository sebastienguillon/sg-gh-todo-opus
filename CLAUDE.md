# To Do

- Default branch: `master`, never `main`. This applies to this repo (`sebastienguillon/sg-gh-todo-opus`) and to the data repo (`sebastienguillon/gh-todo-data`). Never create, push to, or reference a `main` branch.
- Before any file, git or GitHub step, name the local folder, the branch and the GitHub repo it concerns.

## Working notes

- Folders: the code is in `~/dev/projects/sebastienguillon/sg-gh-todo-opus`, the private data repo in `~/dev/projects/sebastienguillon/gh-todo-data`.
- The project uses pnpm: `pnpm install`, `pnpm run dev` (Vite dev server), `pnpm run check` (svelte-check and tsc), `pnpm run build` (to `dist/`). CI installs with `--frozen-lockfile`, so commit `pnpm-lock.yaml` with any dependency change.
- On a device with no repo connected, `?demo` opens the demo data, and `?sync=failed`, `conflict` or `offline` pins the sync indicator in that state for review.
- A push to `master` deploys: `.github/workflows/deploy.yml` runs check and build, then publishes to GitHub Pages at https://do.sebastienguillon.com. Run check and build before pushing.
- The local `gh` token lacks the `workflow` scope, so a push of a commit that changes `.github/workflows/` is refused. The owner pushes those from their own terminal.
- Never write a token into a file, a commit or a log. Each device keeps its own token in `localStorage`.
- Where the truth lives: `PRODUCT.md` (product, data format, sync model, open decisions), `DESIGN.md` (the design system as built), `.impeccable/surfaces/src-app-svelte.md` (the main screen's brief), `README.md` (setup and use).
