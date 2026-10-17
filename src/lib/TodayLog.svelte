<script lang="ts">
  import Capture from './Capture.svelte'
  import { formatDay } from './dates'
  import Icon from './Icon.svelte'
  import { store } from './store.svelte'
  import TodoRow from './TodoRow.svelte'

  let { compact = false }: { compact?: boolean } = $props()

  let late = $derived(store.todayRows.late)
  let due = $derived(store.todayRows.due)
  let lateCount = $derived(late.filter((t) => !t.done).length)
  let dueCount = $derived(due.filter((t) => !t.done).length)
</script>

<section id="today" class="today" aria-labelledby="today-h">
  <header class="day" class:compact>
    <h1 id="today-h" tabindex="-1"><span class="swipe today display">{formatDay(store.today)}</span></h1>
    <p class="summary">
      <span class:strong={lateCount > 0}>{lateCount} late</span>
      <span aria-hidden="true">·</span>
      <span>{dueCount} due today</span>
      <span aria-hidden="true">·</span>
      <span>{store.totalOpen} open in {store.lists.length} lists</span>
    </p>
  </header>

  {#if !compact}
    <Capture />
  {/if}

  {#if store.tagFilter}
    <p class="filtered">
      Showing <strong>#{store.tagFilter}</strong> only
      <button class="btn quiet" onclick={() => store.setTagFilter(null)}><Icon name="close" size={14} /> Show everything</button>
    </p>
  {/if}

  {#if late.length || due.length}
    {#if late.length}
      <ul class="log late-log" aria-label="Late">
        {#each late as todo (todo.id)}
          <TodoRow {todo} context="today" group="late" />
        {/each}
      </ul>
    {/if}
    {#if due.length}
      <ul class="log" aria-label="Due today">
        {#each due as todo (todo.id)}
          <TodoRow {todo} context="today" group="today" />
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="calm">
      Nothing late, nothing due today{store.tagFilter ? ` with #${store.tagFilter}` : ''}. The lists below hold the rest.
    </p>
  {/if}
</section>

<style>
  .today {
    padding-top: 28px;
  }

  .day {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 20px;
    padding: 0 var(--edge) 0 calc(var(--gutter) - 4px);
  }

  h1 {
    font-size: var(--t-display);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  h1:focus-visible {
    outline-offset: 4px;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .summary .strong {
    color: var(--ink);
    font-weight: 700;
  }

  .late-log + .log {
    margin-top: 8px;
  }

  .filtered {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 var(--edge) 8px var(--gutter);
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .filtered strong {
    color: var(--ink);
  }

  .calm {
    padding: 4px var(--edge) 4px var(--gutter);
    color: var(--ink-2);
    line-height: calc(24 / 18);
  }

  @media (max-width: 767px) {
    .today {
      padding-top: 12px;
    }

    .day {
      padding: 4px 16px 8px 40px;
      row-gap: 4px;
    }

    h1 {
      font-size: 2rem;
    }

    .filtered,
    .calm {
      padding-left: 44px;
      padding-right: 16px;
    }
  }
</style>
