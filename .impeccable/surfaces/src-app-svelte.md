---
version: 1
slug: "src-app-svelte"
primary_target: "src/App.svelte"
related_targets:
  - "src/lib/Band.svelte"
  - "src/lib/SyncIndicator.svelte"
  - "src/lib/IndexRail.svelte"
  - "src/lib/IndexSheet.svelte"
  - "src/lib/TodayLog.svelte"
  - "src/lib/ListSection.svelte"
  - "src/lib/TodoRow.svelte"
  - "src/lib/Signifier.svelte"
  - "src/lib/Capture.svelte"
  - "src/lib/Palette.svelte"
  - "src/lib/DateDialog.svelte"
  - "src/lib/TagDialog.svelte"
  - "src/lib/HelpDialog.svelte"
  - "src/lib/Toast.svelte"
---

# Main to-do screen

## Scope and mode

The app's main screen, on desktop and phone: the band, the Index rail (a bottom sheet on the phone), Today across lists, the list sections and their folded Done, the capture field (docked at the bottom on the phone), and the sync indicator with its details popover. Its overlays belong to it too: the palette (search or jump, move to a list, show only a tag, rename a list), the Reschedule and Tags dialogs, the Keyboard help and the undo toast. Mode: **Operate**. Production fidelity, fully keyboard-driven. A to-do is edited in place by opening its row; there is no separate editor screen. First-run token setup is the one adjacent screen: it shows instead of this one until a repo is connected or the demo is chosen, and the sync popover leads back to it (Connect a repo, Replace token).

## Audience, job, task

One keyboard-first user, opening it dozens of times a day at a desk and on a phone. The job is to triage what's late and what's due today across 15+ lists and hundreds of open to-dos, in one pass, without the mouse; then capture items and work through lists. Success: the morning triage is one pass down the gutter, edits are instant, and sync is silent until it fails.

Anti-goals (the user's own words): a corporate project tool; gamified or cute; too minimal to scan; a generic template.

## Ranges and states

- 15–30+ lists, up to ~100 open each; Today 0–20 items, with one calm line when nothing is due; titles up to ~80 characters, wrapping rather than truncating; 0–4 tags per row.
- Row states: overdue, due today, future, undated, keyboard-focused (an ink outline and the blue swipe behind the title), opened, just moved or rescheduled (> or < in the gutter for a beat), in conflict (an alarm mark before the date), done (folded under the perforation; the fold opens to show them and Clear done).
- Sync states, shown by the sync word at the right of the band: saving ('saving · 2 pending'), saved ('saved 14:32'), offline ('offline · 2 kept here'), failed (the band turns to alarm ink with 'Sync failed · 2 kept here' and Retry, or Reconnect when the token is the problem), conflict (a banner under the band naming the file; the latest edit was kept), and 'demo data' before a repo is connected. The word opens a popover with the full message, the pending changes, the repo and Check now, Replace token and Disconnect.
- Light and dark themes, following the system.

## Direction contract

THESIS: The checkbox column is a notation column. One glyph per state and one key per verb turn the morning triage into a single pass down the gutter. It refuses the category's round checkbox, its sidebar of anonymous coloured dots, and any swipe menu of extra options. On the phone the swipe the user approved in the brief carries only the notation's own verbs: right for ×, left for > and <.

OWN-WORLD: The Bullet Journal rapid-log key in black fineliner on a Rhodia dotPad. A flat Rhodia-orange band (#F0691E) over pad white (#FBFBF9), with fineliner black (#141414) ink. A fine pale-grey dot grid lives only in the gutter, on a 16px pitch (two dots to each 32px row) with each open bullet on a dot. Highlighter swipes with squared ends sit behind text: yellow for today, pink for overdue, blue for selection. Twelve fineliner inks mark each list's two-digit index. Atkinson Hyperlegible Next with tabular figures. Square corners, no shadows, and a dashed perforation rule above Done. No washi tape, stickers, lettering or handwriting faces.

STORY: You open the app and see today's date on a yellow swipe. What is late reads first: pink dates, with `x > <` beside each one. You clear it by keystroke, done, moved or rescheduled, and trust that it is already saved. Then you work a list.

FIRST VIEWPORT: Desktop:
- **Band:** a 48px orange band holding the Index toggle, a ⌘K search field, a Tags filter and, at the right, a keyboard-help button and the sync word ('saved 14:32', or 'saving · 2 pending').
- **Index rail:** a 248px rail headed by Today with its late and due counts, then every list as a number in its ink, the name and a count.
- **Main column:**
  - The 'Fri 16.10' heading, about 40px tall, on a yellow swipe, with a summary line beside it ('2 late · 3 due today · 214 open in 17 lists').
  - A capture field.
  - Overdue rows, then due-today rows. Each has a signifier, its list number in that list's ink, the title, tags, the list name in its ink, and a date in the right margin.
  - Then the first list section, ending at its perforation rule.

Phone: an orange app bar, the date on its yellow swipe heading the same log, triage by swipe (right for ×, left for a Move > and Later < tray) or by tapping a row open, which stacks × > < down its gutter, the capture docked at the bottom, and the Index in a bottom sheet.

FORM: Rapid Log, number 4 on the ordered list of seven grounded directions; seed key a837439e. The user kept it from a hand that also held Route Bullets, Construction Grid, Coupon Field Strip, Circled Route Catalog and the category standard. Signature move: the signifier gutter. Each open row's checkbox is drawn as a •. A done row shows ×, and for a moment after an action a row shows > (moved) or < (rescheduled). Late rows in Today always show the key hints for x, > and <; other open rows show them on hover or focus, and touch screens never do. Every signifier is still a real checkbox.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decisions made in the build

- **The product name.** The main screen carries no name; the band holds only tools and the sync word. "To Do" is the page title, the setup screen's heading ("Connect To Do to GitHub") and the voice of sync messages ("GitHub asked To Do to slow down").
- **Where notes and tags are edited.** In place. Enter, or a click or tap on the title, opens the row: the title becomes an input, and below it come a Markdown Note field and the actions Move, Reschedule, Tags, Delete and Close (Esc). Tags are edited in a Tags dialog (t, or Tags in the opened row) that suggests the tags in use. On the phone every dialog is a bottom sheet. Capture also takes `#tag`, `>list` and `<date`.
- **Where the `x > <` hints show.** At all times on late rows in Today; on hover or focus on every other open row; never on phones or touch screens.
- **How phone triage works.** By swipe and by the opened row, never by buttons under each late row. A drag right past 80px marks a row done; a drag left opens a tray of Move > and Later <. Opening a row stacks × > < down its gutter, and its action row keeps only Tags, Delete and Close.
- **Whether list numbers stay stable.** They do. A list's number is stored in its `_list.md` (`index`), a new list takes the number after the highest, and the screen offers no way to reorder or renumber lists. The only renumbering is automatic: when two lists share a number (created at once on two devices, or hand-edited), the one later by folder name moves to the end.
- **How a list is renamed.** In place, like a to-do's title. The heading's name is the control: a click or tap, `r` from any of the list's rows (Today rows included) or its heading, or Rename a list in the palette turns it into a field with the opened row's underline at heading size. Enter or leaving the field saves, Esc cancels, and `u` undoes. Only `name` in `_list.md` changes; the folder, number and ink stay, so the jump and capture keys keep working.
- **What a conflict offers beyond its banner.** Nothing to choose: the merge has already kept the latest edit, field by field. The banner names the file as it is on GitHub and offers only Dismiss. While it stands, the row carries an alarm mark before its date, the band's sync word reads "conflict", and saving goes on behind it. The edit that gave way is not offered back.

## Open decisions

- Lists can be added from the Index and renamed in place, but not re-inked, reordered or deleted on screen; for now that means editing the data repo by hand.
- Clear done deletes a list's done rows (with undo). Whether they should move to an archive folder instead stays open in PRODUCT.md.
