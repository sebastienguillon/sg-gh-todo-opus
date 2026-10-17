<script lang="ts">
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import { store } from './store.svelte'
  import { focusRestored, ui } from './ui.svelte'

  async function undo() {
    const id = store.undo()
    await tick()
    if (id) focusRestored(id)
    else ui.focusLog()
  }

  function dismiss() {
    store.dismissToast()
    ui.focusLog()
  }
</script>

<!-- The status region stays mounted so its message is announced when it changes. -->
<div
  class="region"
  role="status"
  onpointerenter={() => store.pauseToast(true)}
  onpointerleave={() => store.pauseToast(false)}
  onfocusin={() => store.pauseToast(true)}
  onfocusout={() => store.pauseToast(false)}
>
  {#if store.toast}
    <div class="toast">
      <span>{store.toast.message}</span>
      {#if store.toast.undo}
        <button class="undo" onclick={undo}>Undo <kbd>u</kbd></button>
      {/if}
      <button class="x" aria-label="Dismiss" onclick={dismiss}><Icon name="close" size={14} /></button>
    </div>
  {/if}
</div>

<style>
  .region {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 40;
    max-width: calc(100vw - 32px);
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 6px 0 14px;
    background: var(--ink);
    color: var(--pad);
  }

  .undo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 6px 0 10px;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font-weight: 700;
  }

  .undo kbd {
    min-width: 18px;
    height: 18px;
  }

  .undo:hover {
    background: color-mix(in srgb, var(--pad) 14%, transparent);
  }

  .x {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    background: none;
    color: inherit;
  }

  .toast :global(:focus-visible) {
    outline-color: var(--pad);
  }

  @media (max-width: 767px) {
    .region {
      left: 8px;
      right: 8px;
      bottom: calc(76px + env(safe-area-inset-bottom));
    }

    .undo,
    .x {
      min-height: 36px;
      min-width: 36px;
    }
  }
</style>
