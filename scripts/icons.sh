#!/bin/sh
# Draws the home-screen icons from public/favicon.svg, so every icon is the same
# orange square with a black bullet and a > mark. The mark stays inside the
# maskable safe zone (the centre 80% circle), so one file serves "any" and
# "maskable". Needs Inkscape 1.x (made with 1.4.3). Run from the repo root:
#   pnpm run icons
set -eu

draw() {
  inkscape public/favicon.svg --export-type=png --export-width="$1" --export-height="$1" --export-filename="public/$2"
}

draw 192 icon-192.png
draw 512 icon-512.png
draw 180 apple-touch-icon.png
