import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { defineConfig, loadEnv, transformWithOxc, type Plugin } from 'vite'

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

/**
 * Writes dist/sw.js from src/sw.ts once the build is on disk. Above the worker go the shell it
 * keeps on the device (every built file except CNAME) and a version hashed from all of them, so
 * any change gives a new sw.js and the browser installs it on the next load.
 */
function serviceWorker(): Plugin {
  let root = ''
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved: (config) => {
      root = config.root
    },
    async writeBundle({ dir }) {
      const out = dir!
      const files = (await readdir(out, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => relative(out, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .filter((file) => file !== 'CNAME' && file !== 'sw.js')
        .sort()
      const { code } = await transformWithOxc(await readFile(resolve(root, 'src/sw.ts'), 'utf8'), 'sw.ts')
      const hash = createHash('sha256').update(code)
      for (const file of files) hash.update(file).update(await readFile(join(out, file)))
      const shell = files.map((file) => (file === 'index.html' ? '/' : `/${file}`))
      await writeFile(join(out, 'sw.js'), `const VERSION = '${hash.digest('hex').slice(0, 12)}'\nconst SHELL = ${JSON.stringify(shell)}\n${code}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Served from the root of its own hostname, do.sebastienguillon.com.
  base: '/',
  plugins: [svelte(), devCsp(loadEnv(mode, process.cwd(), 'VITE_').VITE_GITHUB_API), serviceWorker()],
}))
