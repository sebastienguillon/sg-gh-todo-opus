<script lang="ts">
  import { ui } from './ui.svelte'

  let dialog: HTMLDialogElement

  const KEYS: [keys: string[], what: string][] = [
    [['j', 'k'], 'Next or previous row'],
    [['x'], 'Done, or reopen'],
    [['>'], 'Move to a list'],
    [['<'], 'Reschedule'],
    [['t'], 'Edit tags'],
    [['Enter'], 'Open the row: title, note, actions'],
    [['n'], 'Log a task'],
    [['g', '07'], 'Jump to list 07'],
    [['g', 't'], 'Jump to Today'],
    [['⌘', 'K'], 'Search or jump'],
    [['#'], 'Show only a tag'],
    [['Alt', '↑'], 'Move a row up or down'],
    [['Delete'], 'Delete'],
    [['u'], 'Undo a delete or a clear'],
    [['Esc'], 'Close, or clear the tag filter'],
  ]

  $effect(() => {
    if (ui.help && !dialog.open) dialog.showModal()
    else if (!ui.help && dialog.open) dialog.close()
  })
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  aria-labelledby="help-h"
  onclose={() => {
    ui.help = false
    ui.restoreFocus()
  }}
>
  <div class="inner">
    <div class="head">
      <h2 id="help-h">Keyboard</h2>
      <form method="dialog"><button class="btn quiet">Close <kbd>esc</kbd></button></form>
    </div>
    <dl>
      {#each KEYS as [keys, what] (what)}
        <div class="pair">
          <dt>{#each keys as k (k)}<kbd>{k}</kbd>{/each}</dt>
          <dd>{what}</dd>
        </div>
      {/each}
    </dl>
    <p class="capture">
      When logging a task, <kbd>#</kbd> adds a tag, <kbd>&gt;</kbd> files it in a list, and <kbd>&lt;</kbd> sets a date: <code>Buy stamps #post &gt;03 &lt;fri</code>
    </p>
  </div>
</dialog>

<style>
  .inner {
    padding: 16px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  h2 {
    font-size: var(--t-sub);
    font-weight: 800;
  }

  dl {
    display: grid;
    margin: 0;
  }

  .pair {
    display: grid;
    grid-template-columns: 120px 1fr;
    align-items: center;
    min-height: 32px;
    border-bottom: 1px solid var(--line);
  }

  dt {
    display: flex;
    gap: 4px;
  }

  dd {
    margin: 0;
  }

  .capture {
    margin-top: 14px;
    color: var(--ink-2);
    font-size: var(--t-meta);
    line-height: 1.7;
  }

  code {
    font: inherit;
    color: var(--ink);
    font-weight: 600;
  }
</style>
