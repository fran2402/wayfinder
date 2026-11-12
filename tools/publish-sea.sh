#!/usr/bin/env bash
# Puts a built data/sea.pmtiles on the sea-data branch, in parts under GitHub's 100 MB file limit;
# the publish workflow joins them again. (QLever, the source, doesn't answer GitHub's runners, so the
# sea marks are fetched and built on another machine: tools/build-sea.mjs qlever + tools/build-sea.sh.)
#   tools/publish-sea.sh [data/sea.pmtiles]
set -euo pipefail
src="$(realpath "${1:-data/sea.pmtiles}")"; repo="$(git rev-parse --show-toplevel)"; tmp="$(mktemp -d)"
git -C "$repo" worktree add --detach "$tmp" >/dev/null
cd "$tmp"
git checkout -q --orphan sea-data-new
git rm -rqf . >/dev/null 2>&1 || true
split -b 60M -d -a 2 "$src" sea.pmtiles.part
printf 'The world sea marks for Wayfinder (data/sea.pmtiles), in parts: cat sea.pmtiles.part* > sea.pmtiles\nBuilt %s from OpenStreetMap (© OpenStreetMap contributors, ODbL) via QLever.\n' "$(date -u +%Y-%m-%d)" > README.md
git add -A
git commit -qm "Sea marks $(date -u +%Y-%m-%d)"
git push -qf origin HEAD:sea-data
cd "$repo"; git worktree remove --force "$tmp"; git branch -D sea-data-new >/dev/null 2>&1 || true
echo "sea-data updated"
