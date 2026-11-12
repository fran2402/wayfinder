#!/usr/bin/env node
// The world's sea marks from OpenStreetMap (Overpass), read with the map's own code (js/seamarks-core.js).
//
//   node tools/build-sea.mjs qlever <cells dir>              — the whole world from QLever, in two queries (used)
//   node tools/build-sea.mjs crawl <cells dir> [minutes]   — fetch areas from Overpass, oldest first (fallback)
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
const QLEVER = "https://qlever.dev/api/osm-planet";
const QPRE = "PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>\nPREFIX geo: <http://www.opengis.net/ont/geosparql#>\n";
const QSEL = `{ ?o osmkey:seamark:type ?t } UNION { ?o osmkey:man_made "lighthouse" } UNION { ?o osmkey:blue_flag "yes" }`;

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
} else if (mode === "qlever") {
  // The whole world in two queries to QLever's OpenStreetMap planet endpoint (University of Freiburg):
  // every sea mark's shape, and its tags. Written as one file of Overpass-style elements for "join".
  const [dir, gFile, tFile] = args;
  fs.mkdirSync(dir, { recursive: true });
  const fetchTsv = async (q, file) => {
    if (file) return fs.readFileSync(file, "utf8");
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(QLEVER, { method: "POST", body: new URLSearchParams({ query: q }), headers: { Accept: "text/tab-separated-values", "User-Agent": "Wayfinder sea-mark build" }, signal: AbortSignal.timeout(900000) });
        if (res.ok) return await res.text();
        console.log(`QLever ${res.status}, again in a minute`);
      } catch (e) { console.log(`QLever: ${e.message}, again in a minute`); }
      await sleep(60000);
    }
    throw new Error("QLever didn't answer");
  };
  const t0 = Date.now();
  const geomTsv = await fetchTsv(`${QPRE}SELECT DISTINCT ?o ?wkt WHERE { ${QSEL} ?o geo:hasGeometry/geo:asWKT ?wkt }`, gFile);
  console.log(`shapes: ${(geomTsv.length / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const t1 = Date.now();
  const tagTsv = await fetchTsv(`${QPRE}SELECT DISTINCT ?o ?k ?v WHERE { ${QSEL} ?o ?k ?v . FILTER(STRSTARTS(STR(?k), "https://www.openstreetmap.org/wiki/Key:seamark") || ?k IN (osmkey:name, osmkey:name:en, osmkey:man_made, osmkey:blue_flag, osmkey:leisure)) }`, tFile);
  console.log(`tags: ${(tagTsv.length / 1e6).toFixed(0)} MB in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  const els = new Map();
  const el = iri => {
    let e = els.get(iri);
    if (!e) { const m = /openstreetmap\.org\/(node|way|relation)\/(\d+)/.exec(iri); if (!m) return null; e = { type: m[1], id: +m[2], tags: {} }; els.set(iri, e); }
    return e;
  };
  const lit = v => { const m = /^"((?:[^"\\]|\\.)*)"/.exec(v); return m ? m[1].replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t", r: "" }[c] ?? c)) : v.replace(/^<|>$/g, ""); };
  for (const line of tagTsv.split("\n").slice(1)) {
    const [o, k, v] = line.split("\t");
    if (!v) continue;
    const e = el(o); if (!e) continue;
    e.tags[k.replace(/^<https:\/\/www\.openstreetmap\.org\/wiki\/Key:|>$/g, "")] = lit(v);
  }
  const pairs = s => s.trim().split(/\s*,\s*/).map(p => { const [x, y] = p.replace(/[()]/g, "").trim().split(/\s+/).map(Number); return { lon: x, lat: y }; });
  for (const line of geomTsv.split("\n").slice(1)) {
    const tab = line.indexOf("\t"); if (tab < 0) continue;
    const e = el(line.slice(0, tab)); if (!e) continue;
    const wkt = lit(line.slice(tab + 1));
    const kind = /^\s*(\w+)/.exec(wkt)?.[1];
    if (kind === "POINT") { const [p] = pairs(wkt.slice(wkt.indexOf("("))); if (e.type === "node") { e.lat = p.lat; e.lon = p.lon; } else e.center = p; }
    else if (kind === "LINESTRING") e.geometry = pairs(wkt.slice(wkt.indexOf("(")));
    else if (kind === "POLYGON" || kind === "MULTIPOLYGON") {
      // The outer ring of the (first) polygon: areas are drawn by their outline.
      const ring = /\(\(+([^()]*)\)/.exec(wkt)?.[1];
      if (ring) { e.geometry = pairs(ring); if (e.type === "relation") { const g = e.geometry; e.center = { lon: g.reduce((a, p) => a + p.lon, 0) / g.length, lat: g.reduce((a, p) => a + p.lat, 0) / g.length }; } }
    }
  }
  const list = [...els.values()].filter(e => e.lat != null || e.center || e.geometry);
  fs.writeFileSync(path.join(dir, "world.json"), JSON.stringify(list));
  console.log(`${list.length} sea marks with their shapes and tags`);
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
