<script lang="ts">
  import Icon from './Icon.svelte'
  import IndexRail from './IndexRail.svelte'
  import { ui } from './ui.svelte'

  let dialog: HTMLDialogElement

  $effect(() => {
    if (ui.sheet && !dialog.open) dialog.showModal()
    else if (!ui.sheet && dialog.open) dialog.close()
  })
</script>

<dialog bind:this={dialog} class="sheet index-sheet" aria-labelledby="sheet-h" onclose={() => (ui.sheet = false)}>
  <div class="grab">
    <h2 id="sheet-h">Index</h2>
    <form method="dialog"><button class="close" aria-label="Close the Index"><Icon name="close" size={18} /></button></form>
  </div>
  <div class="scroll">
    <IndexRail inSheet />
  </div>
</dialog>

<style>
  .index-sheet {
    display: none;
  }

  .index-sheet[open] {
    display: flex;
    flex-direction: column;
  }

  .grab {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 4px 4px 20px;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    font-size: var(--t-sub);
    font-weight: 800;
  }

  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    background: none;
  }

  .scroll {
    overflow: auto;
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
