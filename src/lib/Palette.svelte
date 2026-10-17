<script lang="ts">
  import Icon from './Icon.svelte'
  import Signifier from './Signifier.svelte'
  import { pad2, store } from './store.svelte'
  import { ui } from './ui.svelte'

  interface Item {
    key: string
    kind: 'list' | 'todo' | 'tag' | 'command'
    text: string
    ink?: number
    num?: string
    meta?: string
    run: () => void
    /** Return focus to where it was when the palette opened. */
    restore: boolean
  }

  let dialog: HTMLDialogElement
  let input = $state<HTMLInputElement>()
  let query = $state('')
  let active = $state(0)
  let skipRestore = false

  let mode = $derived(ui.palette?.mode ?? 'search')
  let subject = $derived(ui.palette?.todoId ? store.find(ui.palette.todoId) : undefined)

  let items = $derived.by((): Item[] => {
    const q = query.trim()
    if (mode === 'move' && subject) {
      const t = subject
      return store.listsInOrder
        .filter((l) => l.id !== t.listId)
        .filter((l) =>
          !q ? true : /^\d+$/.test(q) ? String(l.index).startsWith(q.replace(/^0(?=\d)/, '')) : l.name.toLowerCase().includes(q.toLowerCase()),
        )
        .map((l) => ({
          key: l.id,
          kind: 'list',
          text: l.name,
          num: pad2(l.index),
          ink: l.ink,
          meta: `${store.openCount.get(l.id) ?? 0} open`,
          run: () => store.move(t.id, l.id),
          restore: true,
        }))
    }
    if (mode === 'tag') {
      const tags = store.allTags.filter(([tag]) => !q || tag.includes(q.replace(/^#/, '').toLowerCase()))
      const all: Item[] = store.tagFilter
        ? [{ key: '*', kind: 'command', text: 'Show everything', run: () => store.setTagFilter(null), restore: true }]
        : []
      return all.concat(
        tags.map(([tag, count]) => ({
          key: tag,
          kind: 'tag',
          text: `#${tag}`,
          meta: `${count} open`,
          run: () => store.setTagFilter(tag),
          restore: true,
        })),
      )
    }
    const found = store.search(q)
    const lists: Item[] = found.lists.map((l) => ({
      key: l.id,
      kind: 'list',
      text: l.name,
      num: pad2(l.index),
      ink: l.ink,
      meta: `g ${pad2(l.index)}`,
      run: () => ui.jumpToList(l.id),
      restore: false,
    }))
    const todos: Item[] = found.todos.map((t) => {
      const list = store.listOf(t)
      return {
        key: t.id,
        kind: 'todo',
        text: t.title,
        num: list ? pad2(list.index) : '',
        ink: list?.ink,
        meta: t.done ? 'done' : list?.name,
        run: () => ui.jumpToTodo(t.id),
        restore: false,
      }
    })
    const commands: Item[] = q
      ? []
      : [
          { key: 'new', kind: 'command', text: 'Log a task', meta: 'n', run: () => document.getElementById('capture')?.focus(), restore: false },
          { key: 'today', kind: 'command', text: 'Go to Today', meta: 'g t', run: () => ui.jumpToToday(), restore: false },
          { key: 'help', kind: 'command', text: 'Keyboard shortcuts', meta: '?', run: () => ui.openHelp(), restore: false },
        ]
    const outside: Item[] =
      q && store.tagFilter
        ? [{ key: 'unfilter', kind: 'command', text: `Search outside #${store.tagFilter}`, meta: 'clears the filter', run: () => store.setTagFilter(null), restore: false }]
        : []
    return [...commands, ...todos, ...lists, ...outside]
  })

  let heading = $derived(
    mode === 'move' && subject ? `Move “${subject.title}” to` : mode === 'tag' ? 'Show only a tag' : 'Search or jump',
  )

  $effect(() => {
    if (ui.palette && !dialog.open) {
      query = ''
      active = 0
      skipRestore = false
      dialog.showModal()
      input?.focus()
    } else if (!ui.palette && dialog.open) {
      dialog.close()
    }
  })

  $effect(() => {
    // A new query starts from its top result, so the active option (and its id) follows what was typed.
    void query
    active = 0
  })

  /** Option ids are derived from the item, never its position, so the announced option tracks the results. */
  function optionId(item: Item): string {
    return `opt-${item.kind}-${encodeURIComponent(item.key).replace(/[^\w-]/g, '_')}`
  }

  let activeItem = $derived(items[Math.min(active, items.length - 1)])
  let status = $derived(
    items.length ? `${items.length} ${items.length === 1 ? 'result' : 'results'}` : query ? `Nothing matches ${query}` : '',
  )

  function choose(item: Item | undefined) {
    if (!item) return
    if (item.key === 'unfilter') {
      // Widen the search in place; the palette stays open on the same query, from its top result.
      item.run()
      active = 0
      input?.focus()
      requestAnimationFrame(() => dialog.querySelector('.results')?.scrollTo({ top: 0 }))
      return
    }
    skipRestore = !item.restore
    ui.palette = null
    dialog.close()
    item.run()
  }

  function onclose() {
    const todoId = ui.palette?.todoId ?? null
    ui.palette = null
    // A command that opened another overlay (Help) has already saved where focus goes back to.
    if (skipRestore) {
      if (!ui.help) ui.forgetFocus()
    } else ui.restoreFocus(todoId)
    skipRestore = false
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      active = (active + 1) % Math.max(1, items.length)
      scrollActive()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = (active - 1 + items.length) % Math.max(1, items.length)
      scrollActive()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(activeItem)
    }
  }

  function scrollActive() {
    requestAnimationFrame(() => dialog.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  }
</script>

<dialog bind:this={dialog} class="sheet palette" aria-labelledby="palette-h" {onclose}>
  <div class="top">
    <h2 id="palette-h">{heading}</h2>
    <div class="search">
      <Icon name={mode === 'tag' ? 'hash' : 'search'} />
      <input
        bind:this={input}
        bind:value={query}
        class="q"
        role="combobox"
        aria-labelledby="palette-h"
        aria-expanded={items.length > 0}
        aria-controls="palette-list"
        aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
        aria-autocomplete="list"
        placeholder={mode === 'move' ? 'Type a number or a name' : mode === 'tag' ? 'Type a tag' : 'Type a to-do, a list or a number'}
        autocomplete="off"
        onkeydown={keydown}
      />
      <kbd>esc</kbd>
    </div>
  </div>

  <p class="vh" role="status">{status}</p>
  <ul class="results" id="palette-list" role="listbox" aria-label={heading} hidden={!items.length}>
    {#each items as item, i (item.kind + item.key)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={optionId(item)}
          role="option"
          aria-selected={item === activeItem}
          class="opt"
          style:--list-ink={item.ink ? `var(--list-${item.ink})` : 'var(--ink-2)'}
          onclick={() => choose(item)}
          onpointerdown={(e) => e.preventDefault()}
          onpointermove={() => (active = i)}
        >
          <span class="lead">
            {#if mode === 'move'}<Signifier mark=">" />{:else if item.kind === 'command'}<Icon name="keyboard" size={14} />{:else if item.kind === 'tag'}<Icon name="hash" size={14} />{:else}{item.num}{/if}
          </span>
          <span class="text">
            {#if mode === 'move'}<span class="num">{item.num}</span>{/if}
            {item.text}
          </span>
          {#if item.meta}<span class="meta">{item.meta}</span>{/if}
        </li>
    {/each}
  </ul>
  {#if !items.length}
    <p class="none" aria-hidden="true">Nothing matches “{query}”.</p>
  {/if}
</dialog>

<style>
  .top {
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    margin-bottom: 10px;
    font-size: var(--t-meta);
    font-weight: 700;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--ink);
  }

  .q {
    flex: 1;
    min-width: 0;
    height: 40px;
    border: 0;
    background: transparent;
    font-size: var(--t-sub);
    outline: none;
  }

  .q::placeholder {
    color: var(--ink-3);
  }

  .search:focus-within {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }

  .results {
    max-height: min(420px, 60dvh);
    margin: 0;
    padding: 6px 0;
    overflow: auto;
    list-style: none;
  }

  .opt {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 16px;
    cursor: pointer;
  }

  .opt[aria-selected='true'] {
    background: linear-gradient(var(--hl-select), var(--hl-select)) 0 50% / 100% 78% no-repeat;
    color: var(--on-hl);
  }

  .opt[aria-selected='true'] .lead,
  .opt[aria-selected='true'] .num,
  .opt[aria-selected='true'] .meta {
    color: var(--on-hl);
  }

  .lead {
    display: grid;
    place-items: center start;
    color: var(--list-ink);
    font-size: var(--t-meta);
    font-weight: 700;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    margin-right: 8px;
    color: var(--list-ink);
    font-weight: 700;
  }

  .meta {
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .none {
    padding: 16px;
    color: var(--ink-2);
  }

  @media (max-width: 767px) {
    .opt {
      min-height: 44px;
    }
  }
</style>
