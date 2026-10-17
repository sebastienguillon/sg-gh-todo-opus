<script lang="ts">
  import { formatTime } from './dates'
  import Icon from './Icon.svelte'
  import { store } from './store.svelte'

  let { compact = false }: { compact?: boolean } = $props()

  const VERBS = {
    added: 'Added',
    edited: 'Edited',
    moved: 'Moved',
    rescheduled: 'Rescheduled',
    done: 'Done',
    reopened: 'Reopened',
    removed: 'Deleted',
    list: 'List',
  } as const

  let pending = $derived(store.pending.length)
  /** One line per pending file, except that a deleted list's line takes in its to-dos'. */
  let lines = $derived.by(() => {
    const folderOf = (path: string) => path.slice(0, path.indexOf('/'))
    const deleted = new Map<string, number>()
    for (const c of store.pending) if (c.kind === 'list' && !store.listById.has(c.id)) deleted.set(folderOf(c.path), 0)
    for (const c of store.pending) {
      const folder = folderOf(c.path)
      if (c.kind === 'removed' && deleted.has(folder)) deleted.set(folder, deleted.get(folder)! + 1)
    }
    const out: { verb: string; path: string; note?: string }[] = []
    for (const c of store.pending) {
      const folder = folderOf(c.path)
      if (!deleted.has(folder) || (c.kind !== 'removed' && c.kind !== 'list')) {
        out.push({ verb: VERBS[c.kind], path: c.path })
      } else if (c.kind === 'list') {
        const n = deleted.get(folder)!
        out.push({ verb: 'Deleted list', path: `${folder}/`, note: n ? `${n} ${n === 1 ? 'to-do' : 'to-dos'}` : undefined })
      }
    }
    return out
  })
  let demo = $derived(store.mode === 'demo')
  let connected = $derived(store.mode === 'connected')
  let branch = $derived(store.remote.connection?.branch)
  let confirming = $state(false)
  /** Offline and failed take the band's word; the conflict banner stays under it meanwhile. */
  let urgent = $derived(store.sync.kind === 'offline' || store.sync.kind === 'failed')
  let text = $derived.by(() => {
    const s = store.sync
    if (s.kind === 'offline') return compact ? 'offline' : `offline · ${pending} kept here`
    if (s.kind === 'failed') return compact ? 'not saved' : `Sync failed · ${pending} kept here`
    if (store.conflict) return 'conflict'
    if (demo) return compact ? 'demo' : 'demo data'
    if (s.kind === 'saving') return compact ? 'saving' : `saving · ${pending} pending`
    return s.at ? (compact ? 'saved' : `saved ${formatTime(s.at)}`) : 'saved'
  })
</script>

<div class="sync" class:failed={store.sync.kind === 'failed'}>
  <button class="state" popovertarget="sync-details" aria-label="Sync: {text}. Show details">
    {#if store.sync.kind === 'offline'}<Icon name="offline" size={14} />{/if}
    {#if store.sync.kind === 'failed'}<Icon name="alert" size={14} />{/if}
    <span>{text}</span>
  </button>
  {#if store.sync.kind === 'failed'}
    <button class="retry" onclick={() => store.retrySync()}>{store.sync.fix === 'reconnect' ? 'Reconnect' : 'Retry'}</button>
  {/if}
</div>

<div id="sync-details" class="details" popover ontoggle={(e) => e.newState === 'closed' && (confirming = false)}>
  <h2>Sync</h2>
  {#snippet conflictLine()}
    {#if store.conflict}
      <p class="status">{store.conflict.message ?? 'A file changed on GitHub and here at once. The latest edit was kept.'}</p>
    {/if}
  {/snippet}
  <!-- What the band's word says comes first. -->
  {#if !urgent}{@render conflictLine()}{/if}
  <p class="status">
    {#if store.sync.kind === 'failed'}
      {store.sync.message}
    {:else if store.sync.kind === 'offline'}
      You're offline. Changes are kept on this device and sent when you're back.
    {:else if store.sync.kind === 'saving'}
      Saving {pending} {pending === 1 ? 'change' : 'changes'}…
    {:else if demo}
      These lists are demo data.
    {:else if store.lastSavedAt}
      Everything saved at {formatTime(store.lastSavedAt)}.
    {:else}
      Everything saved.
    {/if}
  </p>
  {#if urgent}{@render conflictLine()}{/if}

  {#if lines.length}
    <h3>Pending changes</h3>
    <ul class="changes">
      {#each lines.slice(-6).reverse() as line, i (i)}
        <li><span class="verb">{line.verb}</span> <code>{line.path}</code>{#if line.note} · {line.note}{/if}</li>
      {/each}
    </ul>
    {#if lines.length > 6}<p class="more">and {lines.length - 6} more</p>{/if}
  {/if}

  <div class="local">
    {#if connected}
      <p>
        Synced with <strong>{store.remote.repoName}</strong> on GitHub{branch === 'master' ? '' : `, branch ${branch}`}.
        {#if store.remote.lastCheckedAt}Checked for changes at {formatTime(store.remote.lastCheckedAt)}.{/if}
      </p>
      {#if confirming}
        <p class="confirm">
          Disconnecting forgets the token and the lists on this device. The repo keeps everything it has.
          {#if pending}<strong>{pending} {pending === 1 ? "change hasn't" : "changes haven't"} reached GitHub and would be lost.</strong>{/if}
        </p>
        <div class="actions">
          <button class="btn" onclick={() => store.disconnect()}>Disconnect this device</button>
          <button class="btn quiet" onclick={() => (confirming = false)}>Keep</button>
        </div>
      {:else}
        <div class="actions">
          <button class="btn quiet" onclick={() => store.remote.check()}>Check now</button>
          <button class="btn quiet" onclick={() => store.openSetup()}>Replace token</button>
          <button class="btn quiet" onclick={() => (confirming = true)}>Disconnect</button>
        </div>
      {/if}
    {:else}
      <p>GitHub isn't connected on this device, so nothing leaves this browser.</p>
      <div class="actions">
        <button class="btn" onclick={() => store.openSetup()}>Connect a repo</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .sync {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font-size: var(--t-meta);
    font-weight: 500;
    white-space: nowrap;
  }

  .state:hover {
    border-color: currentColor;
  }

  .failed .state {
    font-weight: 700;
  }

  .retry {
    min-height: 28px;
    padding: 0 12px;
    border: 1px solid currentColor;
    background: var(--on-alarm);
    color: var(--alarm);
    font-size: var(--t-meta);
    font-weight: 700;
  }

  .details {
    position: fixed;
    inset: calc(var(--band) + 4px) 16px auto auto;
    width: min(380px, calc(100vw - 32px));
    margin: 0;
    padding: 16px;
    border: 1px solid var(--ink);
    background: var(--pad);
    color: var(--ink);
  }

  h2 {
    font-size: var(--t-sub);
    font-weight: 800;
  }

  h3 {
    margin-top: 14px;
    font-size: var(--t-meta);
    font-weight: 700;
  }

  .status {
    margin-top: 6px;
    line-height: 1.45;
  }

  .changes {
    display: grid;
    gap: 4px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--t-meta);
  }

  .verb {
    display: inline-block;
    min-width: 84px;
    color: var(--ink-2);
  }

  code {
    font: inherit;
    overflow-wrap: anywhere;
  }

  .more {
    margin-top: 4px;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .local {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: var(--ink-2);
    font-size: var(--t-meta);
    line-height: 1.45;
  }

  .local strong {
    color: var(--ink);
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .confirm {
    margin-top: 8px;
    color: var(--ink);
  }

  /* Quiet buttons pull their box out so the first label lines up with the text above. */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin: 8px 0 0;
  }

  .actions:has(> .quiet:first-child) {
    margin-left: -12px;
  }

  .actions .btn {
    font-size: var(--t-meta);
    color: var(--ink);
  }

  @media (max-width: 767px) {
    .actions .btn {
      min-height: 44px;
    }
  }
</style>
