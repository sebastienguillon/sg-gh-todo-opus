<script lang="ts">
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import { pad2, store } from './store.svelte'
  import { ui } from './ui.svelte'

  let { inSheet = false }: { inSheet?: boolean } = $props()

  let adding = $state(false)
  let name = $state('')
  let addButton = $state<HTMLButtonElement>()

  async function stopAdding() {
    adding = false
    await tick()
    addButton?.focus()
  }

  let lateCount = $derived(store.todayRows.late.filter((t) => !t.done).length)
  let dueCount = $derived(store.todayRows.due.filter((t) => !t.done).length)

  function addList(e: SubmitEvent) {
    e.preventDefault()
    const list = store.addList(name)
    name = ''
    adding = false
    if (list) requestAnimationFrame(() => ui.jumpToList(list.id))
  }

  function focusOnMount(el: HTMLInputElement) {
    el.focus()
  }
</script>

<nav class="index" aria-label="Index">
  {#if !inSheet}<h2 class="title">Index</h2>{/if}
  <ul>
    <li>
      <a href="#today" class="item today" onclick={(e) => { e.preventDefault(); ui.jumpToToday() }}>
        <span class="num"><Icon name="calendar" size={14} /></span>
        <span class="name">Today</span>
        <span class="count">
          {#if lateCount}<span class="swipe late">{lateCount}</span>{/if}
          <span>{dueCount}</span>
        </span>
      </a>
    </li>
    {#each store.listsInOrder as list (list.id)}
      <li style:--list-ink="var(--list-{list.ink})">
        <a
          href="#list-{list.id}"
          class="item"
          aria-current={ui.activeList === list.id ? 'location' : undefined}
          onclick={(e) => {
            e.preventDefault()
            ui.jumpToList(list.id)
          }}
        >
          <span class="num">{pad2(list.index)}</span>
          <span class="name">{list.name}</span>
          <span class="count">{store.openCount.get(list.id) ?? 0}</span>
        </a>
      </li>
    {/each}
  </ul>

  {#if adding}
    <form class="new" onsubmit={addList}>
      <label class="vh" for="new-list">New list name</label>
      <input
        id="new-list"
        class="field"
        bind:value={name}
        placeholder="New list name"
        use:focusOnMount
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            void stopAdding()
          }
        }}
        onblur={() => !name && (adding = false)}
      />
    </form>
  {:else}
    <button bind:this={addButton} class="btn quiet add" onclick={() => (adding = true)}><Icon name="plus" /> New list</button>
  {/if}
  <p class="hint"><kbd>g</kbd> + number jumps to a list</p>
</nav>

<style>
  .index {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 20px 12px 24px;
  }

  .title {
    padding: 0 8px 6px;
    font-size: var(--t-meta);
    font-weight: 700;
    color: var(--ink-2);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    position: relative;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px;
    color: var(--ink);
    text-decoration: none;
    border: 1px solid transparent;
  }

  .item:hover {
    border-color: var(--rule);
  }

  .item[aria-current] {
    background: linear-gradient(var(--hl-select), var(--hl-select)) 0 50% / 100% 70% no-repeat;
    color: var(--on-hl);
  }

  .item[aria-current] .num,
  .item[aria-current] .count {
    color: var(--on-hl);
  }

  .num {
    color: var(--list-ink, var(--ink));
    font-size: var(--t-meta);
    font-weight: 700;
  }

  .today .num {
    color: var(--ink);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .today .name {
    font-weight: 700;
  }

  .count {
    display: inline-flex;
    gap: 8px;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .count .swipe {
    color: var(--on-hl);
    font-weight: 700;
  }

  .today {
    margin-bottom: 8px;
  }

  .new {
    padding: 6px 8px 0;
  }

  .add {
    align-self: flex-start;
    margin-top: 6px;
    color: var(--ink-2);
  }

  .hint {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 0 8px;
    color: var(--ink-3);
    font-size: var(--t-meta);
  }

  .hint kbd {
    min-width: 18px;
    height: 18px;
  }

  @media (max-width: 767px) {
    .item {
      min-height: 44px;
    }

    .hint {
      display: none;
    }
  }
</style>
