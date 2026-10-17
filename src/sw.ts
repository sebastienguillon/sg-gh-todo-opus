/**
 * The service worker: keeps the built app (the shell) on this device so To Do opens with no network.
 * The build compiles it to dist/sw.js and writes VERSION and SHELL above it (vite.config.ts), so any
 * change to any built file gives a new worker, which the browser installs on the next load.
 *
 * It only ever answers this origin's GET requests. Calls to api.github.com never reach it; the sync
 * queue in localStorage already covers offline writes.
 */

declare const self: ServiceWorkerGlobalScope
/** A hash of every built file. */
declare const VERSION: string
/** Every built file's URL, with index.html as "/". */
declare const SHELL: string[]

const PREFIX = 'to-do-shell-'
const CACHE = PREFIX + VERSION
/** How long a page load waits for the network before it opens this device's copy. */
const PAGE_WAIT_MS = 3000
/** Shell files are the same whoever asks: a server's `Vary: Origin` mustn't hide them from crossorigin requests. */
const MATCH: CacheQueryOptions = { ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Revalidate every file, so a copy in the HTTP cache from an older deploy can't slip into this one.
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'no-cache' })))
      // The old shell's pages keep working: they already have their scripts and styles.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
  event.respondWith(request.mode === 'navigate' ? page(request) : file(request))
})

/** The page: the network first, so a deploy shows on the next load; this device's copy when offline or slow. */
async function page(request: Request): Promise<Response> {
  const network = fetch(request, { cache: 'no-cache' })
  const copy = await (await caches.open(CACHE)).match('/', MATCH)
  if (!copy) return network
  try {
    return await Promise.race([network, new Promise<never>((_, reject) => setTimeout(reject, PAGE_WAIT_MS))])
  } catch {
    return copy
  }
}

/** Scripts, styles, fonts and icons: this build's copy, or the network for anything it doesn't hold. */
async function file(request: Request): Promise<Response> {
  return (await (await caches.open(CACHE)).match(request, MATCH)) ?? fetch(request)
}
