#!/usr/bin/env bash
# Builds data/sea.pmtiles: the world's sea marks from OpenStreetMap (Overpass) → vector tiles.
# Needs node and tippecanoe (apt install tippecanoe). Takes a while: the whole world, area by area.
set -euo pipefail
work="${1:-/tmp/sea}"; out="${2:-data/sea.pmtiles}"; shift 2 || true
mkdir -p "$work" "$(dirname "$out")"
node "$(dirname "$0")/build-sea.mjs" "$work" "$@"
# Lines and areas from zoom 9; the important marks (lights, cardinals, lateral buoys…) from 8, the rest from 12.
tippecanoe -q -f -o "$work/sea.pmtiles" -Z8 -z14 -P -r1 --no-feature-limit --no-tile-size-limit \
  -n "Wayfinder sea marks" -A "© OpenStreetMap contributors" \
  -j '{ "lines": [">=", "$zoom", 9], "marks": ["any", ["<=", "tier", 2], [">=", "$zoom", 12]] }' \
  -L marks:"$work/marks.ndjson" -L lines:"$work/lines.ndjson"
mv "$work/sea.pmtiles" "$out"
ls -la "$out"
