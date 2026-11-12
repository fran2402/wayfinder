#!/usr/bin/env node
// The world's sea marks from OpenStreetMap (Overpass), read with the map's own code (js/seamarks-core.js).
//
//   node tools/build-sea.mjs crawl <cells dir> [minutes]   — fetch areas, oldest first, for at most [minutes]
//   node tools/build-sea.mjs join <cells dir> <out dir>     — all saved areas → <out>/marks.ndjson, lines.ndjson
//   node tools/build-sea.mjs files <out dir> a.json …       — saved Overpass answers instead (for testing)
//
// The world is cut into 10° cells. Each finished cell is saved (<cells>/<lat>_<lon>.json), so a run
// that runs out of time or meets busy servers keeps what it got, and the next run carries on with the
// cells that are missing or oldest. A cell that is genuinely too big for one request is split in four
// (and its parts saved together); a busy server just means trying the next one, or the cell next time.
// Data © OpenStreetMap contributors (ODbL).

import fs from "node:fs";
import path from "node:path";
import { featuresOf } from "../js/seamarks-core.js";

const [mode, ...args] = process.argv.slice(2);
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STEP = 10;

const query = ([s, w, n, e]) => {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:300][maxsize:1000000000];(node["seamark:type"]${bb};node["man_made"="lighthouse"]${bb};node["blue_flag"="yes"]${bb};)->.n;`
    + `(way["seamark:type"]${bb};way["man_made"="lighthouse"]${bb};way["blue_flag"="yes"]${bb};)->.w;relation["seamark:type"]${bb}->.r;.n out qt;.w out geom qt;.r out center tags qt;`;
};
class TooBig extends Error {}
class Busy extends Error {}

let server = 0;
/** One area; TooBig when it must be split, Busy when no server would answer now. */
async function fetchArea(bbox) {
  let last = "";
  for (let i = 0; i < SERVERS.length * 2; i++) {
    const url = SERVERS[(server + i) % SERVERS.length];
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query(bbox)),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Wayfinder sea-mark build (github.com/fran2402/wayfinder)" }, signal: AbortSignal.timeout(330000) });
      if (!res.ok) { last = `${new URL(url).host} ${res.status}`; await sleep(res.status === 429 ? 30000 : 8000); continue; }
      const text = await res.text();
      const data = JSON.parse(text);
      if (data.remark && /timed out|out of memory|maxsize|runtime limit/i.test(data.remark)) throw new TooBig(data.remark.slice(0, 80));
      if (data.remark && /runtime error/i.test(data.remark)) { last = data.remark.slice(0, 80); continue; }
      server = (server + i) % SERVERS.length; // stay with the one that answers
      return data.elements || [];
    } catch (e) {
      if (e instanceof TooBig) throw e;
      if (e.name === "TimeoutError") throw new TooBig("took too long");
      last = `${new URL(url).host} ${e.message}`;
      await sleep(5000);
    }
  }
  throw new Busy(last);
}

/** A cell (or part of one), split when too big; the elements of all its parts. */
async function crawlBox(bbox, depth = 0) {
  try { return await fetchArea(bbox); }
  catch (e) {
    if (!(e instanceof TooBig) || depth >= 3) throw e;
    console.log(`${"  ".repeat(depth + 1)}split ${bbox.join(",")} (${e.message})`);
    const [s, w, n, ee] = bbox, ms = (s + n) / 2, mw = (w + ee) / 2, out = [];
    for (const b of [[s, w, ms, mw], [s, mw, ms, ee], [ms, w, n, mw], [ms, mw, n, ee]]) out.push(...await crawlBox(b, depth + 1));
    return out;
  }
}

if (mode === "crawl") {
  const [dir, minutes = "150"] = args, until = Date.now() + +minutes * 60000;
  fs.mkdirSync(dir, { recursive: true });
  const cells = [];
  for (let s = -80; s < 85; s += STEP) for (let w = -180; w < 180; w += STEP) {
    const f = path.join(dir, `${s}_${w}.json`);
    cells.push({ bbox: [s, w, Math.min(s + STEP, 85), w + STEP], f, at: fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0 });
  }
  cells.sort((a, b) => a.at - b.at); // missing first, then oldest
  let ok = 0, busy = 0;
  for (const c of cells) {
    if (Date.now() > until) break;
    const t0 = Date.now();
    try {
      const els = await crawlBox(c.bbox);
      fs.writeFileSync(c.f, JSON.stringify(els));
      ok++;
      console.log(`${c.bbox.join(",")}: ${els.length} elements, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      await sleep(1500);
    } catch (e) {
      busy++;
      console.log(`${c.bbox.join(",")}: not now (${e.message})`);
      if (busy > 25 && !ok) break; // every server down: try another day
    }
  }
  const have = cells.filter(c => fs.existsSync(c.f)).length;
  console.log(`this run: ${ok} cells fetched, ${busy} skipped; ${have} of ${cells.length} cells saved in all`);
} else if (mode === "join" || mode === "files") {
  const [a, b, ...files] = args, out = mode === "join" ? b : a;
  const inputs = mode === "join" ? fs.readdirSync(a).filter(f => f.endsWith(".json")).map(f => path.join(a, f)) : [b, ...files].filter(Boolean);
  fs.mkdirSync(out, { recursive: true });
  const marks = fs.createWriteStream(path.join(out, "marks.ndjson")), lines = fs.createWriteStream(path.join(out, "lines.ndjson"));
  const seen = new Set();
  let nm = 0, nl = 0;
  for (const f of inputs) {
    const j = JSON.parse(fs.readFileSync(f, "utf8")), els = (Array.isArray(j) ? j : j.elements || []).filter(e => { const k = e.type + e.id; if (seen.has(k)) return false; seen.add(k); return true; });
    for (const ft of featuresOf(els)) {
      const g = JSON.stringify({ type: "Feature", geometry: ft.geometry, properties: ft.properties }) + "\n";
      if (ft.geometry.type === "Point") { marks.write(g); nm++; } else { lines.write(g); nl++; }
    }
  }
  await Promise.all([new Promise(r => marks.end(r)), new Promise(r => lines.end(r))]);
  console.log(`sea marks: ${nm} points, ${nl} lines and areas from ${inputs.length} files`);
} else {
  console.error("usage: build-sea.mjs crawl <cells dir> [minutes] | join <cells dir> <out dir> | files <out dir> a.json …");
  process.exit(2);
}
