<script lang="ts">
  import { untrack } from 'svelte'

  // The rapid-log key: • open, × done, > moved, < rescheduled. Drawn, never typed.
  let { mark }: { mark: 'open' | 'done' | '>' | '<' } = $props()

  // Only a mark that changes while on screen is drawn in; marks present at load are still.
  const initial = untrack(() => mark)
  let changed = $derived(mark !== initial)
</script>

<svg class="signifier" class:draw={changed} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-mark={mark}>
  {#if mark === 'open'}
    <circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none" />
  {:else if mark === 'done'}
    {#key mark}<path pathLength="1" d="M4.5 4.5l7 7M11.5 4.5l-7 7" />{/key}
  {:else if mark === '>'}
    {#key mark}<path pathLength="1" d="M5.75 3.5 10.25 8l-4.5 4.5" />{/key}
  {:else}
    {#key mark}<path pathLength="1" d="M10.25 3.5 5.75 8l4.5 4.5" />{/key}
  {/if}
</svg>

<style>
  .signifier {
    display: block;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The one authored motion: a changed mark is drawn in, like a pen stroke. */
  .draw path {
    stroke-dasharray: 1;
    animation: ink 220ms var(--ease-out) both;
  }

  @keyframes ink {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .draw path {
      animation: none;
    }
  }
</style>
