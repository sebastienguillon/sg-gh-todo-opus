<script lang="ts">
  import { addDays, describeDue, formatDay, fromISO, parseDay } from './dates'
  import Signifier from './Signifier.svelte'
  import { store } from './store.svelte'
  import type { DayISO } from './types'
  import { ui } from './ui.svelte'

  let dialog: HTMLDialogElement
  let input = $state<HTMLInputElement>()
  let text = $state('')

  let todo = $derived(ui.dateFor ? store.find(ui.dateFor) : undefined)
  let parsed = $derived(parseDay(text, store.today))
  let nextMonday = $derived.by(() => {
    const dow = fromISO(store.today).getDay()
    return addDays(store.today, ((8 - dow) % 7) || 7)
  })
  let quick = $derived<{ label: string; key: string; due: DayISO | null }[]>([
    { label: 'Today', key: 'today', due: store.today },
    { label: 'Tomorrow', key: 'tom', due: addDays(store.today, 1) },
    { label: `Mon ${formatDay(nextMonday).slice(4)}`, key: 'mon', due: nextMonday },
    { label: 'In a week', key: '+7', due: addDays(store.today, 7) },
    { label: 'No date', key: 'none', due: null },
  ])

  $effect(() => {
    if (ui.dateFor && !dialog.open) {
      text = ''
      dialog.showModal()
      input?.focus()
    } else if (!ui.dateFor && dialog.open) {
      dialog.close()
    }
  })

  function apply(due: DayISO | null) {
    const id = ui.dateFor
    if (!id) return
    store.reschedule(id, due)
    dialog.close()
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (parsed !== undefined) apply(parsed)
  }

  function onclose() {
    const id = ui.dateFor
    ui.dateFor = null
    ui.restoreFocus(id)
  }
</script>

<dialog bind:this={dialog} class="sheet date" aria-labelledby="date-h" {onclose}>
  <form method="dialog" class="inner" onsubmit={submit}>
    <h2 id="date-h"><Signifier mark="<" /> Reschedule</h2>
    {#if todo}<p class="subject">{todo.title}</p>{/if}

    <label class="vh" for="date-text">New date</label>
    <input
      id="date-text"
      bind:this={input}
      bind:value={text}
      class="field big"
      placeholder="tomorrow, fri, 24.10, +3, none"
      autocomplete="off"
      aria-describedby="date-preview"
    />
    <p class="preview" id="date-preview" aria-live="polite">
      {#if text && parsed === undefined}
        Not a date yet. Try fri, 24.10 or +3.
      {:else if parsed === null}
        Clears the date.
      {:else if parsed}
        {formatDay(parsed)}, {describeDue(parsed, store.today).spoken}
      {:else}
        Type a date, or pick one.
      {/if}
    </p>

    <div class="quick">
      {#each quick as q (q.key)}
        <button type="button" class="btn" onclick={() => apply(q.due)}>{q.label}</button>
      {/each}
      <label class="pick">
        <span class="vh">Pick a date</span>
        <!-- The picker only fills the field; Enter or Reschedule commits, so a half-typed date is never saved. -->
        <input type="date" class="field" value={todo?.due ?? ''} oninput={(e) => (text = e.currentTarget.value)} />
      </label>
    </div>

    <div class="actions">
      <button type="button" class="btn quiet" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="btn primary" disabled={parsed === undefined}>Reschedule</button>
    </div>
  </form>
</dialog>

<style>
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

  .subject {
    color: var(--ink-2);
  }

  .big {
    min-height: 44px;
    font-size: var(--t-sub);
    border-color: var(--ink);
  }

  .preview {
    min-height: 20px;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pick .field {
    min-height: 32px;
    width: auto;
    padding-block: 4px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
</style>
