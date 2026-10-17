<script lang="ts">
  import Icon from './Icon.svelte'
  import Signifier from './Signifier.svelte'
  import { pad2, store } from './store.svelte'
  import TodoRow from './TodoRow.svelte'
  import type { TodoList } from './types'
  import { ui } from './ui.svelte'

  let { list }: { list: TodoList } = $props()

  let open = $derived(store.openIn(list.id))
  let done = $derived(store.doneIn(list.id))
  let foldOpen = $derived(!!store.openDone[list.id])
  let filtered = $derived(!!store.tagFilter)
  let renaming = $derived(ui.renaming === list.id)
  /** While the name is a field, a Delete stands in for the jump keys (the count, on a phone). */
  let canDelete = $derived(renaming && store.lists.length > 1)

  let section = $state<HTMLElement>()
  let heading = $state<HTMLElement>()
  let settled = false

  function editName(el: HTMLInputElement) {
    settled = false
    el.focus({ preventScroll: true })
    el.select()
  }

  /** Enter and Esc hand focus back; leaving the field by pointer keeps it where it went. */
  function finishRename(save: boolean, value: string, refocus: boolean) {
    if (settled) return
    settled = true
    if (save) store.renameList(list.id, value)
    ui.renaming = null
    if (refocus) ui.restoreFocus(null, heading)
    else ui.forgetFocus()
  }

  function renameKey(e: KeyboardEvent) {
    const value = (e.currentTarget as HTMLInputElement).value
    if (e.key === 'Enter') {
      e.preventDefault()
      finishRename(true, value, true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finishRename(false, value, true)
    }
  }

  /** The field goes without saving a half-typed name; the delete asks first if open to-dos would go. */
  function deleteFromHeading() {
    settled = true
    ui.renaming = null
    heading?.focus({ preventScroll: true })
    ui.requestDeleteList(list.id)
  }

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

{#if !filtered || open.length || done.length || renaming}
  <section bind:this={section} class="list" id="list-{list.id}" aria-labelledby="h-{list.id}" style:--list-ink="var(--list-{list.ink})">
    <header class="head" class:renaming>
      <h2 id="h-{list.id}" tabindex="-1" bind:this={heading}>
        <span class="num">{pad2(list.index)}</span>
        {#if renaming}
          <input
            class="name-edit"
            value={list.name}
            aria-label="Name of list {pad2(list.index)}"
            autocomplete="off"
            enterkeyhint="done"
            use:editName
            onkeydown={renameKey}
            onblur={(e) => finishRename(true, e.currentTarget.value, false)}
          />
        {:else}
          <button class="name" tabindex="-1" title="Rename (r)" onclick={() => ui.renameList(list.id)}>{list.name}</button>
        {/if}
      </h2>
      <span class="count" class:yields={canDelete}>{open.filter((t) => !t.done).length} open</span>
      {#if canDelete}
        <!-- Pressing it mustn't blur the field first, or the field would save and take the button with it. -->
        <button
          class="btn quiet delete"
          tabindex="-1"
          title="Delete the list (⇧ D)"
          onpointerdown={(e) => e.preventDefault()}
          onclick={deleteFromHeading}
        >
          <Icon name="trash" /> Delete
        </button>
      {:else}
        <span class="jump" aria-hidden="true"><kbd>g</kbd><kbd>{pad2(list.index)}</kbd></span>
      {/if}
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

  /* The name reads as plain heading text; a click or tap renames it, as a title opens its row. */
  .name {
    padding: 0;
    border: 0;
    background: none;
    letter-spacing: inherit;
    text-align: left;
    cursor: text;
  }

  .renaming h2 {
    flex: 1;
    min-width: 0;
  }

  /* The opened row's title field at heading size: a 1px ink underline, 2px with focus, in the same box. */
  .name-edit {
    flex: 1;
    min-width: 0;
    padding: 0 0 1px;
    border: 0;
    border-bottom: 1px solid var(--ink);
    border-radius: 0;
    background: transparent;
    letter-spacing: inherit;
  }

  .name-edit:focus-visible {
    outline: none;
    padding-bottom: 0;
    border-bottom-width: 2px;
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

  /* A quiet button pulls its box out by 12px, so its text meets the right edge. */
  .delete {
    min-height: 28px;
    margin: 0 -12px 0 auto;
    font-size: var(--t-meta);
  }

  .empty {
    padding: 4px var(--edge) 4px var(--gutter);
    color: var(--ink-2);
    line-height: calc(24 / 18);
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
    min-height: var(--row);
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

    .count.yields {
      display: none;
    }

    .delete {
      min-height: 44px;
    }

    .empty {
      padding-left: 44px;
    }

    .perforation {
      padding-left: 2px;
    }
  }
</style>
