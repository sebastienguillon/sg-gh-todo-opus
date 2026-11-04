<script lang="ts">
  import { describeDue } from './dates'
  import Signifier from './Signifier.svelte'
  import { label, store } from './store.svelte'
  import type { TodoList } from './types'
  import { ui } from './ui.svelte'

  /** `docked`: the phone's field at the bottom of the screen. Otherwise the Log a task dialog,
      opened with n, the band's + or the palette. */
  let { docked = false }: { docked?: boolean } = $props()

  let dialog = $state<HTMLDialogElement>()
  let input = $state<HTMLInputElement>()
  let text = $state('')

  let parsed = $derived(store.parse(text))
  /** The list picked in the Index takes a task that has no `>`; with none picked, the Inbox does. */
  let selected = $derived(ui.activeList ? store.listById.get(ui.activeList) : undefined)
  let target = $derived(parsed.listId ? store.listById.get(parsed.listId) : (selected ?? store.inbox()))
  let extras = $derived(
    [parsed.due ? describeDue(parsed.due, store.today).label : null, ...parsed.tags.map((t) => `#${t}`)].filter(
      Boolean,
    ),
  )

  $effect(() => {
    if (!dialog) return
    if (ui.capture && !dialog.open) {
      text = ''
      dialog.showModal()
      input?.focus()
    } else if (!ui.capture && dialog.open) {
      dialog.close()
    }
  })

  function submit(e: SubmitEvent) {
    e.preventDefault()
    const todo = store.add(text, selected?.id)
    if (!todo) return
    text = ''
    // The docked field stays put for the next one; the dialog closes and the toast says where it went.
    if (docked) return
    const list = store.listOf(todo)
    store.note(`Logged in ${list ? label(list) : 'Inbox'}`)
    dialog?.close()
  }

  function onclose() {
    ui.capture = false
    ui.restoreFocus()
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      text = ''
      ui.focusLog()
    }
  }
</script>

{#snippet where(list: TodoList | undefined)}
  <span class={list && list.id === selected?.id ? 'swipe select' : undefined}>{list ? label(list) : 'Inbox'}</span>
{/snippet}

{#if docked}
  <form class="docked" onsubmit={submit}>
    <span class="mark" aria-hidden="true"><Signifier mark="open" /></span>
    <div class="input">
      <label class="vh" for="capture">Log a task</label>
      <input
        id="capture"
        class="field"
        bind:value={text}
        placeholder={selected ? `Log a task in ${label(selected)}` : 'Log a task'}
        autocomplete="off"
        enterkeyhint="done"
        onkeydown={keydown}
      />
    </div>
  </form>
{:else}
  <dialog bind:this={dialog} class="sheet capture" aria-labelledby="capture-h" {onclose}>
    <form method="dialog" class="inner" onsubmit={submit}>
      <h2 id="capture-h"><span class="bullet"><Signifier mark="open" /></span> Log a task</h2>

      <label class="vh" for="capture-text">Task</label>
      <input
        id="capture-text"
        bind:this={input}
        bind:value={text}
        class="field big"
        placeholder="Buy stamps #post >03 <fri"
        autocomplete="off"
        enterkeyhint="done"
        aria-describedby="capture-preview"
      />
      <p class="preview" id="capture-preview" aria-live="polite">
        Enter files it in {@render where(target)}{#each extras as extra}{` · ${extra}`}{/each}
      </p>

      <div class="foot">
        <p class="keys">
          <span><kbd>#</kbd> tag</span>
          <span><kbd>&gt;</kbd> list</span>
          <span><kbd>&lt;</kbd> date</span>
        </p>
        <div class="actions">
          <button type="button" class="btn quiet" onclick={() => dialog?.close()}>Cancel</button>
          <button type="submit" class="btn primary" disabled={!parsed.title}>Log task</button>
        </div>
      </div>
    </form>
  </dialog>
{/if}

<style>
  /* The phone: docked to the bottom edge under a 1px ink rule, the bullet in the 44px gutter. */
  .docked {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    align-items: start;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom)) 0;
    background: var(--pad);
    border-top: 1px solid var(--ink);
  }

  .mark {
    display: grid;
    place-items: center;
    width: 32px;
    /* As tall as the field beside it (a 1.4 line, 6px padding, 1px border), so the bullet stays
       on its line. */
    height: max(40px, calc(1.4rem + 14px));
    margin-left: 4px;
    color: var(--ink-3);
  }

  .input {
    display: grid;
  }

  .docked .field {
    min-height: 40px;
    font-size: var(--t-body);
    border-color: var(--ink);
  }

  /* The dialog: in the middle of the screen, where the other dialogs hang from 12vh. */
  @media (min-width: 768px) {
    .capture {
      margin: auto;
    }
  }

  .inner {
    display: grid;
    gap: 12px;
    padding: 16px;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sub);
    font-weight: 800;
  }

  .bullet {
    color: var(--ink-3);
  }

  .big {
    min-height: 44px;
    font-size: var(--t-sub);
    border-color: var(--ink);
  }

  .preview {
    min-height: 20px;
    margin-top: -6px;
    color: var(--ink-2);
    font-size: var(--t-meta);
    line-height: calc(20 / 14.625);
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding-top: 4px;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    color: var(--ink-2);
    font-size: var(--t-meta);
    line-height: calc(20 / 14.625);
  }

  .keys > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .keys kbd {
    min-width: calc(18rem / 18);
    height: calc(18rem / 18);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  @media (max-width: 767px) {
    .keys {
      display: none;
    }

    .actions .btn {
      min-height: 44px;
    }
  }
</style>
