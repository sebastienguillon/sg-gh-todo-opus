<script lang="ts">
  import Icon from './Icon.svelte'
  import Signifier from './Signifier.svelte'
  import { pad2, store } from './store.svelte'
  import TodoRow from './TodoRow.svelte'
  import type { TodoList } from './types'

  let { list }: { list: TodoList } = $props()

  let open = $derived(store.openIn(list.id))
  let done = $derived(store.doneIn(list.id))
  let foldOpen = $derived(!!store.openDone[list.id])
  let filtered = $derived(!!store.tagFilter)

  let section = $state<HTMLElement>()

  function clearDone() {
    // The fold and its button go away with the done rows; move focus into the list first.
    // Under a tag filter an emptied section leaves entirely, so focus goes to the next one.
    const ownRow = section?.querySelector<HTMLElement>('.log:not(.done-log) [data-row-focus]')
    let next = section?.nextElementSibling
    while (next && !next.matches('section.list')) next = next.nextElementSibling
    const target =
      ownRow ??
      (filtered
        ? (next?.querySelector<HTMLElement>('[data-row-focus]') ?? next?.querySelector<HTMLElement>('h2') ?? document.getElementById('today-h'))
        : section?.querySelector<HTMLElement>('h2'))
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
    store.clearDone(list.id)
  }
</script>

{#if !filtered || open.length || done.length}
  <section bind:this={section} class="list" id="list-{list.id}" aria-labelledby="h-{list.id}" style:--list-ink="var(--list-{list.ink})">
    <header class="head">
      <h2 id="h-{list.id}" tabindex="-1">
        <span class="num">{pad2(list.index)}</span>
        <span class="name">{list.name}</span>
      </h2>
      <span class="count">{open.filter((t) => !t.done).length} open</span>
      <span class="jump" aria-hidden="true"><kbd>g</kbd><kbd>{pad2(list.index)}</kbd></span>
    </header>

    {#if open.length}
      <ul class="log" aria-labelledby="h-{list.id}">
        {#each open as todo (todo.id)}
          <TodoRow {todo} context="list" />
        {/each}
      </ul>
    {:else}
      <p class="empty">Nothing open in {list.name}.</p>
    {/if}

    {#if done.length}
      <div class="perforation">
        <button
          class="fold"
          aria-expanded={foldOpen}
          aria-controls="done-{list.id}"
          onclick={() => (store.openDone[list.id] = !foldOpen)}
        >
          <Signifier mark="done" />
          <span>{done.length} done</span>
          <span class="chev" class:up={foldOpen}><Icon name="chevron" size={14} /></span>
        </button>
        {#if foldOpen}
          <button class="btn quiet clear" onclick={clearDone}>Clear done</button>
        {/if}
      </div>
      {#if foldOpen}
        <ul class="log done-log" id="done-{list.id}" aria-label="Done in {list.name}">
          {#each done as todo (todo.id)}
            <TodoRow {todo} context="list" />
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .list {
    padding-top: 32px;
    scroll-margin-top: calc(var(--band) + 8px);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    min-height: 48px;
    padding: 0 var(--edge) 0 var(--gutter);
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: var(--t-head);
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }

  h2:focus-visible {
    outline-offset: 4px;
  }

  .num {
    color: var(--list-ink);
  }

  .count {
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .jump {
    display: flex;
    gap: 3px;
    margin-left: auto;
    color: var(--ink-3);
  }

  .empty {
    padding: 6px var(--edge) 6px var(--gutter);
    color: var(--ink-2);
    line-height: 20px;
  }

  .perforation {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--row);
    margin-top: 8px;
    padding-left: 8px;
    /* The micro-perforated tear line above Done. */
    border-top: 1px dashed var(--rule);
  }

  .fold {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: var(--row);
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .fold :global(.signifier) {
    width: 14px;
    height: 14px;
  }

  .fold:hover {
    color: var(--ink);
  }

  .chev {
    display: inline-flex;
    transition: transform var(--fast) var(--ease-out);
  }

  .chev.up {
    transform: rotate(180deg);
  }

  .clear {
    min-height: 28px;
    font-size: var(--t-meta);
  }

  @media (max-width: 767px) {
    .head {
      padding: 0 16px 0 44px;
    }

    .jump {
      display: none;
    }

    .empty {
      padding-left: 44px;
    }

    .perforation {
      padding-left: 2px;
    }
  }
</style>
