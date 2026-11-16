#!/usr/bin/env bash
# Renders the PNG icons from the generated SVGs (needs rsvg-convert). Run after build.py.
# public/og-image.jpg (1200×630) is a real farm screenshot with a dark scrim and
# public/brand/agrarian-stacked-dark.svg on top; re-shoot it when the world's look changes.
set -euo pipefail
cd "$(dirname "$0")/../.."
body=$(sed -E 's#<svg[^>]*>##; s#</svg>##; s#<title>[^<]*</title>##' public/brand/agrarian-mark-light.svg)
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180"><rect width="180" height="180" fill="#fcf6e8"/><g transform="translate(36 34) scale(1.6875)">%s</g></svg>' "$body" > /tmp/agrarian-touch.svg
rsvg-convert /tmp/agrarian-touch.svg -o public/apple-touch-icon.png
echo "wrote public/apple-touch-icon.png"
