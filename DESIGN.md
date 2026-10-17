---
name: To Do
description: A rapid-log to-do list in black fineliner on a pad, under an orange cover band.
colors:
  orange: "#f0691e"
  on-orange: "#141414"
  pad: "#fbfbf9"
  pad-2: "#f3f3ef"
  pad-3: "#e8e8e3"
  ink: "#141414"
  ink-2: "#55555d"
  ink-3: "#6b6b73"
  rule: "#a9a9b1"
  line: "#e3e3e0"
  hl-today: "#fff176"
  hl-late: "#ff9cc6"
  hl-select: "#bde7ff"
  on-hl: "#141414"
  alarm: "#141414"
  on-alarm: "#fbfbf9"
  list-1: "#233c8c"
  list-2: "#07777a"
  list-3: "#b5267e"
  list-4: "#277a35"
  list-5: "#1c6db8"
  list-6: "#6b3fa0"
  list-7: "#7a4a22"
  list-8: "#9c3d12"
  list-9: "#5f6d1a"
  list-10: "#8a5d00"
  list-11: "#4a5a6e"
  list-12: "#1e6b5c"
typography:
  display:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  title:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1.4
    fontFeature: "tnum"
  body:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "calc(24 / 18)"
    fontFeature: "tnum"
  label:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "calc(20 / 14.625)"
    fontFeature: "tnum"
  numeral:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    fontFeature: "tnum"
  keycap:
    fontFamily: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  none: "0px"
spacing:
  row: "32px"
  row-phone: "44px"
  edge: "12px"
  band: "48px"
  margin-col: "104px"
  gutter: "124px"
  rail: "248px"
components:
  cover-band:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.on-orange}"
    height: "{spacing.band}"
    padding: "0 12px"
  cover-band-alarm:
    backgroundColor: "{colors.alarm}"
    textColor: "{colors.on-alarm}"
  band-search:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "32px"
    width: "min(420px, 40vw)"
    padding: "0 8px 0 10px"
  index-rail:
    backgroundColor: "{colors.pad-2}"
    textColor: "{colors.ink}"
    width: "{spacing.rail}"
    padding: "20px 12px 24px"
  index-item:
    textColor: "{colors.ink}"
    height: "{spacing.row}"
    padding: "0 8px"
  index-item-current:
    backgroundColor: "{colors.hl-select}"
    textColor: "{colors.on-hl}"
  todo-row:
    backgroundColor: "{colors.pad}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    height: "{spacing.row}"
  todo-row-done:
    textColor: "{colors.ink-3}"
  list-index:
    typography: "{typography.numeral}"
    width: "36px"
  signifier-key:
    backgroundColor: "{colors.pad}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    size: "20px"
  signifier-key-hover:
    textColor: "{colors.ink}"
  phone-triage-button:
    backgroundColor: "{colors.pad-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "40px"
    height: "44px"
  phone-triage-button-active:
    backgroundColor: "{colors.line}"
  swipe-today:
    backgroundColor: "{colors.hl-today}"
    textColor: "{colors.on-hl}"
    padding: "0 4px"
  swipe-late:
    backgroundColor: "{colors.hl-late}"
    textColor: "{colors.on-hl}"
    padding: "0 4px"
  swipe-select:
    backgroundColor: "{colors.hl-select}"
    textColor: "{colors.on-hl}"
    padding: "0 4px"
  button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 12px"
  button-hover:
    backgroundColor: "{colors.pad-3}"
  button-active:
    backgroundColor: "{colors.line}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pad}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 12px"
  button-primary-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 12px"
  field:
    backgroundColor: "{colors.pad}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "36px"
    padding: "6px 10px"
  field-large:
    backgroundColor: "{colors.pad}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "6px 10px"
  capture-field:
    backgroundColor: "{colors.pad}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "6px 10px"
  keycap:
    typography: "{typography.keycap}"
    rounded: "{rounded.none}"
    height: "20px"
    padding: "0 4px"
  tag-chip:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    height: "28px"
    padding: "0 8px"
  tag-chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pad}"
  dialog-sheet:
    backgroundColor: "{colors.pad}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "min(560px, calc(100vw - 32px))"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pad}"
    height: "40px"
    padding: "0 6px 0 14px"
---

# Design System: To Do

## Overview

**Creative North Star: "The Rapid Log"**

The Rapid Log is the Bullet Journal's rapid-log key, written in black fineliner on a Rhodia pad under its orange cover band. The checkbox column is a notation column. Each state has one drawn glyph (• open, × done, > moved, < rescheduled) and each verb has one key (x, >, <), so the morning triage is a single pass down that gutter.

The density is that of a working notebook: 32px rows, 18px text, tabular figures throughout, and dates in a right margin. Colour carries meaning and nothing else. Orange is the cover. Highlighter swipes sit behind text for today (yellow), late (pink) and selection (blue). Twelve fineliner inks identify lists through their two-digit index. Everything else is black and grey ink on pad white.

The surface is flat paper: square corners, 1px ink borders, no shadows, and a dashed perforation above each list's Done. The system refuses the category's round checkbox, a sidebar of anonymous coloured dots, swipe menus of extra options, and any washi tape, stickers, hand lettering or handwriting faces.

**Key Characteristics:**
- A signifier gutter: one drawn glyph per state, each over a real checkbox.
- An orange cover band over black and grey ink on pad white.
- Highlighters behind text only: yellow today, pink late, blue selection.
- Twelve fineliner inks on two-digit list indexes.
- One face, Atkinson Hyperlegible Next, with tabular figures and weights from 400 to 800.
- Square, flat and shadowless, with a dashed perforation above Done.
- Light and dark schemes from the same token names.

## Colors

A cover orange, three highlighters, twelve list inks and a black-and-grey pad, each with one job.

### Primary
- **Rhodia Cover Orange** (#f0691e): the 48px cover band, the phone app bar, the browser theme colour and the app icon. Text and icons on it are fineliner black (`on-orange`, 5.9:1). The band search field takes a faint tint of it (pad mixed 88% with orange). It is never used inside the pad.

### Secondary
The highlighters. Each is a fill behind fineliner ink, and the ink over them is always `on-hl`.
- **Today Yellow** (#fff176): the display swipe under today's date and the "today" date label on rows, nothing else. The phone's swipe-right done reveal is Pressed Paper, not yellow.
- **Overdue Pink** (#ff9cc6): late date labels ("−3d") and the late count beside Today in the Index.
- **Selection Blue** (#bde7ff): the current list in the Index, the active palette option, a keyboard-focused row's title, and text selection.
- **Ink over Highlighter** (#141414): the only text colour allowed on a highlighter, identical in both schemes.

### Tertiary
Twelve fineliner inks for list identity, assigned by index and cycling after twelve (list 13 takes ink 1). Each holds at least 4.8:1 on both pad and rail paper in light mode.
- **Navy** (#233c8c), **Teal** (#07777a), **Magenta** (#b5267e), **Leaf** (#277a35), **Cobalt** (#1c6db8), **Violet** (#6b3fa0), **Umber** (#7a4a22), **Rust** (#9c3d12), **Olive** (#5f6d1a), **Ochre** (#8a5d00), **Slate** (#4a5a6e), **Pine** (#1e6b5c): inks 1 to 12, used for a list's two-digit number wherever it appears, and for the list name on Today rows.

### Neutral
- **Pad White** (#fbfbf9): the page, rows, fields, dialogs and the docked phone capture.
- **Rail Paper** (#f3f3ef): the Index rail. Mixed 70% into the pad, it is also the row hover tint.
- **Pressed Paper** (#e8e8e3): button hover, the chip clear button's hover, both phone swipe reveals (the × strip uncovered by a right drag and the Move and Later tray) and the phone triage buttons.
- **Fineliner Black** (#141414): all primary text, button and field borders, dialog edges, focus outlines, the primary button fill and the toast.
- **Graphite** (#55555d): secondary text: counts, tags, plain dates, hints, the summary line.
- **Faded Ink** (#6b6b73): done rows and their signifiers, placeholders, the capture bullet, the jump key caps on list headings.
- **Perforation Grey** (#a9a9b1): the dashed perforation, quiet borders (key hints, tag chips, field rest state, hover outlines) and the scrollbar.
- **Hairline** (#e3e3e0): dividers: the rail's right edge, dialog headers, help rows, the opened row's bottom. It is also the pressed fill of buttons and of the phone verb stack.
- **Alarm** (#141414 / on-alarm #fbfbf9): the failed-sync band, the conflict banner and the conflict mark on a row.

**Dark scheme.** The same token names switch under `prefers-color-scheme: dark`; the exact values are in the dark block of `src/app.css` and in each `colorMeta.<token>.dark` entry of the sidecar. The band becomes a deeper burnt orange with near-black text. The pad turns to near-black graphite, with rail paper and pressed paper one and two steps lighter. The inks become off-white and mid greys, and the rules dim to dark greys. The highlighters are dimmed to mustard, rose and steel blue and stay under the same black ink. Alarm flips, so a failed band turns off-white with black text. The twelve list inks become light tints of the same hues, each at least 7.2:1 on the dark pad and rail.

### Named Rules
**The Cover Band Rule.** Orange is the notebook's cover and nothing else. It fills the band (and the browser theme colour and the app icon) and never appears on text, rows, buttons or rules inside the pad. The band changes colour only when sync fails, when it turns to ink.

**The Highlighter Rule.** Highlighters are fills behind fineliner ink, never text colours. Yellow means today, pink means late, blue means selected or current, and the ink over any of them is always `on-hl` black, in both schemes.

**The Ink Identity Rule.** A list's ink colours only its two-digit index, its name on Today rows, and the > mark beside it in the move picker. Titles, tags and dates stay black and grey. Because the twelve inks repeat, the number and name identify a list; the colour alone never does.

## Typography

**Display Font:** Atkinson Hyperlegible Next Variable (with Atkinson Hyperlegible Next, system-ui, sans-serif)
**Body Font:** the same family
**Label/Mono Font:** the same family; key caps and figures use its tabular numerals

**Character:** One legible sans in five weights, set dense and plain like a printed key. Heavy 800 headings against 400 body give the date and list names a notebook-header weight without a second face.

**Root.** The root em is 112.5% (`html { font-size: 112.5% }`): 18px at the browser's default 16px, and larger when the reader sets larger text. Every font size is a rem of it, so the type scale moves as one, and every px size named on this page is its value at the default. Text line heights are unitless (`calc(24 / 18)` is a 24px line on 18px text), so line boxes grow with the text. A box sized by its line of text is written as its default px over 18, in rem, so it grows too: one body line in a row is `--body-line` (`calc(24rem / 18)`), and key caps are `calc(20rem / 18)`. Controls and rows that hold text take their px height as a minimum. Spacing, gutters, the rail and band widths and the breakpoints stay in px.

### Hierarchy
- **Display** (800, 2.5rem / 45px, 1.1, −0.02em; 2rem / 36px on phone): today's date ("Sat 17.10") only, on its yellow display swipe.
- **Headline** (800, 1.625rem / 29.25px, 1.15, −0.01em): list section headings, the index number in the list's ink followed by the name, and the setup screen's heading.
- **Title** (800, 1.125rem / 20.25px): dialog and sheet titles (Reschedule, Tags, Keyboard, Index, Sync) and the date in the phone bar once the heading scrolls away. The palette query and the large fields (in dialogs and on the setup screen) use this size at 400.
- **Body** (400, 1rem / 18px, a 24px line box in rows (`calc(24 / 18)`), 1.4 elsewhere): to-do titles, fields and running text. Buttons use 500. Notes in the opened row and running prose (the setup lede, the setup screen's alert and errors, the sync popover) use a 1.45 line height.
- **Label** (400, 0.8125rem / 14.625px, a 20px line box (`calc(20 / 14.625)`)): tags, plain dates, counts, the summary line and hints. Small headings and form labels (the rail's "Index", the palette title, "Pending changes", the setup screen's Repo and Token) are 700. List names on Today rows are 600. Today's date label is 600 and late labels 700.
- **Numeral** (700, 0.8125rem / 14.625px): the two-digit list index on Today rows, in the Index and in the palette. Only the Today-row index adds +0.02em of letter-spacing; the Index rail and palette numbers have none. List headings set the number at Headline size and weight instead.
- **Key cap** (600, 0.75rem / 13.5px, line height 1): every `kbd`.

The steps are 14.625, 18, 20.25, 29.25 and 45px (0.8125, 1, 1.125, 1.625 and 2.5rem), with key caps at 13.5px (0.75rem). The stylesheet labels this a 1.2 scale, but only the first step is close to 1.2; record and use the actual sizes.

### Named Rules
**The One Hand Rule.** Atkinson Hyperlegible Next is the only face. Hierarchy comes from size and weight (400 body, 500 controls, 600 key caps and list names, 700 numbers and labels, 800 headings), never from a second family, a script or a handwriting face.

**The Tabular Figures Rule.** Every numeral is tabular, set on the body and repeated on form controls, so margin dates, rail counts and two-digit indexes line up in columns.

## Layout

**Desktop (768px and wider).** A sticky 48px band spans the top. Below it sits a two-column grid: a sticky 248px Index rail in rail paper with a hairline right edge (toggled from the band), then the main column, capped at 1080px. The main column holds the Today log (28px top padding), then one section per list (32px top padding, 48px heading row), with 120px of space at the end.

Every row is a five-column grid: the 124px notation gutter, a 36px index column (Today rows only), the title column (fluid), the list name column (Today rows only, sized to content), and a 104px right margin for dates. The index and date columns widen past 36px and 104px only when the reader's larger text needs it. Rows are at least 32px high, the pitch, with a 24px line box and 4px block padding, so a wrapped title adds 24px lines without breaking the rhythm, and larger text makes every row taller. Tags and the inline list name keep the Label's 20px line box, and a line of them that wraps on its own sits 4px under the title, so it adds 24px too. The index, list name and date columns are padded down (8px, 14px on phone: the row's padding plus a 4px drop that grows with the text) so their 14.625px text shares the title's baseline; the signifier and key hints are as tall as the title's first line plus its padding, so the bullet stays centred on that line at any text size. Late rows and due-today rows are separated by 8px.

**Phone (767px and narrower).** The band becomes a 52px app bar plus the top safe area, holding the Index button, the date (once the heading has scrolled off), search, the tag filter and a compact sync word. The gutter narrows to 44px and rows grow to a 44px minimum pitch with 10px block padding. Today rows drop the list name column and set the name inline after the tags. The capture docks to the bottom edge with a 1px ink top rule. The Index opens as a bottom sheet, and every dialog becomes a full-width bottom sheet (up to 86% of the viewport height) with only a top border. Interactive targets are at least 44px. Toasts sit above the dock.

### Named Rules
**The Notation Column Rule.** Text starts at one gutter line, 124px on desktop and 44px on phone, for every row, list heading, capture field and empty-state line, and on the setup screen. The gutter holds only signifiers, key hints and the Done fold's × count at the perforation.

**The One Right Edge Rule.** On desktop every column ends 12px (`edge`) inside the main column's right side; on the phone, columns end 16px from the screen edge. Due dates are right-aligned in the 104px margin column against that edge, and a quiet button pulls its box out by 12px so that its text, not its box, meets the edge.

## Elevation & Depth

The system is flat. Nothing casts a shadow. Overlays are told apart from the page by a 1px fineliner border and, for modal dialogs, a backdrop of ink at 28% opacity. Surfaces are told apart by paper tone (pad, rail paper, pressed paper) and by hairline dividers. Stacking is structural only: the band is sticky above the page, the rail is sticky beside it, the phone capture is docked at the bottom, and the toast floats at the bottom left as a solid ink slip.

### Named Rules
**The Flat Pad Rule.** No surface casts a shadow. Separation comes from a 1px ink edge, a paper tone or the 28% ink backdrop.

## Shapes

Every box is square (radius 0): buttons, fields, key caps, chips, dialogs, sheets, the toast and the band controls. Borders are 1px and come in three strengths: fineliner black for the edges that matter (buttons, fields, the capture field, dialogs, the sync popover), perforation grey for quiet edges (key hints, tag chips, a field at rest, hover outlines), and hairline for dividers. The one dashed line is the perforation above Done.

The highlighter swipe is a parallelogram: squared ends skewed by 2px (3px on the display swipe), clipped rather than rounded, sitting behind the text with 4px of horizontal padding. Curves live only inside drawn marks: the open bullet (a 2.6px-radius dot on a 16px grid), curved icon strokes such as the search lens and the offline arcs, and the round caps and joins of every stroke.

### Named Rules
**The Square Corner Rule.** Every box has square corners. Curves appear only inside drawn marks: the bullet, icon strokes such as the search lens and the offline arcs, and round stroke caps.

## Components

### Signature: the Signifier Row
The log's unit: a notation gutter, then the entry.
- **Gutter:** a 32px signifier cell (40×44 on phone), holding a drawn glyph (16px, 1.6px stroke, round caps): a filled dot for open, × for done, and briefly > for moved or < for rescheduled after the action. Under the glyph is a real native checkbox filling the cell, with its appearance removed. Hovering the cell shows a 1px grey box around it. Done rows fade the glyph and title to Faded Ink and strike the title through at 1px.
- **Key hints:** three 20px square buttons (× > <) with a 1px grey border, 12px glyphs and Graphite ink, 3px apart, 8px right of the signifier. They fade in (160ms) on hover or focus, stay visible on late Today rows, and are hidden on touch devices and phones.
- **Entry:** on Today rows, the list's two-digit index in its ink. Then the title, a note icon if a note exists, tags (14.625px Graphite, `#tag`, bold ink when it is the active filter), the list name in its ink (600), and the date in the right margin. Late dates are bold ink on a pink swipe, today is 600 on a yellow swipe, and other dates are plain 14.625px Graphite ("tomorrow", "Mon 19.10").
- **States:** hover tints the row with rail paper at 70%. Keyboard focus draws a 2px ink outline inset by 2px, lays the blue highlighter behind the title and darkens the key hints to ink. A conflict adds a 20px alarm square with an alert icon before the date.
- **Opened row (Enter):** the title becomes an input with a 1px ink underline (2px when focused). Below it come a Note textarea and the actions Move >, Reschedule <, Tags t, Delete and Close esc, the last two as quiet buttons with Close against the right edge. A hairline closes the block. On phone, × > < stack down the 44px gutter as 40×44 pressed-paper buttons; pressing one fills it with hairline grey and draws a 1px ink outline inset by 1px. Move and Reschedule then drop out of the action row and the key caps are hidden.
- **Phone swipe:** a horizontal drag of 10px or more takes over from scrolling. Dragging right uncovers a strip of Pressed Paper with the × in Fineliner Black, and past 80px marks the row done. Dragging left opens a 104px tray of two 52px pressed-paper buttons, Move > and Later <, each with a 13.5px caption and a grey left rule. The row settles back over 200ms.

### Highlighter Swipe
- **Inline:** a fill behind label-sized text with 4px horizontal padding and a 2px-skewed parallelogram clip, carrying on-hl ink. Variants: today (yellow), late (pink), select (blue).
- **Display:** behind the date heading the fill is a separate layer under the glyphs. In light mode it covers only the lower band of the letters (inset 1.04em from the top of the heading's line box and 0.14em from the bottom, overhanging 6px on each side), so the page ink stays black. In dark mode it starts 0.62em from the top, covering the whole word, and the date switches to on-hl ink.
- **Band variant:** selection on a list (the current Index item, the active palette option, a focused title) is a blue band 70% to 78% of the line height, roughly centred behind the text.

### Buttons
- **Shape:** square (0px), 32px minimum height, 0 12px padding, 8px gap between icon, label and key cap, weight 500.
- **Default:** transparent with a 1px fineliner border and ink text. Hover fills pressed paper, active fills hairline grey, and the fill transitions over 160ms.
- **Primary:** an ink fill with pad text (Reschedule, Save tags). Hover mixes the ink 86% with the pad.
- **Quiet:** a transparent border that shows perforation grey on hover (Cancel, Delete, Close, New list, Clear done, Keep).
- **Disabled:** a transparent fill, a perforation-grey border, Faded Ink text and a not-allowed cursor. A disabled primary (Reschedule before a date parses) drops its ink fill the same way: a transparent box with a Perforation Grey border and Faded Ink text.
- **On ink surfaces** (conflict banner, toast): the border and text take the surface's own colour, and hover adds 14% of that colour.

### Chips
- **Key caps:** every keyboard hint is a `kbd` at least 20px square (growing with the text), with a 1px border in the current text colour, 13.5px at 600, square corners and 4px horizontal padding. Inline hints use 18px caps.
- **Tag suggestions (Tags dialog):** 28px high, 0 8px padding, a 1px grey border and 14.625px Graphite text. Hover turns the border and text to ink. Selected chips are filled with ink and set in pad white.
- **Active tag filter (band):** a pad-white chip with a 1px border in the current text colour, the bold `#tag` and a 30px clear button behind a grey rule.

### Cards / Containers
- **Dialog sheet:** a square pad-white sheet with a 1px fineliner border and no shadow, up to 560px wide and 640px high, placed 12vh from the top over the 28% ink backdrop. Insides use 16px padding and 12px gaps, and titles are 20.25px 800. On phone it becomes a full-width bottom sheet with a top border only.
- **Sync popover:** a fixed 380px pad sheet with a 1px ink border and 16px padding, 4px under the band and 16px from the right, titled "Sync" at 20.25px 800. It lists up to six pending changes (one per file, a deleted list as one line with its to-do count, then "and N more") and ends in a hairline-topped footnote in 14.625px Graphite. Connected, the footnote names the repo (and the branch, unless it is master), when it was last checked, and three quiet buttons: Check now, Replace token and Disconnect. Disconnect asks once more in ink, says in bold how many unsent changes would be lost, and offers an outlined "Disconnect this device" beside a quiet Keep. With demo data, it says nothing leaves the browser and offers an outlined Connect a repo. Its buttons are 14.625px (44px high on phone), and a row that starts with a quiet button pulls it 12px left so its label lines up with the text above.
- **Setup screen:** the first run, and the way back in to connect from the demo or to replace a token. It has no Index rail. The orange band carries only the sync word at the right, in 14.625px 500 ("not connected", or the repo). Below it, on the gutter line and at most 600px wide: a 29.25px 800 heading, a Graphite lede, then the steps as a rapid log of their own, each led by an open bullet in the gutter. A step that sends you to GitHub ends in a 14.625px 500 link, in ink and underlined with a 3px offset like every link (the token link arrives pre-filled with Contents: Read and write). Then a labelled form for Repo and Token (see Inputs / Fields), a Graphite hint that the token stays on this device, a status line (Graphite progress, or the field error), and a primary Connect (Use this token when replacing) with a quiet "Look around with demo data" (or "Back esc"). Replacing a token keeps the repo as a read-only field. On a github.io address an inline alert (the alert icon beside ink text, the host name in bold) explains that the origin's storage is shared with every Pages site on the account and links to do.sebastienguillon.com; the fields and Connect are disabled, and the demo stays available. On phone the steps take 12px block padding, and the links and buttons grow to 44px targets.
- **Toast:** a solid ink slip with pad text, at least 40px high, fixed 16px from the bottom left. It holds an outlined Undo button with a `u` key cap and a 28px dismiss ×; on a narrow screen the message wraps beside them and the buttons keep their size. It follows a delete, a Clear done, a list rename and a list delete.
- **Conflict banner:** a full-width alarm strip under the band, with an alert icon, the file path in bold (as the file is on GitHub), or a sentence naming a list kept or dropped after a delete on another device, and an outlined Dismiss button.

### Inputs / Fields
- **Style:** pad white, a 1px perforation-grey border (Faded Ink on hover), square corners, 36px minimum height, 6px 10px padding, Faded Ink placeholder.
- **Focus:** a 2px ink outline flush with the field, and the border turns ink.
- **Capture:** a 40px field with an ink border, led by a Faded Ink open bullet in the gutter, so a new entry starts as a •. Under it is a hint line of 18px key caps (`#` tag, `>` list, `<` date) and "Enter files it in 01 Inbox" against the right edge, which becomes a live parse preview as you type. On phone it docks to the bottom and the hints are hidden.
- **Large fields:** 44px high, 20.25px text, ink border (`field-large`), in the Reschedule and Tags dialogs and on the setup screen.
- **Labels and hints:** a form label (Repo, Token) sits 4px above its field in 14.625px 700 ink, with 12px above it; the opened row's Note label is quieter, 14.625px Graphite at 400. A hint sits 6px below its field in 14.625px Graphite on a 20px line. Where a dialog title or the surrounding control already names the field, the label is visually hidden.
- **Error / Disabled:** a field at fault shows the focus outline (2px ink, flush with the field) even at rest, and is described by the error line under the fields: the alert icon beside bold ink text that names the problem and the fix. A read-only field drops to a Perforation Grey border with Graphite text; a disabled field takes the same border with Faded Ink text and a not-allowed cursor.
- **Palette search:** a 1px ink box holding the icon, a 20.25px borderless query input and an `esc` cap. When the box has focus it takes a 2px ink outline offset by 1px. Besides search or jump, the palette picks a list to move a to-do to, a tag to show, a list to rename (Rename a list, then a number or a name) and a list to delete (Delete a list, then a number or a name, with nothing preselected and each list's open and done counts), each list led by its number in its ink. Commands also show for a typed word of three or more letters that starts one of theirs. When a delete would take open to-dos it asks once in place: "Delete 03 Home?" in 20.25px 700 ink with the number in its ink, the open count in bold, and an outlined Delete list beside a quiet Keep (44px on phone). Focus goes to the sentence, not a button, so a stray Enter can't delete.

### Navigation
- **Cover band:** orange, 48px, 12px side padding, 8px gaps. From the left: a 36px square Index toggle (1px border in the current text colour on hover; pressed shows a 10% tint of that colour), the search field (up to 420px wide, a tinted pad fill that turns pure pad on hover, a 1px border in the current text colour, Graphite label, ⌘ K caps), Tags with a `#` cap, a spacer, the keyboard-help icon, and the sync state as plain 14.625px 500 text ("saved 14:32"; "offline · 2 kept here" led by the offline icon). The sync state is a borderless button that opens the sync popover and shows a 1px border in the current text colour on hover. On failure the band turns to alarm, the sync text turns bold with an alert icon, and a 28px Retry button appears in 14.625px 700, filled with on-alarm and set in alarm ink, the band's colours reversed (Reconnect when the token is the problem). With demo data the sync text reads "demo data" ("demo" on phone). Focus outlines inside the band use the current text colour.
- **Index rail:** "Index" in 14.625px 700 Graphite, then Today (a calendar icon, the name in bold, the late count on a pink swipe, the due count), then every list as a 28px number column in its ink, the name (truncated with an ellipsis) and a 14.625px Graphite open count. Items are 32px high (44px on phone) with a transparent 1px border that turns grey on hover. The list currently at the top of the page is marked with the blue band. Below sit a quiet "New list" button and a "g + number" hint.
- **List heading:** the 29.25px 800 number in the list's ink, then the name, an "N open" count, and `g` `NN` jump caps in Faded Ink at the right edge (hidden on phone). The name is also how a list is renamed: it shows a text cursor like a row title, and a click or tap (or `r`, or Rename a list in the palette) turns it into a field at heading size with the opened row's underline, 1px ink and 2px with focus, in the same box so nothing moves. The field runs across the heading up to the count, with the name selected. Enter or leaving the field saves, Esc cancels, and an empty or unchanged name is ignored. A rename shows the undo toast. While the name is a field, a quiet 14.625px Delete with the trash icon stands in for the jump caps at the right edge (for the count on phone, 44px high); it deletes the list, asking first if open to-dos would go, and leaves a half-typed name unsaved.
- **Perforation and Done fold:** 8px under the last open row, a 1px dashed perforation-grey rule spans the section. On it sits the fold: a 14px ×, "N done" and a chevron that rotates 180° over 160ms when open, in 14.625px Graphite (ink on hover). A 28px quiet "Clear done" button appears when the fold is open, and the done rows follow below.

### App Icon
The favicon and the home-screen icon are one drawing, `public/favicon.svg`: a full-bleed orange square, square-cornered (the phone rounds or crops it), holding a black open bullet and a > stroked with round caps and joins. The mark sits well inside the centre 80% circle, so one image serves as both the plain and the maskable icon. The 192px, 512px and 180px Apple touch PNGs are drawn from the SVG by `pnpm run icons` (`scripts/icons.sh`, Inkscape). Installed, the app opens standalone on a pad-white splash.

### Motion
State changes fade or slide on one curve, `cubic-bezier(0.16, 1, 0.3, 1)`: 160ms for opacity and fills, 200ms for the band's colour change and a swiped row settling back. The one authored motion is the pen stroke. Reduced motion collapses every transition and removes the stroke animation.

### Named Rules
**The Real Checkbox Rule.** Every signifier is drawn over a real native checkbox that fills its cell, so a click, Space and `x` all do the same thing and assistive technology announces a checkbox.

**The Three Verbs Rule.** A row's gutter and swipe offer exactly three verbs, × done, > move and < reschedule, in that order wherever they appear: the gutter hints, the phone's opened-row stack and the phone swipe (right for ×, left for > and <). Tags and the to-do's Delete live in the opened row and on their keys (t, Delete).

**The Pen Stroke Rule.** The one authored motion: when a signifier changes on screen, it is drawn in like a pen stroke over 220ms. Marks present at load stay still.

## Do's and Don'ts

### Do:
- **Do** head the log with today's date at display size on the yellow display swipe, which crosses the lower band of the letters in light mode and covers the whole word, under black ink, in dark mode.
- **Do** keep every row at least the row pitch (32px desktop, 44px phone) with a 24px line box, and let long titles wrap rather than truncate.
- **Do** name a list by its two-digit index in its ink at 700 (800 in list headings), followed by its name, everywhere it appears: the Index, list headings, Today rows, the palette and the move picker.
- **Do** show the × > < key hints at all times on late Today rows, on hover or focus elsewhere, and never on touch devices.
- **Do** end every list's open rows with the dashed perforation (1px dashed `rule`) and fold Done beneath it.
- **Do** keep sync state as plain text at the right end of the band ("saved 14:32"), and turn the whole band to ink when sync fails.
- **Do** mark keyboard focus with a 2px ink outline; on a row, also lay the blue highlighter behind the title.
- **Do** draw icons on a 16px grid with the fineliner stroke (1.6px, round caps and joins), rendered at 14, 16 or 18px, in the current text colour.
- **Do** turn dialogs into full-width bottom sheets on phones, with a top border only, and give every phone target at least 44px.

### Don't:
- **Don't** draw a round or boxed checkbox at rest; the only box is the 1px Perforation Grey outline of the cell on hover.
- **Don't** identify lists with anonymous coloured dots or by colour alone.
- **Don't** add swipe actions or gutter verbs beyond ×, > and <; Tags and the to-do's Delete live in the opened row and on their keys. A list is deleted from its heading, `Shift D` or the palette, never from a row.
- **Don't** set text in a highlighter colour, or put light ink on a highlighter.
- **Don't** use orange anywhere inside the pad.
- **Don't** add shadows or rounded corners.
- **Don't** add washi tape, stickers, hand lettering or handwriting faces.
- **Don't** draw a dot grid, in the gutter or anywhere else. One was built and removed on 2026-10-17 because it carried no meaning.
