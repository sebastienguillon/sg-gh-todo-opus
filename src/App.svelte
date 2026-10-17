<script lang="ts">
  import { onMount, tick } from 'svelte'
  import Band from './lib/Band.svelte'
  import Capture from './lib/Capture.svelte'
  import DateDialog from './lib/DateDialog.svelte'
  import HelpDialog from './lib/HelpDialog.svelte'
  import Icon from './lib/Icon.svelte'
  import IndexRail from './lib/IndexRail.svelte'
  import IndexSheet from './lib/IndexSheet.svelte'
  import ListSection from './lib/ListSection.svelte'
  import Palette from './lib/Palette.svelte'
  import { store } from './lib/store.svelte'
  import TagDialog from './lib/TagDialog.svelte'
  import Toast from './lib/Toast.svelte'
  import TodayLog from './lib/TodayLog.svelte'
  import { focusedTodoId, focusRow, ui } from './lib/ui.svelte'

  const phoneQuery = matchMedia('(max-width: 767px)')
  const MODIFIERS = ['Shift', 'Alt', 'AltGraph', 'Control', 'Meta', 'CapsLock', 'Dead']
  let isPhone = $state(phoneQuery.matches)
  let main = $state<HTMLElement>()

  // ---- keyboard ------------------------------------------------------------

  let jump: { buffer: string; timer: ReturnType<typeof setTimeout> } | null = null

  function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('main [data-row-focus]')]
  }

  function bandHeight(): number {
    return document.querySelector('.band')?.getBoundingClientRect().height ?? 48
  }

  function onScreen(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect()
    return r.bottom > bandHeight() && r.top < innerHeight
  }

  /** j/k: the next or previous row from wherever focus is, or from what is on screen. */
  function step(direction: 1 | -1) {
    const all = rows()
    if (!all.length) return
    const active = document.activeElement as HTMLElement | null
    let next: HTMLElement | undefined
    const at = active ? all.indexOf(active) : -1
    if (at >= 0) {
      next = all[Math.max(0, Math.min(all.length - 1, at + direction))]
    } else if (active && active !== document.body && main?.contains(active) && onScreen(active)) {
      next =
        direction === 1
          ? all.find((r) => active.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING)
          : all.findLast((r) => active.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING)
      if (!next) return // nothing further that way: stay put rather than jump against the key
    } else {
      const top = bandHeight()
      const visible = all.filter((r) => {
        const y = r.getBoundingClientRect().top
        return y >= top && y < innerHeight
      })
      next = direction === 1 ? visible[0] : visible.at(-1)
    }
    // Nothing on screen: the nearest row past the viewport in the direction of travel.
    next ??=
      direction === 1
        ? (all.find((r) => r.getBoundingClientRect().top >= bandHeight()) ?? all.at(-1))
        : (all.findLast((r) => r.getBoundingClientRect().top < innerHeight) ?? all[0])
    next?.focus({ preventScroll: true })
    next?.closest('li')?.scrollIntoView({ block: 'nearest' })
  }

  function endJump() {
    if (!jump) return
    clearTimeout(jump.timer)
    const { buffer } = jump
    jump = null
    if (buffer === 't') ui.jumpToToday()
    else if (buffer) ui.jumpToIndex(Number(buffer))
  }

  /** The digit a key stands for, whatever the layout (AZERTY digits need Shift). */
  function digitOf(e: KeyboardEvent): string | null {
    if (/^\d$/.test(e.key)) return e.key
    const m = e.code.match(/^(?:Digit|Numpad)(\d)$/)
    return m ? m[1] : null
  }

  function undo() {
    void ui.afterUndo(store.undo(), false)
  }

  function onkeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      ui.openPalette('search')
      return
    }
    if (document.querySelector('dialog[open]')) return
    const typing = target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing && store.toast?.undo) {
      e.preventDefault()
      undo()
      return
    }
    if (typing) return
    if (e.metaKey || e.ctrlKey) return

    if (jump) {
      if (MODIFIERS.includes(e.key)) return
      const digit = digitOf(e)
      if (digit || (e.key === 't' && !jump.buffer)) {
        e.preventDefault()
        jump.buffer += digit ?? 't'
        clearTimeout(jump.timer)
        if (jump.buffer.length >= 2 || e.key === 't') endJump()
        else jump.timer = setTimeout(endJump, 700)
        return
      }
      endJump()
    }

    const id = focusedTodoId()
    const onRow = target.matches?.('[data-row-focus]')
    if (e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
      // Delete the list of the row or heading in focus; with neither, pick one in the palette.
      // A held key deletes nothing more: focus lands in the next list after a delete.
      e.preventDefault()
      if (e.repeat) return
      const section = target.closest<HTMLElement>('section.list')
      const listId = id ? store.find(id)?.listId : section?.id.replace(/^list-/, '')
      if (listId) ui.requestDeleteList(listId)
      else ui.openDeletePicker()
      return
    }
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
      case 'k':
      case 'ArrowUp': {
        const direction = e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1
        const arrow = e.key.startsWith('Arrow')
        if (arrow && !onRow) return // arrows scroll the page unless a row has focus
        e.preventDefault()
        if (e.altKey && id && onRow) {
          const section = target.closest('section')
          store.reorder(id, direction)
          tick().then(() => focusRow(id, section ?? document))
        } else {
          step(direction)
        }
        break
      }
      case 'x':
        if (id) {
          e.preventDefault()
          store.toggle(id)
        }
        break
      case '>':
        if (id) {
          e.preventDefault()
          ui.openPalette('move', id)
        }
        break
      case '<':
        if (id) {
          e.preventDefault()
          ui.openDate(id)
        }
        break
      case 't':
        if (id) {
          e.preventDefault()
          ui.openTags(id)
        }
        break
      case 'r': {
        // The list of the row or heading in focus; with neither, pick one in the palette.
        e.preventDefault()
        const section = target.closest<HTMLElement>('section.list')
        const listId = id ? store.find(id)?.listId : section?.id.replace(/^list-/, '')
        if (listId) void ui.renameList(listId)
        else ui.openPalette('rename')
        break
      }
      case 'u':
        if (store.toast?.undo) {
          e.preventDefault()
          undo()
        }
        break
      case 'Enter':
        // A held Enter (say, on the ask's Delete list) mustn't go on to open the row focus lands on.
        if (id && onRow && !e.repeat) {
          e.preventDefault()
          ui.toggleExpanded(`${target.closest('#today') ? 'today' : 'list'}:${id}`)
        }
        break
      case 'Delete':
      case 'Backspace':
        if (id && onRow) {
          e.preventDefault()
          ui.lastDeleteScope = target.closest('#today') ? 'today' : 'list'
          store.remove(id)
        }
        break
      case 'n':
        e.preventDefault()
        document.getElementById('capture')?.focus()
        break
      case '/':
        e.preventDefault()
        ui.openPalette('search')
        break
      case '#':
        e.preventDefault()
        ui.openPalette('tag')
        break
      case '?':
        e.preventDefault()
        ui.openHelp()
        break
      case 'g':
        e.preventDefault()
        jump = { buffer: '', timer: setTimeout(endJump, 1200) }
        break
      case 'Escape':
        if (ui.tray) ui.tray = null
        else if (ui.expanded) ui.expanded = null
        else if (store.tagFilter) store.setTagFilter(null)
        break
    }
  }

  // ---- focus survives rows leaving ------------------------------------------
  // A row that is done, moved or rescheduled leaves after its mark; focus moves
  // to whatever row now stands in its place instead of falling to the page.

  let lastFocused: HTMLElement | null = null
  let lastIndex = -1

  function onfocusin(e: FocusEvent) {
    const el = e.target as HTMLElement
    if (!el.matches?.('[data-row-focus]')) return
    lastFocused = el
    ui.lastRow = el
    lastIndex = rows().indexOf(el)
  }

  onMount(() => {
    const onPhone = () => (isPhone = phoneQuery.matches)
    phoneQuery.addEventListener('change', onPhone)

    const observer = new MutationObserver(() => {
      if (!lastFocused) return
      if (lastFocused.isConnected) {
        // Rows above may have left; keep the remembered position current.
        lastIndex = rows().indexOf(lastFocused)
        return
      }
      if (lastIndex < 0) return
      if (document.activeElement && document.activeElement !== document.body) return
      if (document.querySelector('dialog[open]')) return
      const all = rows()
      const next = all[Math.min(lastIndex, all.length - 1)]
      lastFocused = null
      next?.focus({ preventScroll: true })
    })
    if (main) observer.observe(main, { childList: true, subtree: true })

    const closeTray = (e: PointerEvent) => {
      if (ui.tray && !(e.target as HTMLElement).closest('.item')) ui.tray = null
    }
    document.addEventListener('pointerdown', closeTray)

    // The phone bar shows the date only once the day heading has scrolled away.
    const heading = document.getElementById('today-h')
    const headingObserver = new IntersectionObserver(([entry]) => (ui.headingVisible = entry.isIntersecting), {
      rootMargin: '-56px 0px 0px 0px',
    })
    if (heading) headingObserver.observe(heading)

    return () => {
      phoneQuery.removeEventListener('change', onPhone)
      observer.disconnect()
      headingObserver.disconnect()
      document.removeEventListener('pointerdown', closeTray)
    }
  })

  // ---- state that pointed at a list or to-do a sync took away -------------------

  $effect(() => {
    const gone = (key: string | null) => !!key && !store.find(key.slice(key.indexOf(':') + 1))
    if (ui.renaming && !store.listById.has(ui.renaming)) ui.renaming = null
    if (gone(ui.expanded)) ui.expanded = null
    if (gone(ui.tray)) ui.tray = null
  })

  // ---- where am I: the Index marks the list at the top of the page ----------

  $effect(() => {
    void store.listsInOrder.length
    void store.tagFilter
    let observer: IntersectionObserver | undefined
    tick().then(() => {
      const seen = new Map<string, boolean>()
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) seen.set(entry.target.id.replace(/^list-/, ''), entry.isIntersecting)
          const first = store.listsInOrder.find((l) => seen.get(l.id))
          ui.activeList = first ? first.id : null
        },
        { rootMargin: '-64px 0px -55% 0px' },
      )
      document.querySelectorAll('section.list').forEach((s) => observer!.observe(s))
    })
    return () => observer?.disconnect()
  })
</script>

<svelte:window {onkeydown} />

<Band {isPhone} />

{#if store.sync.kind === 'conflict'}
  <div class="conflict" role="alert">
    <Icon name="alert" />
    <p>
      {#if store.sync.message}
        {store.sync.message}
      {:else}
        <strong>Conflict.</strong> <code>{store.sync.path}</code> changed on GitHub and on this device at the same time. The
        latest edit was kept.
      {/if}
    </p>
    <button class="btn" onclick={() => store.dismissConflict()}>Dismiss</button>
  </div>
{/if}

<div class="layout" class:with-rail={!isPhone && ui.railOpen}>
  {#if !isPhone && ui.railOpen}
    <aside class="rail">
      <IndexRail />
    </aside>
  {/if}

  <main bind:this={main} onfocusin={onfocusin}>
    <TodayLog compact={isPhone} />
    {#each store.listsInOrder as list (list.id)}
      <ListSection {list} />
    {/each}
  </main>
</div>

{#if isPhone}
  <div class="dock">
    <Capture />
  </div>
{/if}

<Palette />
<DateDialog />
<TagDialog />
<HelpDialog />
<IndexSheet />
<Toast />

<div class="vh" aria-live="polite">{store.announcement}</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: calc(100dvh - var(--band));
  }

  .layout.with-rail {
    grid-template-columns: var(--rail) minmax(0, 1fr);
  }

  .rail {
    position: sticky;
    top: var(--band);
    height: calc(100dvh - var(--band));
    overflow: auto;
    background: var(--pad-2);
    border-right: 1px solid var(--line);
    scrollbar-width: thin;
  }

  main {
    width: 100%;
    max-width: 1080px;
    padding-bottom: 120px;
  }

  /* In the flow under the band, not over the rail; the band keeps saying "conflict" after it scrolls away. */
  .conflict {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px 8px 16px;
    background: var(--alarm);
    color: var(--on-alarm);
  }

  .conflict p {
    flex: 1;
    line-height: 1.4;
  }

  .conflict code {
    font: inherit;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .conflict .btn {
    border-color: currentColor;
    color: inherit;
  }

  .conflict .btn:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .conflict :global(:focus-visible) {
    outline-color: currentColor;
  }

  .dock {
    position: sticky;
    bottom: 0;
    z-index: 15;
  }

  @media (max-width: 767px) {
    .conflict {
      align-items: flex-start;
    }

    main {
      padding-bottom: 24px;
    }
  }
</style>
