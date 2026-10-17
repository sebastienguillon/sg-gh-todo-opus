import { mount } from 'svelte'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './app.css'
import Root from './Root.svelte'
import { sharedOrigin } from './lib/remote.svelte'

const app = mount(Root, {
  target: document.getElementById('app')!,
})

// Keep the built app on this device so it opens offline (src/sw.ts). Never on a shared github.io
// origin, where a worker at "/" would sit over every Pages site on the account.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !sharedOrigin())
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))

export default app
