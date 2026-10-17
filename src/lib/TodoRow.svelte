<script lang="ts">
  import { describeDue } from './dates'
  import Icon from './Icon.svelte'
  import Signifier from './Signifier.svelte'
  import { pad2, store } from './store.svelte'
  import type { Todo } from './types'
  import { ui } from './ui.svelte'

  let {
    todo,
    context,
    group = null,
  }: { todo: Todo; context: 'today' | 'list'; group?: 'late' | 'today' | null } = $props()

  const SWIPE_COMMIT = 80
  const TRAY = 104

  let key = $derived(`${context}:${todo.id}`)
  let list = $derived(store.listOf(todo))
  let flash = $derived(store.flashes[todo.id])
  let mark = $derived(flash ?? (todo.done ? 'done' : 'open'))
  let due = $derived(todo.due && !todo.done ? describeDue(todo.due, store.today) : null)
  let late = $derived(!todo.done && (group === 'late' || due?.kind === 'late'))
  let inToday = $derived(context === 'today')
  let expanded = $derived(ui.expanded === key)
  let trayOpen = $derived(ui.tray === key)
  let conflict = $derived(
    store.sync.kind === 'conflict' && (store.sync.id ? store.sync.id === todo.id : store.sync.path === store.pathOf(todo)),
  )
  let described = $derived(
    [
      list && inToday ? `${pad2(list.index)} ${list.name}` : null,
      todo.done ? 'done' : due?.spoken,
      todo.tags.length ? `tags ${todo.tags.join(', ')}` : null,
      todo.note ? 'has a note' : null,
      conflict ? 'changed on GitHub and here at once' : null,
    ]
      .filter(Boolean)
      .join(', '),
  )

  // Phone: swipe right to strike, swipe left to open > and <: the same three verbs as the gutter.
  let dx = $state(0)
  let dragging = $state(false)
  let start: { x: number; y: number; id: number } | null = null
  let horizontal = false

  function down(e: PointerEvent) {
    if (e.pointerType !== 'touch' || expanded) return
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }
    horizontal = false
  }

  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return
    const mx = e.clientX - start.x
    const my = e.clientY - start.y
    if (!horizontal) {
      if (Math.abs(mx) < 10) return
      if (Math.abs(my) > Math.abs(mx)) {
        start = null
        return
      }
      horizontal = true
      dragging = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    const base = trayOpen ? -TRAY : 0
    dx = Math.max(-TRAY - 24, Math.min(SWIPE_COMMIT + 40, base + mx))
  }

  function up() {
    if (!start) return
    start = null
    if (!dragging) return
    dragging = false
    if (dx >= SWIPE_COMMIT) {
      store.toggle(todo.id)
      ui.tray = null
    } else if (dx <= -TRAY / 2) {
      ui.tray = key
    } else {
      ui.tray = ui.tray === key ? null : ui.tray
    }
    dx = 0
  }

  let offset = $derived(dragging ? dx : trayOpen ? -TRAY : 0)

  function closeDetails(from: HTMLElement) {
    ui.expanded = null
    from.closest('li')?.querySelector<HTMLElement>('[data-row-focus]')?.focus()
  }

  function detailsKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeDetails(e.currentTarget as HTMLElement)
    }
  }

  function titleKey(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (e.key === 'Enter') {
      e.preventDefault()
      store.update(todo.id, { title: e.currentTarget.value })
      closeDetails(e.currentTarget)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      e.currentTarget.value = todo.title
      closeDetails(e.currentTarget)
    }
  }

  // Keep tray buttons from taking focus away from the row on tap.
  const keepFocus = (e: PointerEvent) => e.preventDefault()
</script>

<li class="item" class:expanded data-todo-id={todo.id}>
  <div class="under" aria-hidden={!trayOpen} inert={!trayOpen}>
    <span class="under-done"><Signifier mark="done" /></span>
    <span class="under-tray">
      <button tabindex="-1" onpointerdown={keepFocus} onclick={() => ui.openPalette('move', todo.id)}><Signifier mark=">" /><span>Move</span></button>
      <button tabindex="-1" onpointerdown={keepFocus} onclick={() => ui.openDate(todo.id)}><Signifier mark="<" /><span>Later</span></button>
    </span>
  </div>

  <!-- Swipe is a touch shortcut; every action it offers also has a key and a button. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="row"
    class:done={todo.done}
    class:late
    class:dragging
    class:conflict
    class:in-today={inToday}
    style:--list-ink={list ? `var(--list-${list.ink})` : 'var(--ink)'}
    style:transform={offset ? `translateX(${offset}px)` : undefined}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <div class="gutter">
      <label class="sig">
        <input
          type="checkbox"
          data-row-focus
          checked={todo.done}
          onchange={() => store.toggle(todo.id)}
          aria-label={todo.title}
          aria-describedby="d-{key}"
          aria-expanded={expanded}
          aria-controls={expanded ? `details-${key}` : undefined}
        />
        <Signifier {mark} />
      </label>
      {#if !todo.done}
        <span class="hints" class:always={late && inToday}>
          <button class="key" tabindex="-1" title="Done (x)" aria-label="Done" onclick={() => store.toggle(todo.id)}>
            <Signifier mark="done" />
          </button>
          <button class="key" tabindex="-1" title="Move to a list (>)" aria-label="Move to a list" onclick={() => ui.openPalette('move', todo.id)}>
            <Signifier mark=">" />
          </button>
          <button class="key" tabindex="-1" title="Reschedule (<)" aria-label="Reschedule" onclick={() => ui.openDate(todo.id)}>
            <Signifier mark="<" />
          </button>
        </span>
      {/if}
    </div>

    {#if inToday && list}
      <button class="index" tabindex="-1" aria-label="Go to {pad2(list.index)} {list.name}" onclick={() => ui.jumpToList(list.id)}>
        {pad2(list.index)}
      </button>
    {/if}

    <div class="body">
      {#if expanded}
        <label class="vh" for="title-{key}">Title</label>
        <input
          id="title-{key}"
          class="title-edit"
          value={todo.title}
          onchange={(e) => store.update(todo.id, { title: e.currentTarget.value })}
          onkeydown={titleKey}
        />
      {:else}
        <button class="title" tabindex="-1" aria-expanded={expanded} onclick={() => ui.toggleExpanded(key)}>
          {todo.title}
        </button>
      {/if}
      {#if todo.note && !expanded}
        <span class="has-note" title="Has a note"><Icon name="note" size={14} /></span>
      {/if}
      {#each todo.tags as tag (tag)}
        <button class="tag" class:active={store.tagFilter === tag} tabindex="-1" onclick={() => store.setTagFilter(store.tagFilter === tag ? null : tag)}>#{tag}</button>
      {/each}
      {#if inToday && list}
        <span class="list-inline" aria-hidden="true">{list.name}</span>
      {/if}
    </div>

    {#if inToday && list}
      <span class="list-name" aria-hidden="true">{list.name}</span>
    {/if}

    <span class="due">
      {#if conflict}
        <span class="conflict-mark" title="Changed on GitHub and here at once"><Icon name="alert" size={14} /></span>
      {/if}
      {#if due}
        <span class={due.kind === 'late' || due.kind === 'today' ? `swipe ${due.kind}` : ''}>{due.label}</span>
      {/if}
    </span>
    <span class="vh" id="d-{key}">{described}</span>
  </div>

  {#if expanded}
    <!-- Escape from any field inside closes the details; the handler only listens for keys bubbling up. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="details" class:in-today={inToday} id="details-{key}" role="group" aria-label="Details for {todo.title}" onkeydown={detailsKey}>
      {#if !todo.done}
        <!-- Phone: the opened row's verbs stack down the notation column, under its bullet. -->
        <div class="triage" role="group" aria-label="Triage">
          <button aria-label="Done" title="Done" onclick={() => store.toggle(todo.id)}><Signifier mark="done" /></button>
          <button aria-label="Move to a list" title="Move to a list" onclick={() => ui.openPalette('move', todo.id)}><Signifier mark=">" /></button>
          <button aria-label="Reschedule" title="Reschedule" onclick={() => ui.openDate(todo.id)}><Signifier mark="<" /></button>
        </div>
      {/if}
      <div class="detail-main">
      <label class="detail-field">
        <span>Note</span>
        <textarea
          class="field"
          rows="2"
          placeholder="Add a note (Markdown)"
          value={todo.note}
          onchange={(e) => store.update(todo.id, { note: e.currentTarget.value })}
        ></textarea>
      </label>
      <div class="detail-actions">
        <button class="btn verb" onclick={() => ui.openPalette('move', todo.id)}>
          <Signifier mark=">" /> Move <kbd>&gt;</kbd>
        </button>
        <button class="btn verb" onclick={() => ui.openDate(todo.id)}>
          <Signifier mark="<" /> Reschedule <kbd>&lt;</kbd>
        </button>
        <button class="btn" onclick={() => ui.openTags(todo.id)}>
          <Icon name="hash" /> Tags <kbd>t</kbd>
        </button>
        <button
          class="btn quiet"
          onclick={() => {
            ui.lastDeleteScope = inToday ? 'today' : 'list'
            store.remove(todo.id)
          }}
        >
          <Icon name="trash" /> Delete
        </button>
        <button class="btn quiet close" onclick={(e) => closeDetails(e.currentTarget)}>Close <kbd>esc</kbd></button>
      </div>
      </div>
    </div>
  {/if}
</li>

<style>
  .item {
    position: relative;
    list-style: none;
  }

  /* Swipe trays, revealed under the row on a phone. */
  .under {
    position: absolute;
    inset: 0 0 auto;
    height: 44px;
    display: none;
    justify-content: space-between;
    align-items: stretch;
    background: var(--pad-3);
  }

  .under-done {
    display: flex;
    align-items: center;
    padding-left: 20px;
    background: var(--pad-3);
    color: var(--ink);
    width: 50%;
  }

  .under-tray {
    display: flex;
  }

  .under-tray button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 52px;
    border: 0;
    border-left: 1px solid var(--rule);
    background: var(--pad-3);
    font-size: 0.75rem;
  }

  .row {
    --row-h: var(--row);
    --index-w: 0px;
    --list-w: 0px;
    position: relative;
    display: grid;
    grid-template-columns: var(--gutter) var(--index-w) minmax(0, 1fr) var(--list-w) var(--margin-col);
    align-items: start;
    min-height: var(--row-h);
    background: var(--pad);
    transition: transform 200ms var(--ease-out);
    touch-action: pan-y;
  }

  .row.in-today {
    --index-w: 36px;
    --list-w: minmax(0, max-content);
  }

  .row.dragging {
    transition: none;
  }

  .row:hover {
    background: color-mix(in srgb, var(--pad-2) 70%, var(--pad));
  }

  .row:has([data-row-focus]:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }

  .row:has([data-row-focus]:focus-visible) .title {
    background: linear-gradient(var(--hl-select), var(--hl-select)) 0 55% / 100% 70% no-repeat;
    color: var(--on-hl);
  }

  /* The dot grid lives only here, at the row pitch; each open bullet sits on a dot. */
  .gutter {
    grid-column: 1;
    position: relative;
    display: flex;
    align-items: flex-start;
    align-self: stretch;
    min-height: var(--row-h);
    padding-left: 8px;
  }

  .gutter::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--gutter) - 20px);
    background: radial-gradient(circle, var(--dot) 0.9px, transparent 1.4px) 0 8px / 16px 16px;
    pointer-events: none;
  }

  .gutter > * {
    position: relative;
  }

  .sig {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--ink);
    cursor: pointer;
  }

  .sig input {
    position: absolute;
    inset: 0;
    margin: 0;
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
  }

  .sig input:focus-visible {
    outline: none;
  }

  .sig:hover input {
    border-color: var(--rule);
  }

  .done .sig {
    color: var(--ink-3);
  }

  .hints {
    display: flex;
    align-self: flex-start;
    align-items: center;
    gap: 3px;
    height: var(--row);
    margin-left: 8px;
    opacity: 0;
    transition: opacity var(--fast) var(--ease-out);
  }

  .hints.always,
  .row:hover .hints,
  .row:focus-within .hints {
    opacity: 1;
  }

  .key {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--rule);
    background: var(--pad);
    color: var(--ink-2);
  }

  .key :global(svg) {
    width: 12px;
    height: 12px;
  }

  .key:hover {
    border-color: var(--ink);
    color: var(--ink);
  }

  .row:has([data-row-focus]:focus-visible) .key {
    border-color: var(--ink);
    color: var(--ink);
  }

  .index {
    grid-column: 2;
    align-self: start;
    height: var(--row-h);
    padding: 0;
    border: 0;
    background: none;
    color: var(--list-ink);
    font-weight: 700;
    font-size: var(--t-meta);
    text-align: left;
    letter-spacing: 0.02em;
  }

  .body {
    grid-column: 3;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 10px;
    row-gap: 0;
    min-width: 0;
    padding-block: 6px;
    line-height: 20px;
  }

  .title {
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    font-size: var(--t-body);
    line-height: 20px;
    overflow-wrap: anywhere;
    cursor: text;
  }

  .title-edit {
    flex: 1 1 280px;
    min-width: 0;
    height: 20px;
    padding: 0;
    border: 0;
    border-bottom: 1px solid var(--ink);
    border-radius: 0;
    background: transparent;
    font-size: var(--t-body);
    line-height: 20px;
  }

  .title-edit:focus-visible {
    outline: none;
    border-bottom-width: 2px;
  }

  .done .title {
    color: var(--ink-3);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }

  .has-note {
    align-self: center;
    color: var(--ink-3);
  }

  .tag {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .tag:hover {
    color: var(--ink);
    text-decoration: underline;
  }

  .tag.active {
    color: var(--ink);
    font-weight: 700;
  }

  /* Today rows name their list in its ink, so 17 lists on 12 inks stay identifiable. */
  .list-name {
    grid-column: 4;
    padding: 6px 0 0 16px;
    color: var(--list-ink);
    font-size: var(--t-meta);
    font-weight: 600;
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .list-inline {
    display: none;
    color: var(--list-ink);
    font-size: var(--t-meta);
    font-weight: 600;
  }

  .due {
    grid-column: 5;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 6px var(--edge) 0 0;
    line-height: 20px;
    font-size: var(--t-meta);
    color: var(--ink-2);
    white-space: nowrap;
  }

  .late .due {
    color: var(--ink);
    font-weight: 700;
  }

  .due :global(.today) {
    color: var(--on-hl);
    font-weight: 600;
  }

  .due :global(.late) {
    color: var(--on-hl);
  }

  .conflict-mark {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    background: var(--alarm);
    color: var(--on-alarm);
  }

  .triage {
    display: none;
  }

  .details {
    position: relative;
    padding: 4px var(--edge) 16px var(--gutter);
    border-bottom: 1px solid var(--line);
  }

  .details.in-today {
    padding-left: calc(var(--gutter) + 36px);
  }

  .detail-main {
    display: grid;
    gap: 12px;
  }

  .detail-field {
    display: grid;
    gap: 4px;
    font-size: var(--t-meta);
    color: var(--ink-2);
  }

  .detail-field textarea {
    min-height: 56px;
    resize: none;
    field-sizing: content;
    line-height: 1.45;
    color: var(--ink);
  }

  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .detail-actions .close {
    margin-left: auto;
    /* A quiet button's ink, not its box, ends on the right edge. */
    margin-right: -12px;
  }

  @media (max-width: 767px) {
    .row {
      --row-h: 44px;
      grid-template-columns: 44px var(--index-w) minmax(0, 1fr) auto;
    }

    .row.in-today {
      --index-w: 28px;
    }

    .list-name {
      display: none;
    }

    .list-inline {
      display: inline;
    }

    .gutter {
      padding-left: 4px;
    }

    .gutter::before {
      width: 40px;
      background-position: 0 14px;
    }

    .sig {
      width: 40px;
      height: 44px;
    }

    .hints {
      display: none;
    }

    .body {
      row-gap: 4px;
      padding-block: 12px;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      margin-block: -2px;
    }

    .index {
      line-height: 44px;
    }

    .due {
      grid-column: 4;
      padding: 12px 16px 0 10px;
    }

    .under {
      display: flex;
    }

    /* The opened row: its verbs stack down the 44px notation column, the dot grid behind them. */
    .details {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      padding: 0 16px 16px 0;
    }

    .details.in-today {
      padding-left: 0;
    }

    .details::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 40px;
      background: radial-gradient(circle, var(--dot) 0.9px, transparent 1.4px) 0 14px / 16px 16px;
      pointer-events: none;
    }

    .detail-main {
      padding-top: 8px;
    }

    .details.in-today .detail-main {
      padding-left: 28px;
    }

    .triage {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 0 0 4px;
    }

    /* Fill only, no border: the stack reads apart from the content without a second ruled column. */
    .triage button {
      display: grid;
      place-items: center;
      width: 40px;
      height: 44px;
      padding: 0;
      border: 0;
      background: var(--pad-3);
      color: var(--ink);
    }

    .triage button:active {
      background: var(--line);
      outline: 1px solid var(--ink);
      outline-offset: -1px;
    }

    /* The gutter's verbs already carry Move and Reschedule. */
    .detail-actions .verb {
      display: none;
    }

    /* Key hints are for keyboards, not thumbs. */
    .detail-actions kbd {
      display: none;
    }

  }

  @media (hover: none) {
    .hints {
      display: none;
    }
  }
</style>
