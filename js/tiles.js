// Two custom tile sources, served by tile-worker.js off the main thread:
//   wfdepth://{theme}/{z}/{x}/{y} — sea depth, spline-interpolated and coloured (no terraces when zoomed in);
//   wfomt://…                     — OpenFreeMap vector tiles, with natural shapes and roads smoothed at zoom 14.

import { THEMES } from "./basemap.js";

// Ski runs and sea marks come as single vector-tile files (PMTiles), read by byte ranges.
if (typeof pmtiles !== "undefined") maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);

// Two workers, taking turns, so a slow depth tile never holds up the next one.
const pending = new Map();
let seq = 0;
const workers = [0, 1].map(() => {
  const w = new Worker(new URL("./tile-worker.js", import.meta.url));
  w.onmessage = ({ data: m }) => {
    const p = pending.get(m.id); pending.delete(m.id);
    if (!p) return;
    if (m.error || m.status) p.reject(new Error(m.error || "HTTP " + m.status)); else p.resolve(m.buf);
  };
  return w;
});
const ask = msg => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); workers[id % workers.length].postMessage({ ...msg, id }); });

let blank = null;
async function blankPng() {
  if (!blank) { const c = new OffscreenCanvas(1, 1); c.getContext("2d"); blank = c.convertToBlob({ type: "image/png" }).then(b => b.arrayBuffer()); }
  return (await blank).slice(0);
}

const OMT = "https://tiles.openfreemap.org/planet";
// The vector tiles' address (for the water mask under the sea depth).
let tilejson = null;
const omtTiles = () => (tilejson ||= fetch(OMT).then(r => r.json())).then(tj => tj.tiles[0]).catch(() => null);

maplibregl.addProtocol("wfdepth", async params => {
  const [, theme, z, x, y] = params.url.match(/^wfdepth:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/);
  const buf = await ask({ kind: "depth", z: +z, x: +x, y: +y, palette: THEMES[theme].depth, omt: await omtTiles() });
  return { data: buf || await blankPng() };
});

let omtMax = 14;
maplibregl.addProtocol("wfomt", async (params, abort) => {
  if (params.url === "wfomt://planet") {
    // The tile description: same tiles, but fetched through the smoothing worker.
    const tj = await (tilejson ||= fetch(OMT).then(r => r.json()));
    omtMax = tj.maxzoom ?? 14;
    return { data: { ...tj, tiles: tj.tiles.map(t => "wfomt://" + t.replace(/^https:\/\//, "")) } };
  }
  const url = "https://" + params.url.slice("wfomt://".length);
  const z = +(url.match(/\/(\d+)\/\d+\/\d+\.pbf/) || [])[1];
  // Only the most detailed tiles are smoothed (in a worker); all others come straight from the network.
  if (z < omtMax) {
    const res = await fetch(url, { signal: abort?.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { data: await res.arrayBuffer() };
  }
  const buf = await ask({ kind: "mvt", url, smooth: true });
  return { data: buf };
});
