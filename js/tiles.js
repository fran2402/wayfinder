// Two custom tile sources, served by tile-worker.js off the main thread:
//   wfdepth://{theme}/{z}/{x}/{y} — sea depth, spline-interpolated and coloured (no terraces when zoomed in);
//   wfomt://…                     — OpenFreeMap vector tiles, with natural shapes and roads smoothed at zoom 14.

import { THEMES } from "./basemap.js";

const worker = new Worker(new URL("./tile-worker.js", import.meta.url));
const pending = new Map();
let seq = 0;
worker.onmessage = ({ data: m }) => {
  const p = pending.get(m.id); pending.delete(m.id);
  if (!p) return;
  if (m.error || m.status) p.reject(new Error(m.error || "HTTP " + m.status)); else p.resolve(m.buf);
};
const ask = msg => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }); });

let blank = null;
async function blankPng() {
  if (!blank) { const c = new OffscreenCanvas(1, 1); c.getContext("2d"); blank = c.convertToBlob({ type: "image/png" }).then(b => b.arrayBuffer()); }
  return (await blank).slice(0);
}

maplibregl.addProtocol("wfdepth", async params => {
  const [, theme, z, x, y] = params.url.match(/^wfdepth:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/);
  const buf = await ask({ kind: "depth", z: +z, x: +x, y: +y, palette: THEMES[theme].depth });
  return { data: buf || await blankPng() };
});

const OMT = "https://tiles.openfreemap.org/planet";
let omtMax = 14;
maplibregl.addProtocol("wfomt", async params => {
  if (params.url === "wfomt://planet") {
    // The tile description: same tiles, but fetched through the smoothing worker.
    const tj = await (await fetch(OMT)).json();
    omtMax = tj.maxzoom ?? 14;
    return { data: { ...tj, tiles: tj.tiles.map(t => "wfomt://" + t.replace(/^https:\/\//, "")) } };
  }
  const url = "https://" + params.url.slice("wfomt://".length);
  const z = +(url.match(/\/(\d+)\/\d+\/\d+\.pbf/) || [])[1];
  const buf = await ask({ kind: "mvt", url, smooth: z >= omtMax });
  return { data: buf };
});
