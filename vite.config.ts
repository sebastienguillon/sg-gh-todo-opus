import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * The Content-Security-Policy in index.html is the one the built app ships with.
 * The dev server needs more: it injects component styles as <style> tags,
 * talks HMR over a websocket, and may point the app at a local test API.
 */
function devCsp(api: string | undefined): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace('connect-src https://api.github.com', `connect-src https://api.github.com 'self' ws: wss:${api ? ` ${new URL(api).origin}` : ''}`),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Served from the root of its own hostname, do.sebastienguillon.com.
  base: '/',
  plugins: [svelte(), devCsp(loadEnv(mode, process.cwd(), 'VITE_').VITE_GITHUB_API)],
}))
