#!/usr/bin/env bash
# Builds data/sea.pmtiles from the saved sea-mark cells (tools/build-sea.mjs crawl fetches them).
#   tools/build-sea.sh <cells dir> <out.pmtiles>            — from saved cells
#   tools/build-sea.sh --files <out.pmtiles> a.json …       — from saved Overpass answers (testing)
# Needs node and tippecanoe (apt install tippecanoe).
set -euo pipefail
work="$(mktemp -d)"
if [ "$1" = "--files" ]; then out="$2"; shift 2; node "$(dirname "$0")/build-sea.mjs" files "$work" "$@"
else node "$(dirname "$0")/build-sea.mjs" join "$1" "$work"; out="$2"; fi
mkdir -p "$(dirname "$out")"
# Lines and areas from zoom 9; the important marks (lights, cardinals, lateral buoys…) from 8, the rest from 12.
tippecanoe -q -f -o "$work/sea.pmtiles" -Z8 -z13 -P -r1 --no-feature-limit --no-tile-size-limit \
  -n "Wayfinder sea marks" -A "© OpenStreetMap contributors" \
  -j '{ "lines": [">=", "$zoom", 9], "marks": ["any", ["<=", "tier", 2], [">=", "$zoom", 12]] }' \
  -L marks:"$work/marks.ndjson" -L lines:"$work/lines.ndjson"
mv "$work/sea.pmtiles" "$out"
ls -la "$out"
