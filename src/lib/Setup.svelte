<script lang="ts">
  import { onMount } from 'svelte'
  import { todayISO } from './dates'
  import Icon from './Icon.svelte'
  import { HOME, parseRepo, SetupError, sharedOrigin } from './remote.svelte'
  import Signifier from './Signifier.svelte'
  import { store } from './store.svelte'

  // First run on a device, connecting from the demo, or replacing this device's token.
  const replacing = store.mode === 'connected'
  const pendingCount = store.pending.length

  let repo = $state(replacing ? store.remote.repoName : '')
  let token = $state('')
  let busy = $state(false)
  let step = $state('')
  let error = $state<{ message: string; field: 'repo' | 'token' | null } | null>(null)
  let repoInput = $state<HTMLInputElement>()
  let tokenInput = $state<HTMLInputElement>()

  // Every Pages site on the account shares a github.io origin, and with it this browser storage.
  const shared = sharedOrigin()

  function device(): string {
    const ua = navigator.userAgent
    if (/iPhone/.test(ua)) return 'iPhone'
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
    if (/Android/.test(ua)) return 'Android'
    if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
    if (/Windows/.test(ua)) return 'Windows'
    if (/Linux|CrOS/.test(ua)) return 'Linux'
    return 'this device'
  }

  // GitHub pre-fills a fine-grained token from the link; only the repo itself has to be picked by hand.
  let tokenUrl = $derived.by(() => {
    const owner = parseRepo(repo)?.owner
    const params = new URLSearchParams({
      name: `To Do · ${device()} · ${todayISO()}`,
      description: 'To Do on one device: reads and writes the to-do data repo.',
      contents: 'write',
    })
    if (owner) params.set('target_name', owner)
    return `https://github.com/settings/personal-access-tokens/new?${params}`
  })

  onMount(() => (replacing ? tokenInput : repoInput)?.focus())

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (busy) return
    error = null
    busy = true
    try {
      await store.connect(token, repo, (text) => (step = text))
    } catch (err) {
      error = err instanceof SetupError ? { message: err.message, field: err.field } : { message: String(err), field: null }
      if (error.field === 'repo') repoInput?.focus()
      else if (error.field === 'token') tokenInput?.select()
    } finally {
      busy = false
      step = ''
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && store.mode !== 'setup' && !busy) store.closeSetup()
  }
</script>

<svelte:window {onkeydown} />

<header class="band">
  <span class="spacer"></span>
  <span class="state">{replacing ? store.remote.repoName : 'not connected'}</span>
</header>

<main class="setup" aria-labelledby="setup-h">
  <div class="head">
    <h1 id="setup-h">{replacing ? "Replace this device's token" : 'Connect To Do to GitHub'}</h1>
    {#if replacing}
      <p class="lede">
        A new fine-grained token for <strong>{store.remote.repoName}</strong>, with Contents set to Read and write.
        {#if pendingCount}
          The {pendingCount} {pendingCount === 1 ? 'change' : 'changes'} waiting on this device stay here and are sent once the new token
          works.
        {:else}
          Everything on this device stays as it is.
        {/if}
      </p>
    {:else}
      <p class="lede">
        To Do keeps your lists in a private GitHub repo that you own, as plain Markdown files you can read and edit anywhere. Each
        device gets its own token, so a lost one can be shut out on its own.
      </p>
    {/if}
  </div>

  {#if shared}
    <p class="warn" role="alert">
      <Icon name="alert" />
      <span>
        To Do won't store a token here. Every GitHub Pages site on the account shares <strong>{location.hostname}</strong>, and its
        browser storage with it, so any of them could read the token. Open To Do at
        <a href={HOME}>{HOME.replace('https://', '')}</a> instead.
      </span>
    </p>
  {/if}

  <ol class="steps">
    {#if !replacing}
      <li>
        <span class="mark" aria-hidden="true"><Signifier mark="open" /></span>
        <div>
          <p><strong>Make a private repo</strong> for your to-dos, such as <code>you/todo-data</code>. An empty one is fine.</p>
          <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">New repo on GitHub</a>
        </div>
      </li>
    {/if}
    <li>
      <span class="mark" aria-hidden="true"><Signifier mark="open" /></span>
      <div>
        <p>
          <strong>Make a fine-grained token</strong> for this device. Under Repository access, choose Only select repositories and pick
          the repo. The link asks for Contents: Read and write, and nothing else.
        </p>
        <a href={tokenUrl} target="_blank" rel="noopener noreferrer">New token on GitHub</a>
      </div>
    </li>
    <li>
      <span class="mark" aria-hidden="true"><Signifier mark="open" /></span>
      <div><p><strong>Paste {replacing ? 'it' : 'both'} here.</strong></p></div>
    </li>
  </ol>

  <form class="form" onsubmit={submit} novalidate>
    <label for="setup-repo">Repo</label>
    <input
      id="setup-repo"
      bind:this={repoInput}
      bind:value={repo}
      class="field big"
      placeholder="you/todo-data"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      readonly={replacing}
      disabled={shared}
      aria-invalid={error?.field === 'repo' || undefined}
      aria-describedby={error?.field === 'repo' ? 'setup-error' : undefined}
    />

    <label for="setup-token">Token</label>
    <input
      id="setup-token"
      bind:this={tokenInput}
      bind:value={token}
      type="password"
      disabled={shared}
      class="field big"
      placeholder="github_pat_…"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      aria-invalid={error?.field === 'token' || undefined}
      aria-describedby="setup-token-hint{error?.field === 'token' ? ' setup-error' : ''}"
    />
    <p class="hint" id="setup-token-hint">Kept only in this browser on this device, and sent only to GitHub.</p>

    <div class="status" aria-live="polite">
      {#if error}
        <p class="error" id="setup-error"><Icon name="alert" /><span>{error.message}</span></p>
      {:else if busy}
        <p class="step">{step}</p>
      {/if}
    </div>

    <div class="actions">
      <button type="submit" class="btn primary" disabled={busy || shared}>{busy ? 'Connecting…' : replacing ? 'Use this token' : 'Connect'}</button>
      {#if store.mode === 'setup'}
        <button type="button" class="btn quiet" disabled={busy} onclick={() => store.useDemo()}>Look around with demo data</button>
      {:else}
        <button type="button" class="btn quiet" disabled={busy} onclick={() => store.closeSetup()}>Back <kbd>esc</kbd></button>
      {/if}
    </div>
    {#if store.mode === 'demo'}
      <p class="hint">Connecting replaces the demo lists on this device with what the repo holds.</p>
    {/if}
  </form>
</main>

<style>
  .band {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    height: var(--band);
    padding: 0 12px;
    background: var(--orange);
    color: var(--on-orange);
  }

  .spacer {
    flex: 1;
  }

  .state {
    padding: 0 10px;
    font-size: var(--t-meta);
    font-weight: 500;
    white-space: nowrap;
  }

  .setup {
    max-width: 1080px;
    padding: 28px 0 96px;
  }

  /* Text starts on the gutter line; the column stays a readable measure. */
  .head,
  .warn,
  .form {
    max-width: calc(var(--gutter) + 600px);
    padding: 0 var(--edge) 0 var(--gutter);
  }

  h1 {
    font-size: var(--t-head);
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }

  .lede {
    margin-top: 10px;
    color: var(--ink-2);
    line-height: 1.45;
  }

  .lede strong,
  .warn strong {
    color: var(--ink);
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .warn {
    display: flex;
    gap: 8px;
    margin-top: 20px;
    line-height: 1.45;
  }

  .warn :global(.icon) {
    margin-top: 2px;
  }

  /* The steps are a rapid log of their own: a bullet in the gutter for each thing to do. */
  .steps {
    max-width: calc(var(--gutter) + 600px);
    margin: 24px 0 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: grid;
    grid-template-columns: var(--gutter) minmax(0, 1fr);
    padding: 4px var(--edge) 4px 0;
    line-height: calc(24 / 18);
  }

  .mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: var(--body-line);
    margin-left: 8px;
  }

  .steps a {
    display: inline-block;
    margin-top: 2px;
    font-size: var(--t-meta);
    font-weight: 500;
    line-height: calc(24 / 14.625);
  }

  code {
    font: inherit;
    font-weight: 600;
  }

  .form {
    display: grid;
    margin-top: 20px;
  }

  label {
    margin: 12px 0 4px;
    font-size: var(--t-meta);
    font-weight: 700;
  }

  .big {
    min-height: 44px;
    font-size: var(--t-sub);
    border-color: var(--ink);
  }

  .big[readonly] {
    border-color: var(--rule);
    color: var(--ink-2);
  }

  .big:disabled {
    border-color: var(--rule);
    color: var(--ink-3);
    cursor: not-allowed;
  }

  .big[aria-invalid='true'] {
    outline: 2px solid var(--ink);
    outline-offset: 0;
  }

  .hint {
    margin-top: 6px;
    color: var(--ink-2);
    font-size: var(--t-meta);
    line-height: calc(20 / 14.625);
  }

  .status {
    min-height: 20px;
    margin-top: 12px;
  }

  .error {
    display: flex;
    gap: 8px;
    font-weight: 700;
    line-height: 1.45;
  }

  .error :global(.icon) {
    margin-top: 2px;
  }

  .step {
    color: var(--ink-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  @media (max-width: 767px) {
    .band {
      padding: env(safe-area-inset-top) 6px 0 4px;
      height: calc(52px + env(safe-area-inset-top));
    }

    .setup {
      padding: 20px 0 48px;
    }

    .head,
    .warn,
    .form {
      padding: 0 16px 0 44px;
    }

    .steps li {
      grid-template-columns: 44px minmax(0, 1fr);
      padding: 12px 16px 12px 0;
    }

    .mark {
      width: 40px;
      margin-left: 2px;
    }

    .steps a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      margin-top: 0;
    }

    .actions .btn {
      min-height: 44px;
    }

    .actions kbd {
      display: none;
    }
  }
</style>
