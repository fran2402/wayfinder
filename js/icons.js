// Map icons drawn as SVG. Each one is rasterised once, sharply (several device pixels per CSS pixel),
// added to the map, and added again after the style changes (light/dark), since a new style drops images.

const made = new Map();   // id → { image, opts } once drawn
const pending = new Map(); // id → Promise while drawing
const maps = new Set();

/** Rasterise an SVG string. */
async function raster(svg, w, h, ratio) {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = Math.round(w * ratio); c.height = Math.round(h * ratio);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer) };
}

function put(map, id) {
  const m = made.get(id);
  if (!m || !map.style) return;
  if (map.hasImage(id)) map.updateImage(id, m.image); else map.addImage(id, m.image, m.opts);
}

/** Use this map: icons are added to it, and again whenever its style is replaced. */
export function attach(map) {
  maps.add(map);
  map.on("style.load", () => { for (const id of made.keys()) put(map, id); });
  map.on("styleimagemissing", e => { if (made.has(e.id)) put(map, e.id); });
}

/**
 * Make sure icon `id` exists: `def()` returns { svg, w, h, ratio?, stretchX?, stretchY?, content? }
 * (sizes in CSS pixels; the stretch zones and content box too). Resolves once the map has it.
 */
export function ensure(id, def) {
  if (made.has(id)) return Promise.resolve();
  if (pending.has(id)) return pending.get(id);
  const d = def();
  if (!d) return Promise.resolve();
  const r = d.ratio || 3;
  const scale = a => a && a.map(v => Array.isArray(v) ? v.map(x => x * r) : v * r);
  const p = raster(d.svg, d.w, d.h, r).then(image => {
    const opts = { pixelRatio: r };
    if (d.stretchX) opts.stretchX = scale(d.stretchX);
    if (d.stretchY) opts.stretchY = scale(d.stretchY);
    if (d.content) opts.content = scale(d.content);
    made.set(id, { image, opts });
    pending.delete(id);
    for (const m of maps) put(m, id);
  }).catch(e => { pending.delete(id); console.warn("Icon", id, e); });
  pending.set(id, p);
  return p;
}

export const ensureAll = list => Promise.all(list.map(([id, def]) => ensure(id, def)));

/** Like ensureAll, but a few at a time when the browser is idle: no stutter at startup. */
export function ensureIdle(list) {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 60));
  let i = 0;
  const step = () => { const part = list.slice(i, i + 6); i += 6; if (!part.length) return; ensureAll(part).then(() => idle(step)); };
  idle(step);
}
