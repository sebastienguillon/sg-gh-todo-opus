// Synthetic demonstration data, seeded only on a device that chose to look
// around before connecting a repo (or opened with `?demo`). None of it is
// real. It exists so the screen can be judged at its real volume (17 lists,
// ~200 to-dos); a connected device never sees it.
//
// Each entry: `[x ]title [#tag…] [@offset]`. A leading `x ` marks it done;
// `@-2` means due two days ago, `@0` today, `@4` in four days.

import { addDays } from './dates'
import { slugify } from './repo'
import type { DayISO, Todo, TodoList } from './types'

const SEED: [name: string, entries: string[]][] = [
  ['Inbox', [
    'Look into a standing desk converter',
    'Sort photos from the weekend #photos',
    'Find the warranty for the dishwasher',
    'Back up the old laptop before selling it @2',
    'Ask facilities about the bike rack at work',
    'Return the borrowed drill to Sam @5',
    'Unsubscribe from the newsletters I never read',
    'Try the ramen place Léa mentioned',
    'Write down the wifi password for guests',
    'x Order more printer paper',
  ]],
  ['Home', [
    'Reply to landlord about boiler service #calls @-2',
    'Fix dripping kitchen tap #diy',
    'Order replacement filter for the cooker hood @4',
    'Paint hallway skirting boards #diy #weekend',
    'Clean gutters before November @15',
    'Replace the bathroom extractor fan bulb #diy',
    'Book the chimney sweep #calls @10',
    'Descale the kettle',
    'Hang the framed print in the study #diy',
    'Bleed the radiators before winter @7',
    'Get a quote for resealing the shower #calls',
    'Donate the old winter coats',
    'Repot the fiddle-leaf fig',
    'Fix the wobbly chair leg #diy',
    'Test the smoke alarms',
    'Sort out the cupboard under the stairs #weekend',
    'Buy a draught excluder for the front door',
    'Measure the bedroom window for blinds',
    'Re-grout the kitchen backsplash #diy #weekend',
    'x Change the hallway light bulb',
    'x Empty the dehumidifier',
    'x Call the plumber about the leak',
    'x Wash the duvet covers',
    'x Take the recycling to the depot',
  ]],
  ['Errands', [
    'Return library books @-1',
    'Collect dry cleaning @1',
    'Post the parcel to Mum @2',
    'Drop off old batteries for recycling',
    'Get keys cut for the cleaner',
    'Pick up the repaired watch @6',
    'Renew the parking permit #paperwork @12',
    'Buy stamps',
    'x Return the faulty charger',
  ]],
  ['Groceries', [
    'Buy coffee beans @0',
    'Oat milk',
    'Lemons',
    'Sourdough loaf',
    'Parmesan',
    'Chickpeas, four tins',
    'Washing-up liquid',
    'Bin bags',
    'Frozen peas',
    'Greek yoghurt',
    'Chilli flakes',
    'Rice noodles',
    'Apples',
    'Olive oil',
    'x Eggs',
    'x Butter',
  ]],
  ['Work', [
    'Write up the incident timeline #writing @1',
    'Review Priya’s design doc #review @2',
    'Renew the expiring staging certificate #ops @3',
    'Expense the conference train tickets #admin @4',
    'Prepare slides for the planning meeting #meetings @5',
    'Answer the vendor security questionnaire #admin @8',
    'Draft the Q1 hiring plan #planning @20',
    'Book a 1:1 with Jonas #meetings',
    'Update the onboarding checklist #writing',
    'Clean up stale feature flags #code',
    'Pair with Noor on the flaky tests #code',
    'Send feedback on the API naming RFC #review',
    'Archive old team channels',
    'Order a new laptop charger #admin',
    'Write the postmortem for the queue outage #writing',
    'Rotate the shared deploy key #ops',
    'x Submit the timesheet',
    'x Merge the logging cleanup',
  ]],
  ['Side project', [
    'Review PR for the parser rewrite #code @0',
    'Triage the open issues #issues @1',
    'Publish v0.4 release notes #writing @3',
    'Write tests for the tokenizer edge cases #code',
    'Reply to the issue about Windows paths #issues',
    'Set up CI caching for pnpm #ci',
    'Sketch the plugin API #design',
    'Fix the README badge links',
    'Benchmark the new parser against v0.3 #code',
    'x Rename the default branch to main',
    'x Add a CONTRIBUTING file',
  ]],
  ['Admin & taxes', [
    'Renew passport photo appointment #paperwork @-3',
    'Pay electricity bill #money @0',
    'Cancel the unused gym membership #money @6',
    'File the home-office expenses #money @9',
    'Update the address on the bank account #paperwork',
    'Check the council tax band #money',
    'Scan and archive this year’s payslips #paperwork',
    'x Submit the insurance claim form',
  ]],
  ['Health', [
    'Call dentist to move appointment #calls @0',
    'Pick up the repeat prescription @2',
    'Book a physio follow-up #calls @11',
    'Book an eye test',
    'Order more contact lenses',
    'x Get the flu jab',
  ]],
  ['Travel: Lisbon', [
    'Book train to Lisbon #booking @0',
    'Reserve the apartment in Alfama #booking @2',
    'Check passport expiry date #paperwork',
    'Buy a travel adapter',
    'Download offline maps',
    'List the restaurants Ana recommended',
    'Ask Ana about tram passes',
    'Pack the rain jacket',
    'x Request the days off',
  ]],
  ['Reading', [
    'Pick up Piranesi from the library @5',
    'Finish chapter 7 of The Pragmatic Programmer',
    'Read the Postgres release notes #tech',
    'Read the zine on how DNS works #tech',
    'Start The Left Hand of Darkness',
    'Return the borrowed copy of Middlemarch',
    'Read the long piece on urban trees',
    'x Finish Station Eleven',
  ]],
  ['Bike', [
    'Replace the rear brake pads @3',
    'Pump up the tyres',
    'Oil the chain',
    'Fix the rattling mudguard',
    'Buy a new rear light',
  ]],
  ['Garden', [
    'Plant the tulip bulbs #weekend @8',
    'Rake the leaves #weekend',
    'Cut back the lavender',
    'Clean the patio furniture before storing it',
    'Order compost',
    'Wrap the olive tree against frost @30',
    'x Harvest the last tomatoes',
  ]],
  ['Gifts', [
    'Birthday present for Theo @9',
    'Ideas for Mum’s 60th',
    'Set the Secret Santa budget at work',
    'Thank-you card for the neighbours',
  ]],
  ['Car', [
    'Renew the car insurance #money @14',
    'Book the annual service @21',
    'Top up the screenwash',
    'Check the tyre pressure',
  ]],
  ['Learning Rust', [
    'Finish the traits chapter of the Rust book #code',
    'Do the lifetimes exercises #code',
    'Rewrite the to-do exporter in Rust #code',
    'Watch the talk on async runtimes #tech',
    'Read about error handling with thiserror #code',
    'x Install rustup on the new laptop',
  ]],
  ['Music', [
    'Restring the acoustic guitar',
    'Learn the bridge of the song from Saturday',
    'Practise scales for fifteen minutes',
    'Look into a cheap audio interface',
    'Record a rough demo of the new riff',
  ]],
  ['Someday', [
    'Learn to make fresh pasta',
    'Visit the Faroe Islands',
    'Build a mechanical keyboard',
    'Write a post about the git-backed to-do app',
    'Run a half marathon',
    'Take a pottery class',
    'Set up a home NAS',
    'Learn the basics of sign language',
    'Make a family photo book',
    'Try bouldering',
    'Plant a herb wall',
    'Learn to sail',
    'Brew kombucha',
    'Rebuild the website in plain HTML',
    'Learn some Japanese',
    'Do a screen-free weekend',
    'Fix up the old film camera',
    'Volunteer at the repair café',
    'Walk a long-distance trail',
    'Learn to bake bread properly',
  ]],
]

const NOTES: Record<string, string> = {
  'Renew passport photo appointment': 'Booth at the post office takes cards now. Bring the old passport.',
  'Reply to landlord about boiler service': 'They proposed Tue or Thu morning. Thu works better.',
  'Review PR for the parser rewrite': 'Focus on the error recovery path and the benchmark numbers.',
}

export function demoData(today: DayISO, now = new Date()): { lists: TodoList[]; todos: Todo[] } {
  const stamp = now.toISOString()
  const lists: TodoList[] = []
  const todos: Todo[] = []
  SEED.forEach(([name, entries], i) => {
    const list: TodoList = { id: `l${i + 1}`, slug: slugify(name), index: i + 1, name, ink: (i % 12) + 1 }
    lists.push(list)
    entries.forEach((raw, j) => {
      let text = raw
      const done = text.startsWith('x ')
      if (done) text = text.slice(2)
      const dueMatch = text.match(/\s@(-?\d+)$/)
      const due = dueMatch ? addDays(today, Number(dueMatch[1])) : null
      if (dueMatch) text = text.slice(0, dueMatch.index)
      const tags = [...text.matchAll(/\s#([\p{L}\p{M}\p{N}_-]+)/gu)].map((m) => m[1])
      const title = text.replace(/\s#[\p{L}\p{M}\p{N}_-]+/gu, '').trim()
      todos.push({
        id: `${list.id}-t${j + 1}`,
        listId: list.id,
        title,
        note: NOTES[title] ?? '',
        tags,
        due,
        done,
        doneAt: done ? new Date(now.getTime() - (j + 1) * 3_600_000).toISOString() : null,
        order: j + 1,
        createdAt: stamp,
        updatedAt: stamp,
      })
    })
  })
  return { lists, todos }
}
