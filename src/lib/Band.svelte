<script lang="ts">
  import { formatDay } from './dates'
  import Icon from './Icon.svelte'
  import { store } from './store.svelte'
  import SyncIndicator from './SyncIndicator.svelte'
  import { ui } from './ui.svelte'

  let { isPhone }: { isPhone: boolean } = $props()

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
</script>

<header class="band" class:alarm={store.sync.kind === 'failed'}>
  {#if isPhone}
    <button class="icon-btn" aria-label="Index of lists" onclick={() => (ui.sheet = true)}>
      <Icon name="list" size={18} />
    </button>
    <span class="date" class:shown={!ui.headingVisible} aria-hidden="true">{formatDay(store.today)}</span>
    <span class="spacer"></span>
    <button class="icon-btn" aria-label="Search or jump" onclick={() => ui.openPalette('search')}>
      <Icon name="search" size={18} />
    </button>
    <button class="icon-btn" class:on={!!store.tagFilter} aria-label={store.tagFilter ? `Tag filter: #${store.tagFilter}` : 'Filter by tag'} onclick={() => ui.openPalette('tag')}>
      <Icon name="hash" size={18} />
    </button>
    <SyncIndicator compact />
  {:else}
    <button class="icon-btn" aria-label={ui.railOpen ? 'Hide the Index' : 'Show the Index'} aria-pressed={ui.railOpen} title="Index" onclick={() => ui.toggleRail()}>
      <Icon name="index" />
    </button>
    <button class="search" onclick={() => ui.openPalette('search')}>
      <Icon name="search" />
      <span class="label">Search or jump to a list</span>
      <kbd>{mac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd>
    </button>
    {#if store.tagFilter}
      <span class="chip">
        <button class="chip-tag" onclick={() => ui.openPalette('tag')}>#{store.tagFilter}</button>
        <button class="chip-x" aria-label="Clear the #{store.tagFilter} filter" onclick={() => store.setTagFilter(null)}>
          <Icon name="close" size={14} />
        </button>
      </span>
    {:else}
      <button class="tags" onclick={() => ui.openPalette('tag')}>
        <Icon name="hash" />
        <span>Tags</span>
        <kbd>#</kbd>
      </button>
    {/if}
    <span class="spacer"></span>
    <button class="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onclick={() => ui.openHelp()}>
      <Icon name="keyboard" />
    </button>
    <SyncIndicator />
  {/if}
</header>

<style>
  .band {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--band);
    padding: 0 12px;
    background: var(--orange);
    color: var(--on-orange);
    transition: background-color 200ms var(--ease-out), color 200ms var(--ease-out);
  }

  .band.alarm {
    background: var(--alarm);
    color: var(--on-alarm);
  }

  .spacer {
    flex: 1;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
  }

  .icon-btn:hover,
  .icon-btn.on {
    border-color: currentColor;
  }

  .icon-btn[aria-pressed='true'] {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(420px, 40vw);
    min-height: 32px;
    padding: 0 8px 0 10px;
    border: 1px solid currentColor;
    background: color-mix(in srgb, var(--pad) 88%, var(--orange));
    color: var(--ink);
    text-align: left;
  }

  .alarm .search {
    border-color: var(--pad);
  }

  .search .label {
    flex: 1;
    color: var(--ink-2);
  }

  .search kbd {
    color: var(--ink-2);
  }

  .search:hover {
    background: var(--pad);
  }

  .tags,
  .chip-tag {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font-weight: 500;
  }

  .tags:hover {
    border-color: currentColor;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid currentColor;
    background: var(--pad);
    color: var(--ink);
  }

  .chip-tag {
    font-weight: 700;
  }

  .chip-x {
    display: grid;
    place-items: center;
    width: 30px;
    height: 32px;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--rule);
    background: transparent;
    color: inherit;
  }

  .chip-x:hover {
    background: var(--pad-3);
  }

  .date {
    font-weight: 800;
    font-size: var(--t-sub);
    letter-spacing: -0.01em;
    opacity: 0;
    transition: opacity var(--fast) var(--ease-out);
  }

  .date.shown {
    opacity: 1;
  }

  .band :global(:focus-visible) {
    outline-color: currentColor;
  }

  @media (max-width: 767px) {
    .band {
      gap: 2px;
      padding: env(safe-area-inset-top) 6px 0 4px;
      height: calc(52px + env(safe-area-inset-top));
    }

    .icon-btn {
      width: 44px;
      height: 44px;
    }
  }
</style>
