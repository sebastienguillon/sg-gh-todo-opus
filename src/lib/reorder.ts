import { store } from './store.svelte'

/** Travel, in px, before a press on the handle becomes a drag. */
const START = 4
/** How close to the top or bottom of the view, in px, the page starts to scroll under a drag. */
const EDGE = 56
/** Scroll speed at the very edge, in px per frame. */
const SPEED = 16

interface Slot {
  id: string
  top: number
  bottom: number
}

/**
 * Drag a list row by its handle. The row follows the pointer, a 2px ink line marks where it will land,
 * and the page scrolls near the top and bottom of the view. Only the list's other open rows on screen are
 * places to land. Esc, or a cancelled pointer, puts it back. Positions are kept in page coordinates, so
 * they stay true while the page scrolls under the drag.
 */
export function dragRow(e: PointerEvent, handle: HTMLElement) {
  if (e.button !== 0) return
  const li = handle.closest<HTMLElement>('li[data-todo-id]')
  const ul = li?.parentElement
  const id = li?.dataset.todoId
  if (!li || !ul || !id) return
  // No text selection, no focus change, and no phone swipe starting under the handle.
  e.preventDefault()
  e.stopPropagation()
  handle.setPointerCapture(e.pointerId)

  const pointerId = e.pointerId
  const startY = e.clientY + scrollY
  let clientY = e.clientY
  let dragging = false
  let slots: Slot[] = []
  let from = 0
  let to = 0
  let line: HTMLElement | null = null
  let frame = 0
  let over = false

  const pageRect = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left + scrollX, right: r.right + scrollX }
  }

  function begin(): boolean {
    slots = [...ul!.children]
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el !== li && !!el.dataset.todoId)
      .filter((el) => store.find(el.dataset.todoId!)?.done === false)
      .map((el) => ({ id: el.dataset.todoId!, ...pageRect(el) }))
    if (!slots.length) return false
    const own = pageRect(li!)
    from = slots.filter((s) => s.top < own.top).length
    to = from
    dragging = true
    li!.classList.add('lifted')
    document.documentElement.classList.add('row-dragging')
    const row = li!.querySelector('.row') ?? li!
    const edge = matchMedia('(max-width: 767px)').matches ? 16 : 12
    const start = pageRect(handle).left
    line = document.createElement('div')
    line.className = 'drop-line'
    line.style.left = `${start}px`
    line.style.width = `${pageRect(row).right - edge - start}px`
    line.hidden = true
    document.body.append(line)
    frame = requestAnimationFrame(scroll)
    return true
  }

  function update() {
    const y = clientY + scrollY
    li!.style.transform = `translateY(${y - startY}px)`
    to = slots.filter((s) => (s.top + s.bottom) / 2 < y).length
    if (!line) return
    line.hidden = to === from
    const at = to < slots.length ? slots[to].top : slots[slots.length - 1].bottom
    line.style.top = `${at - 1}px`
  }

  /** Near the band or the bottom of the view (above the phone's docked field), the page scrolls. */
  function scroll() {
    const top = document.querySelector('.band')?.getBoundingClientRect().bottom ?? 0
    const bottom = document.querySelector('.dock')?.getBoundingClientRect().top ?? innerHeight
    let v = 0
    if (clientY < top + EDGE) v = -SPEED * Math.min(1, (top + EDGE - clientY) / EDGE)
    else if (clientY > bottom - EDGE) v = SPEED * Math.min(1, (clientY - bottom + EDGE) / EDGE)
    if (v) {
      const before = scrollY
      scrollBy(0, v)
      if (scrollY !== before) update()
    }
    frame = requestAnimationFrame(scroll)
  }

  function move(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    clientY = ev.clientY
    if (!dragging && (Math.abs(clientY + scrollY - startY) < START || !begin())) return
    update()
  }

  function key(ev: KeyboardEvent) {
    if (ev.key !== 'Escape') return
    ev.preventDefault()
    ev.stopPropagation()
    finish(false)
  }

  function finish(drop: boolean) {
    if (over) return
    over = true
    cancelAnimationFrame(frame)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', cancel)
    handle.removeEventListener('lostpointercapture', cancel)
    window.removeEventListener('keydown', key, true)
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    line?.remove()
    li!.style.transform = ''
    li!.classList.remove('lifted')
    document.documentElement.classList.remove('row-dragging')
    if (!drop || !dragging || to === from) return
    // Right after the row above where it lands; at the top, just before the first row.
    store.place(id!, to > 0 ? { after: slots[to - 1].id } : { before: slots[0].id })
  }

  const up = () => finish(true)
  const cancel = () => finish(false)

  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', cancel)
  handle.addEventListener('lostpointercapture', cancel)
  window.addEventListener('keydown', key, true)
}
