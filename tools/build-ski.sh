#!/usr/bin/env bash
# Builds data/ski.pmtiles: OpenSkiMap's daily extracts → slim line-delimited GeoJSON → vector tiles.
# Needs curl, python3 and tippecanoe (apt install tippecanoe). Takes a couple of minutes.
set -euo pipefail
work="${1:-/tmp/ski}"; out="${2:-data/ski.pmtiles}"
mkdir -p "$work" "$(dirname "$out")"
for f in runs lifts ski_areas; do curl -fsSL --compressed --retry 3 -o "$work/$f.geojson" "https://tiles.openskimap.org/geojson/$f.geojson"; done
python3 "$(dirname "$0")/build-ski.py" "$work" "$work/slim"
# Zoom 13 is the most detailed (about a metre; the map scales it up beyond). Runs and lifts from zoom 9, ski areas from 7, ski-area names from 5 (cross-country only from 8).
tippecanoe -q -f -o "$out" -Z5 -z13 -P -r1 --no-feature-limit --no-tile-size-limit \
  -n "Wayfinder ski" -A "© OpenStreetMap contributors, OpenSkiMap.org" \
  -j '{ "runs": [">=", "$zoom", 9], "lifts": [">=", "$zoom", 9], "areas": [">=", "$zoom", 7], "labels": ["any", ["==", "a", "downhill"], [">=", "$zoom", 8]] }' \
  -L runs:"$work/slim/runs.ndjson" -L lifts:"$work/slim/lifts.ndjson" -L areas:"$work/slim/areas.ndjson" -L labels:"$work/slim/labels.ndjson"
ls -la "$out"
