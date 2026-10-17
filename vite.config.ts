import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves the app from /<repo>/; the dev server stays at /.
  base: command === 'build' ? '/sg-gh-todo-opus/' : '/',
  plugins: [svelte()],
}))
