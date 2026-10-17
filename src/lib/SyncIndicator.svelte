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
  } as const

  let pending = $derived(store.pending.length)
  let text = $derived.by(() => {
    const s = store.sync
    if (s.kind === 'saving') return compact ? 'saving' : `saving · ${pending} pending`
    if (s.kind === 'offline') return compact ? 'offline' : `offline · ${pending} kept here`
    if (s.kind === 'failed') return compact ? 'not saved' : `Sync failed · ${pending} kept here`
    if (s.kind === 'conflict') return 'conflict'
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
    <button class="retry" onclick={() => store.retrySync()}>Retry</button>
  {/if}
</div>

<div id="sync-details" class="details" popover>
  <h2>Sync</h2>
  <p class="status">
    {#if store.sync.kind === 'failed'}
      {store.sync.message}
    {:else if store.sync.kind === 'offline'}
      You're offline. Changes are kept on this device and sent when you're back.
    {:else if store.sync.kind === 'conflict'}
      A file changed on GitHub and here at once. The latest edit was kept.
    {:else if store.sync.kind === 'saving'}
      Saving {pending} {pending === 1 ? 'change' : 'changes'}…
    {:else if store.lastSavedAt}
      Everything saved at {formatTime(store.lastSavedAt)}.
    {:else}
      Everything saved.
    {/if}
  </p>

  {#if store.pending.length}
    <h3>Pending changes</h3>
    <ul class="changes">
      {#each store.pending.slice(-6).reverse() as change, i (i)}
        <li><span class="verb">{VERBS[change.kind]}</span> <code>{change.path}</code></li>
      {/each}
    </ul>
    {#if store.pending.length > 6}<p class="more">and {store.pending.length - 6} more</p>{/if}
  {/if}

  <p class="local">
    GitHub isn't connected on this device yet, so changes are kept in this browser. The list shown is demo data.
  </p>
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
    height: 32px;
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
    height: 28px;
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
</style>
