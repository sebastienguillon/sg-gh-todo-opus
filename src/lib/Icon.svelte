<script lang="ts" module>
  // One stroke family at fineliner weight, drawn on a 16px grid.
  const PATHS = {
    index: 'M2.5 3.5h11v9h-11z M6 3.5v9',
    search: 'M7 11.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5z M10.2 10.2l3.3 3.3',
    hash: 'M6.25 2.5l-1.5 11 M11.25 2.5l-1.5 11 M2.75 6h11 M2.25 10h11',
    chevron: 'M4.5 6.25 8 9.75l3.5-3.5',
    plus: 'M8 3v10 M3 8h10',
    close: 'M4.25 4.25l7.5 7.5 M11.75 4.25l-7.5 7.5',
    note: 'M4 2.5h5.5L12 5v8.5H4z M6 7.5h4 M6 10h4',
    calendar: 'M2.75 4h10.5v9.25H2.75z M2.75 7h10.5 M5.75 2.5v3 M10.25 2.5v3',
    list: 'M2.75 4.5h10.5 M2.75 8h10.5 M2.75 11.5h10.5',
    check: 'M3.25 8.5l3 3 6.5-7',
    alert: 'M8 2.75l5.75 10.5H2.25z M8 6.75v3 M8 11.75v.01',
    keyboard: 'M1.75 4.25h12.5v7.5H1.75z M4.25 6.75h.01 M6.75 6.75h.01 M9.25 6.75h.01 M11.75 6.75h.01 M5 9.25h6',
    trash: 'M2.75 4.5h10.5 M6 4.5V2.75h4V4.5 M4.25 4.5l.75 9h6l.75-9',
    offline: 'M2.5 2.5l11 11 M5.4 6.2A4.5 4.5 0 0 0 4 9.5 M8 5a4.5 4.5 0 0 1 4.3 3.2 M8 12.5h.01',
  } as const

  export type IconName = keyof typeof PATHS
</script>

<script lang="ts">
  let { name, size = 16, label }: { name: IconName; size?: number; label?: string } = $props()
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path d={PATHS[name]} />
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
