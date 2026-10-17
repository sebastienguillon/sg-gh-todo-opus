<script lang="ts">
  import { describeDue } from './dates'
  import Signifier from './Signifier.svelte'
  import { label, store } from './store.svelte'
  import { ui } from './ui.svelte'

  let text = $state('')
  let confirmation = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined

  let parsed = $derived(store.parse(text))
  let target = $derived(parsed.listId ? store.listById.get(parsed.listId) : store.inbox())
  let preview = $derived(
    [
      target ? label(target) : null,
      parsed.due ? describeDue(parsed.due, store.today).label : null,
      ...parsed.tags.map((t) => `#${t}`),
    ]
      .filter(Boolean)
      .join(' · '),
  )

  function submit(e: SubmitEvent) {
    e.preventDefault()
    const todo = store.add(text)
    if (!todo) return
    const list = store.listOf(todo)
    text = ''
    confirmation = `Logged in ${list ? label(list) : 'Inbox'}`
    clearTimeout(timer)
    timer = setTimeout(() => (confirmation = ''), 2400)
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      text = ''
      ui.focusLog()
    }
  }
</script>

<form class="capture" onsubmit={submit}>
  <span class="mark" aria-hidden="true"><Signifier mark="open" /></span>
  <div class="input">
    <label class="vh" for="capture">Log a task</label>
    <input
      id="capture"
      class="field"
      bind:value={text}
      placeholder="Log a task"
      autocomplete="off"
      enterkeyhint="done"
      aria-describedby="capture-hint"
      onkeydown={keydown}
    />
    <p class="hint" id="capture-hint" aria-live="polite">
      {#if confirmation && !text}
        {confirmation}
      {:else if text.trim()}
        <span class="files">Enter files it in</span> {preview}
      {:else}
        <span><kbd>#</kbd> tag</span>
        <span><kbd>&gt;</kbd> list</span>
        <span><kbd>&lt;</kbd> date</span>
        <span class="where">Enter files it in {target ? label(target) : 'Inbox'}</span>
      {/if}
    </p>
  </div>
</form>

<style>
  .capture {
    display: grid;
    grid-template-columns: var(--gutter) minmax(0, 1fr) var(--edge);
    align-items: start;
    margin: 16px 0 12px;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 32px;
    /* As tall as the field beside it (a 1.4 line, 6px padding, 1px border), so the bullet stays
       on its line. */
    height: max(40px, calc(1.4rem + 14px));
    margin-left: 8px;
    color: var(--ink-3);
  }

  .input {
    display: grid;
    gap: 6px;
  }

  .field {
    min-height: 40px;
    font-size: var(--t-body);
    border-color: var(--ink);
  }

  .hint {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    min-height: 20px;
    color: var(--ink-2);
    font-size: var(--t-meta);
    line-height: calc(20 / 14.625);
  }

  .hint span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .hint kbd {
    min-width: calc(18rem / 18);
    height: calc(18rem / 18);
  }

  .where {
    margin-left: auto;
  }

  .files {
    color: var(--ink-3);
  }

  @media (max-width: 767px) {
    .capture {
      grid-template-columns: 44px minmax(0, 1fr);
      margin: 0;
      padding: 8px 12px calc(8px + env(safe-area-inset-bottom)) 0;
      background: var(--pad);
      border-top: 1px solid var(--ink);
    }

    .mark {
      margin-left: 4px;
    }

    .hint {
      display: none;
    }
  }
</style>
