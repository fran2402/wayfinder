#!/usr/bin/env node
// The world's sea marks from OpenStreetMap (Overpass), read with the map's own code (js/seamarks-core.js),
// as line-delimited GeoJSON for tippecanoe: <out>/marks.ndjson (points) and <out>/lines.ndjson.
//
//   node tools/build-sea.mjs <out dir>                  — fetch the whole world, area by area
//   node tools/build-sea.mjs <out dir> a.json b.json    — or read saved Overpass answers (for testing)
//
// Areas start at 45° × 40°; an area that is too big or too slow is split in four, down to about 3°.
// Several Overpass servers are tried in turn. Data © OpenStreetMap contributors (ODbL).

import fs from "node:fs";
import path from "node:path";
import { featuresOf } from "../js/seamarks-core.js";

const [out, ...files] = process.argv.slice(2);
if (!out) { console.error("usage: build-sea.mjs <out dir> [overpass.json …]"); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const marks = fs.createWriteStream(path.join(out, "marks.ndjson")), lines = fs.createWriteStream(path.join(out, "lines.ndjson"));
const seen = new Set();
let nMarks = 0, nLines = 0;

function write(elements) {
  const fresh = elements.filter(e => { const k = e.type + e.id; if (seen.has(k)) return false; seen.add(k); return true; });
  for (const f of featuresOf(fresh)) {
    const g = { type: "Feature", geometry: f.geometry, properties: f.properties };
    if (f.geometry.type === "Point") { marks.write(JSON.stringify(g) + "\n"); nMarks++; } else { lines.write(JSON.stringify(g) + "\n"); nLines++; }
  }
}

const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const query = ([s, w, n, e]) => {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:400][maxsize:1500000000];(node["seamark:type"]${bb};node["man_made"="lighthouse"]${bb};node["blue_flag"="yes"]${bb};)->.n;`
    + `(way["seamark:type"]${bb};way["man_made"="lighthouse"]${bb};way["blue_flag"="yes"]${bb};)->.w;relation["seamark:type"]${bb}->.r;.n out qt;.w out geom qt;.r out center tags qt;`;
};
class TooBig extends Error {}

/** One area from the first server that answers; TooBig when it has to be split. */
async function fetchArea(bbox) {
  let lastErr;
  for (let i = 0; i < SERVERS.length; i++) {
    const url = SERVERS[i];
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query(bbox)), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Wayfinder sea-mark build (weekly)" }, signal: AbortSignal.timeout(450000) });
      if (res.status === 429 || res.status === 503 || res.status === 504) { lastErr = new Error(`${url} ${res.status}`); await sleep(20000); continue; }
      if (!res.ok) { lastErr = new Error(`${url} ${res.status}`); continue; }
      const data = JSON.parse(await res.text());
      if (data.remark && /runtime error|timed out|out of memory|maxsize/i.test(data.remark)) throw new TooBig(data.remark);
      return data.elements || [];
    } catch (e) {
      if (e instanceof TooBig) throw e;
      lastErr = e;
      if (e.name === "TimeoutError") throw new TooBig("timed out");
    }
  }
  throw lastErr || new Error("no server answered");
}

async function crawl(bbox, depth = 0) {
  const label = bbox.map(v => v.toFixed(1)).join(",");
  try {
    const t0 = Date.now(), els = await fetchArea(bbox);
    write(els);
    console.log(`${"  ".repeat(depth)}${label}: ${els.length} elements, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await sleep(2000);
  } catch (e) {
    if (depth >= 4) { console.log(`${"  ".repeat(depth)}${label}: FAILED (${e.message})`); failed++; return; }
    console.log(`${"  ".repeat(depth)}${label}: splitting (${e.message})`);
    const [s, w, n, ee] = bbox, ms = (s + n) / 2, mw = (w + ee) / 2;
    for (const b of [[s, w, ms, mw], [s, mw, ms, ee], [ms, w, n, mw], [ms, mw, n, ee]]) await crawl(b, depth + 1);
  }
}

let failed = 0;
if (files.length) {
  for (const f of files) write(JSON.parse(fs.readFileSync(f, "utf8")).elements || []);
} else {
  for (let s = -80; s < 85; s += 40) for (let w = -180; w < 180; w += 45) await crawl([s, w, Math.min(s + 40, 85), w + 45]);
}
await Promise.all([new Promise(r => marks.end(r)), new Promise(r => lines.end(r))]);
console.log(`sea marks: ${nMarks} points, ${nLines} lines and areas, ${failed} areas failed`);
if (!files.length && (failed > 8 || nMarks < 100000)) { console.error("too little sea data: keeping the previous file"); process.exit(1); }
