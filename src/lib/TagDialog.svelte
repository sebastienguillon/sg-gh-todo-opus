<script lang="ts">
  import Icon from './Icon.svelte'
  import { store, TAG_WORD } from './store.svelte'
  import { ui } from './ui.svelte'

  let dialog: HTMLDialogElement
  let input = $state<HTMLInputElement>()
  let text = $state('')

  let todo = $derived(ui.tagsFor ? store.find(ui.tagsFor) : undefined)
  let tags = $derived(
    text
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, '').normalize('NFC').toLowerCase())
      .filter((t) => TAG_WORD.test(`#${t}`))
      .filter((t, i, all) => all.indexOf(t) === i),
  )
  let suggestions = $derived(store.allTags.slice(0, 14).map(([tag]) => tag))

  $effect(() => {
    if (ui.tagsFor && !dialog.open) {
      const t = store.find(ui.tagsFor)
      text = t ? t.tags.map((x) => `#${x}`).join(' ') : ''
      dialog.showModal()
      input?.focus()
    } else if (!ui.tagsFor && dialog.open) {
      dialog.close()
    }
  })

  function toggle(tag: string) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    text = next.map((t) => `#${t}`).join(' ')
    input?.focus()
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (ui.tagsFor) store.update(ui.tagsFor, { tags })
    dialog.close()
  }

  function onclose() {
    const id = ui.tagsFor
    ui.tagsFor = null
    ui.restoreFocus(id)
  }
</script>

<dialog bind:this={dialog} class="sheet" aria-labelledby="tags-h" {onclose}>
  <form method="dialog" class="inner" onsubmit={submit}>
    <h2 id="tags-h"><Icon name="hash" /> Tags</h2>
    {#if todo}<p class="subject">{todo.title}</p>{/if}
    <label class="vh" for="tags-text">Tags, separated by spaces</label>
    <input id="tags-text" bind:this={input} bind:value={text} class="field big" placeholder="#calls #weekend" autocomplete="off" />
    {#if suggestions.length}
      <div class="suggest" role="group" aria-label="Tags in use">
        {#each suggestions as tag (tag)}
          <button type="button" class="tag" aria-pressed={tags.includes(tag)} onclick={() => toggle(tag)}>#{tag}</button>
        {/each}
      </div>
    {/if}
    <div class="actions">
      <button type="button" class="btn quiet" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="btn primary">Save tags</button>
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

  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tag {
    min-height: 28px;
    padding: 0 8px;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--ink-2);
    font-size: var(--t-meta);
  }

  .tag:hover {
    border-color: var(--ink);
    color: var(--ink);
  }

  .tag[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--pad);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
