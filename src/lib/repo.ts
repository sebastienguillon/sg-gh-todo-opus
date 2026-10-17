// The data repo's file format. Each list is a folder whose `_list.md` holds its
// index, name and ink; every other `.md` file in the folder is one to-do, with
// YAML front-matter for its fields and the note as the Markdown body. The
// reader is tolerant, because the files may be edited by hand on github.com.

import type { DayISO, Todo, TodoList } from './types'

export const LIST_FILE = '_list.md'
/** Timestamps for a hand-made file that has none: older than any edit the app makes. */
const EPOCH = '1970-01-01T00:00:00.000Z'
const DAY = /^\d{4}-\d{2}-\d{2}$/
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/
const TAG = /^[\p{L}\p{M}\p{N}_-]+$/u

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'untitled'
  )
}

/** Whether a repo path is a list's metadata or a to-do: `folder/file.md`, one level deep. */
export function isDataPath(path: string): boolean {
  return /^[^/._][^/]*\/[^/]+\.md$/.test(path) && !/\/readme\.md$/i.test(path)
}

export function folderOf(path: string): string {
  return path.slice(0, path.indexOf('/'))
}

export function fileOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The file names a to-do may have in a folder: its title, or its title and id when two share a title. */
export function todoNames(t: Todo, folder: string): [plain: string, unique: string] {
  const slug = slugify(t.title)
  const tail = slugify(t.id.replace(/^t-/, ''))
  return [`${folder}/${slug}.md`, `${folder}/${slug}-${tail}.md`]
}

// ---- writing ---------------------------------------------------------------

const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i

/** A YAML scalar: plain when that reads back as the same string, else JSON-quoted (valid YAML). */
function scalar(value: string, inFlow = false): string {
  const plain =
    value.length > 0 &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value) &&
    !/:\s|:$|\s#/.test(value) &&
    !(inFlow && /[,[\]{}]/.test(value)) &&
    !RESERVED.test(value) &&
    !/^[-+]?\.?\d/.test(value)
  return plain ? value : JSON.stringify(value)
}

function stamp(value: string | null, pattern: RegExp): string {
  if (value === null) return 'null'
  return pattern.test(value) ? value : JSON.stringify(value)
}

export function writeTodo(t: Todo): string {
  const lines = [
    '---',
    `id: ${scalar(t.id)}`,
    `title: ${scalar(t.title)}`,
    `tags: [${t.tags.map((tag) => scalar(tag, true)).join(', ')}]`,
    `due: ${stamp(t.due, DAY)}`,
    `done: ${t.done}`,
    `doneAt: ${stamp(t.doneAt, STAMP)}`,
    `order: ${Number.isFinite(t.order) ? t.order : 0}`,
    `createdAt: ${stamp(t.createdAt, STAMP)}`,
    `updatedAt: ${stamp(t.updatedAt, STAMP)}`,
    '---',
  ]
  const note = t.note.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  return lines.join('\n') + '\n' + (note ? `\n${note}\n` : '')
}

export function writeList(l: TodoList): string {
  return ['---', `index: ${l.index}`, `name: ${scalar(l.name)}`, `ink: ${l.ink}`, '---', ''].join('\n')
}

// ---- reading ---------------------------------------------------------------

type Value = string | number | boolean | null | Value[]

function unquote(raw: string): Value {
  const s = raw.trim()
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string
    } catch {
      return s.replace(/^"|"$/g, '')
    }
  }
  if (s.startsWith("'")) return s.replace(/^'|'$/g, '').replace(/''/g, "'")
  const plain = s.replace(/\s+#.*$/, '')
  if (/^(?:null|~)?$/i.test(plain)) return null
  if (/^(?:true|yes|on)$/i.test(plain)) return true
  if (/^(?:false|no|off)$/i.test(plain)) return false
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(plain)) return Number(plain)
  return plain
}

/** `[a, "b, c", 'd']` */
function flow(raw: string): Value[] {
  const inner = raw.trim().replace(/^\[|\]$/g, '')
  const items: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of inner) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ',') {
      items.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  items.push(current)
  return items.map((i) => i.trim()).filter(Boolean).map(unquote)
}

/** The small part of YAML that front-matter needs: scalars, flow and block lists, block text. */
function parseYaml(lines: string[]): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/)
    if (!m) continue
    const [, key, rest = ''] = m
    const value = rest.trim()
    if (value.startsWith('[')) {
      out[key] = flow(value)
    } else if (/^[|>][-+]?$/.test(value)) {
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim())
      out[key] = block.join(value.startsWith('|') ? '\n' : ' ').trim()
    } else if (!value || value.startsWith('#')) {
      const items: Value[] = []
      while (i + 1 < lines.length && /^\s*-(?:\s|$)/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s*-\s*/, '')))
      out[key] = items.length ? items : null
    } else {
      out[key] = unquote(value)
    }
  }
  return out
}

export function splitFrontMatter(text: string): { fields: Record<string, Value>; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  if (lines[0].trim() !== '---') return { fields: {}, body: src.trim() }
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'))
  if (end < 0) return { fields: {}, body: src.trim() }
  return { fields: parseYaml(lines.slice(1, end)), body: lines.slice(end + 1).join('\n').trim() }
}

function str(v: Value | undefined): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

function unslug(file: string): string {
  const words = file.replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled'
}

/** A stable id for a hand-made file without one, the same on every device. */
function pathId(path: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193)
  return `f-${(h >>> 0).toString(36)}`
}

function day(v: Value | undefined): DayISO | null {
  const s = str(v)?.trim()
  if (!s) return null
  return DAY.test(s.slice(0, 10)) ? s.slice(0, 10) : null
}

function tags(v: Value | undefined): string[] {
  const raw = Array.isArray(v) ? v.map(str) : (str(v)?.split(/[,\s]+/) ?? [])
  const out: string[] = []
  for (const r of raw) {
    const tag = r?.replace(/^#/, '').normalize('NFC').toLowerCase()
    if (tag && TAG.test(tag) && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** A to-do file; `order` is NaN when the file has none, for the caller to place it. */
export function readTodo(path: string, text: string, listId: string): Todo {
  const { fields, body } = splitFrontMatter(text)
  let title = str(fields.title)?.trim() || ''
  let note = body
  if (!title) {
    const heading = body.match(/^#{1,6}\s+(.+)$/m)
    if (heading && body.trimStart().startsWith(heading[0])) {
      title = heading[1].trim()
      note = body.slice(body.indexOf(heading[0]) + heading[0].length).trim()
    } else {
      title = unslug(fileOf(path))
    }
  }
  const doneAt = str(fields.doneAt)
  const done = fields.done === true || (fields.done === undefined && !!doneAt)
  const order = typeof fields.order === 'number' && Number.isFinite(fields.order) ? fields.order : Number.NaN
  const createdAt = str(fields.createdAt) ?? EPOCH
  return {
    id: str(fields.id)?.trim() || pathId(path),
    listId,
    title,
    note,
    tags: tags(fields.tags),
    due: day(fields.due),
    done,
    doneAt: done ? doneAt : null,
    order,
    createdAt,
    updatedAt: str(fields.updatedAt) ?? createdAt,
  }
}

/** A list's `_list.md`; `index` is NaN when the file has none, for the caller to number it. */
export function readList(folder: string, text: string | null): TodoList {
  const { fields } = splitFrontMatter(text ?? '')
  const index = typeof fields.index === 'number' && fields.index >= 1 ? Math.floor(fields.index) : Number.NaN
  const ink = typeof fields.ink === 'number' && fields.ink >= 1 && fields.ink <= 12 ? Math.floor(fields.ink) : Number.NaN
  return { id: folder, slug: folder, index, name: str(fields.name)?.trim() || unslug(folder), ink }
}

export function inkFor(index: number): number {
  return ((index - 1) % 12) + 1
}

/** Number lists without an index, and renumber clashes, after every list with a good one. */
export function settleLists(lists: TodoList[]): TodoList[] {
  const taken = new Set<number>()
  const sorted = [...lists].sort((a, b) => (a.index || Infinity) - (b.index || Infinity) || a.slug.localeCompare(b.slug))
  const late: TodoList[] = []
  for (const l of sorted) {
    if (Number.isFinite(l.index) && !taken.has(l.index)) taken.add(l.index)
    else late.push(l)
  }
  let next = Math.max(0, ...taken)
  for (const l of late) l.index = ++next
  for (const l of lists) if (!Number.isFinite(l.ink)) l.ink = inkFor(l.index)
  return lists
}

/** Give to-dos without an `order` a place after the rest of their list, in file order. */
export function settleOrders(todos: Todo[]): Todo[] {
  const max = new Map<string, number>()
  for (const t of todos) if (Number.isFinite(t.order)) max.set(t.listId, Math.max(max.get(t.listId) ?? 0, t.order))
  for (const t of todos) {
    if (Number.isFinite(t.order)) continue
    const next = (max.get(t.listId) ?? 0) + 1
    max.set(t.listId, next)
    t.order = next
  }
  return todos
}

/** Git's blob id for a file, so unchanged files can be told apart without fetching them. */
export async function blobSha(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null // not a secure context: the next read fetches the file instead
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const README = `# To Do data

This private repository holds the lists of the To Do app. The app reads and writes it through the GitHub API, and you can edit the files by hand too.

- Each folder is a list. Its \`${LIST_FILE}\` holds the list's \`index\` (its two-digit number), \`name\` and \`ink\` (colour 1–12).
- Every other \`.md\` file in a folder is one to-do. Its YAML front-matter holds \`id\`, \`title\`, \`tags\`, \`due\`, \`done\`, \`doneAt\`, \`order\`, \`createdAt\` and \`updatedAt\`; the Markdown body is the to-do's note.

A file added by hand needs only a title, either as \`title:\` in the front-matter or as a \`# Heading\`.
`
