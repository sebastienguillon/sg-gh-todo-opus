import { mount } from 'svelte'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './app.css'
import Root from './Root.svelte'

const app = mount(Root, {
  target: document.getElementById('app')!,
})

export default app
