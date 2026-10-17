---
version: 1
slug: "src-app-svelte"
primary_target: "src/App.svelte"
related_targets: []
---

# Main to-do screen

## Scope and mode

The app's main screen, on desktop and phone: the band, the Index rail, Today across lists, the list sections and their folded Done, and the sync indicator. Mode: **Operate**. Production fidelity, fully keyboard-driven. First-run token setup and the to-do editor are adjacent screens, entered from here.

## Audience, job, task

One keyboard-first user, opening it dozens of times a day at a desk and on a phone. The job is to triage what's late and what's due today across 15+ lists and hundreds of open to-dos, in one pass, without the mouse; then capture items and work through lists. Success: the morning triage is one pass down the gutter, edits are instant, and sync is silent until it fails.

Anti-goals (the user's own words): a corporate project tool; gamified or cute; too minimal to scan; a generic template.

## Ranges and states

- 15–30+ lists, up to ~100 open each; Today 0–20 items, with one calm line when nothing is due; titles up to ~80 characters; 0–4 tags per row.
- Row states: overdue, due today, future, undated, selected, keyboard-focused, done (folded).
- Sync states: saving, saved, offline (changes kept on this device), failed (band turns black with Retry), conflict (a banner naming the file; the latest write wins).

## Direction contract

THESIS: The checkbox column is a notation column. One glyph per state and one key per verb turn the morning triage into a single pass down the gutter. It refuses the category's round checkbox, its sidebar of anonymous coloured dots, and any swipe menu of extra options. On the phone the swipe the user approved in the brief carries only the notation's own verbs: right for ×, left for > and <.

OWN-WORLD: The Bullet Journal rapid-log key in black fineliner on a Rhodia dotPad. A flat Rhodia-orange band (#F0691E) over pad white (#FBFBF9), with fineliner black (#141414) ink. A 1px pale-grey dot grid lives only in the gutter, at the 32px row pitch. Highlighter swipes with squared ends sit behind text: yellow for today, pink for overdue, blue for selection. Twelve fineliner inks mark each list's two-digit index. Atkinson Hyperlegible Next with tabular figures. Square corners, no shadows, and a dashed perforation rule above Done. No washi tape, stickers, lettering or handwriting faces.

STORY: You open the app and see today's date on a yellow swipe. What is late reads first: pink dates, with `x > <` beside each one. You clear it by keystroke, done, moved or rescheduled, and trust that it is already saved. Then you work a list.

FIRST VIEWPORT: Desktop:
- **Band:** a 48px orange band holding the Index toggle, a ⌘K field, a tag filter and, at the right, 'saved 14:32 · 2 pending'.
- **Index rail:** a 248px rail listing every list as a number in its ink, the name and a count.
- **Main column:**
  - The 'Fri 16.10' heading, about 40px tall, on a yellow swipe.
  - A capture field.
  - Overdue rows, then due-today rows. Each has a signifier, its list number in that list's ink, the title, tags, and a date in the right margin.
  - Then the first list section, ending at its perforation rule.

Phone: an orange app bar, the date on its yellow swipe heading the same log, triage buttons (× > <) under each late row, the capture docked at the bottom, and the Index in a bottom sheet.

FORM: Rapid Log, number 4 on the ordered list of seven grounded directions; seed key a837439e. The user kept it from a hand that also held Route Bullets, Construction Grid, Coupon Field Strip, Circled Route Catalog and the category standard. Signature move: the signifier gutter. Each open row's checkbox is drawn as a •. A done row shows ×, and for a moment after an action a row shows > (moved) or < (rescheduled). Overdue rows show the key hints x, > and <. Every signifier is still a real checkbox.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Open decisions

- Product name. The header carries none for now.
- Where notes and tags are edited: inline expand, a side panel, or a phone sheet.
- Whether the `x > <` hints show on every overdue row or only on the focused one.
- Whether list numbers stay stable when lists are added or reordered.
- What a conflict offers beyond its banner.
