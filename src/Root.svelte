<script lang="ts">
  import App from './App.svelte'
  import Setup from './lib/Setup.svelte'
  import { store } from './lib/store.svelte'
</script>

<!-- The first-run screen until a repo is connected (or the demo chosen); the main screen after. -->
{#if store.mode === 'setup' || store.setupOpen}
  <Setup />
{:else}
  <App />
{/if}
