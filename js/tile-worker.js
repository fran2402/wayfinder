// Map tiles made smoother, off the main thread.
//
// 1. Sea depth: the elevation tiles carry the sea floor only up to zoom 8 and in whole metres, so
//    enlarged they show terraces. Here they are sampled with a bicubic (Catmull-Rom) spline across
//    tile edges and coloured into a smooth raster tile, at any zoom.
// 2. Shapes: the most detailed vector tiles (zoom 14, which the map enlarges beyond that) have their
//    natural outlines — water, rivers, woods, grass, parks — and roads re-drawn through a centripetal
//    Catmull-Rom spline. The curve passes through every original point, so shapes keep their place
//    and stay connected, but corners and circles come out round. Buildings and blocks keep their corners.

const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SIZE = 256;

/* ------------------------------ Sea depth ------------------------------ */

const demCache = new Map();
function demTile(z, x, y) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${x}/${y}`;
  if (!demCache.has(key)) {
    demCache.set(key, fetch(`${DEM}/${key}.png`).then(r => r.ok ? r.blob() : null).then(async b => {
      if (!b) return null;
      const bmp = await createImageBitmap(b), c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, SIZE, SIZE).data, out = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      return out;
    }).catch(() => null));
    if (demCache.size > 400) demCache.delete(demCache.keys().next().value);
  }
  return demCache.get(key);
}

function parseColour(c) {
  if (c[0] === "#") return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], Math.round((m[3] ?? 1) * 255)];
}
const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/**
 * Where the water is in this tile, as an alpha mask: the base map's water polygons drawn into a canvas.
 * Land below sea level (polders, the Dead Sea shore…) has a negative elevation too; without this it
 * would be coloured like the sea.
 */
async function waterMask(template, z, x, y) {
  if (!template) return null;
  const zt = Math.min(z, 14), f = 2 ** (z - zt), tx = Math.floor(x / f), ty = Math.floor(y / f);
  const res = await fetch(template.replace("{z}", zt).replace("{x}", tx).replace("{y}", ty));
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer()), r = new Reader(buf);
  const c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext("2d");
  g.fillStyle = "#000";
  while (r.pos < r.end) {
    const [lf, lw] = r.field();
    if (lf !== 3 || lw !== 2) { skipField(r, lw); continue; }
    const [ls, le] = r.bytes();
    let name = "", extent = 4096; const feats = [];
    const lr = new Reader(buf, ls, le);
    while (lr.pos < le) {
      const [f2, w2] = lr.field();
      if (f2 === 1 && w2 === 2) { const [a, b] = lr.bytes(); name = new TextDecoder().decode(buf.subarray(a, b)); }
      else if (f2 === 5 && w2 === 0) extent = lr.varint();
      else if (f2 === 2 && w2 === 2) feats.push(lr.bytes());
      else skipField(lr, w2);
    }
    if (name !== "water") continue;
    // This tile's part of the (parent) vector tile, in canvas pixels.
    const k = SIZE * f / extent, ox = (x - tx * f) * SIZE, oy = (y - ty * f) * SIZE;
    g.beginPath();
    for (const [a, b] of feats) {
      const fr = new Reader(buf, a, b); let type = 0, geom = null;
      while (fr.pos < b) { const [ff, fw] = fr.field(); if (ff === 3 && fw === 0) type = fr.varint(); else if (ff === 4 && fw === 2) { const [ga, gb] = fr.bytes(); const gr = new Reader(buf, ga, gb); geom = []; while (gr.pos < gb) geom.push(gr.varint()); } else skipField(fr, fw); }
      if (type !== 3 || !geom) continue;
      for (const part of decodeGeometry(geom)) {
        part.pts.forEach(([px, py], i) => i ? g.lineTo(px * k - ox, py * k - oy) : g.moveTo(px * k - ox, py * k - oy));
        g.closePath();
      }
    }
    g.fill("nonzero");
  }
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

async function depthTile(z, x, y, palette, omt) {
  const maskP = waterMask(omt, z, x, y).catch(() => null);
  const stops = [];
  for (let i = 0; i < palette.length; i += 2) stops.push([palette[i], parseColour(palette[i + 1])]);
  const zs = Math.min(z, 8), f = 2 ** (z - zs);
  // Texel range of the source zoom this tile needs (with 2 texels of margin for the spline).
  const gx0 = Math.floor(x * SIZE / f) - 2, gy0 = Math.floor(y * SIZE / f) - 2, gx1 = Math.ceil((x + 1) * SIZE / f) + 2, gy1 = Math.ceil((y + 1) * SIZE / f) + 2;
  const tiles = new Map();
  for (let ty = Math.floor(gy0 / SIZE); ty <= Math.floor(gy1 / SIZE); ty++) for (let tx = Math.floor(gx0 / SIZE); tx <= Math.floor(gx1 / SIZE); tx++) tiles.set(tx + "," + ty, await demTile(zs, tx, ty));
  if (![...tiles.values()].some(Boolean)) return null;
  const at = (gx, gy) => {
    const tx = Math.floor(gx / SIZE), ty = Math.floor(gy / SIZE), t = tiles.get(tx + "," + ty);
    if (!t) return 0;
    return t[(gy - ty * SIZE) * SIZE + (gx - tx * SIZE)];
  };
  const img = new ImageData(SIZE, SIZE), d = img.data;
  const row = new Float32Array(4);
  let any = false;
  for (let py = 0; py < SIZE; py++) {
    const sy = (y * SIZE + py + 0.5) / f - 0.5, iy = Math.floor(sy), fy = sy - iy;
    for (let px = 0; px < SIZE; px++) {
      const sx = (x * SIZE + px + 0.5) / f - 0.5, ix = Math.floor(sx), fx = sx - ix;
      for (let k = -1; k <= 2; k++) row[k + 1] = cr(at(ix - 1, iy + k), at(ix, iy + k), at(ix + 1, iy + k), at(ix + 2, iy + k), fx);
      const e = cr(row[0], row[1], row[2], row[3], fy);
      // Colour by depth: between stops, blended.
      let c;
      if (e <= stops[0][0]) c = stops[0][1];
      else if (e >= stops[stops.length - 1][0]) c = stops[stops.length - 1][1];
      else {
        let i = 1; while (stops[i][0] < e) i++;
        const [e0, c0] = stops[i - 1], [e1, c1] = stops[i], t = (e - e0) / (e1 - e0);
        c = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, c0[3] + (c1[3] - c0[3]) * t];
      }
      const o = (py * SIZE + px) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
      if (c[3] > 0) any = true;
    }
  }
  if (!any) return null;
  const mask = await maskP;
  if (mask) { any = false; for (let i = 3; i < d.length; i += 4) { d[i] = d[i] * mask[i] / 255; if (d[i]) any = true; } if (!any) return null; }
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  canvas.getContext("2d").putImageData(img, 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

/* ------------------------------ Smooth shapes in vector tiles ------------------------------ */

// A tiny protobuf reader/writer, enough for Mapbox Vector Tiles.
class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  varint() { let v = 0, s = 0, b; do { b = this.buf[this.pos++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; }
  field() { const k = this.varint(); return [k >>> 3, k & 7]; }
  bytes() { const n = this.varint(), s = this.pos; this.pos += n; return [s, this.pos]; }
}
class Writer {
  constructor() { this.buf = new Uint8Array(1024); this.pos = 0; }
  grow(n) { if (this.pos + n <= this.buf.length) return; let l = this.buf.length * 2; while (l < this.pos + n) l *= 2; const b = new Uint8Array(l); b.set(this.buf); this.buf = b; }
  varint(v) { this.grow(10); while (v > 0x7f) { this.buf[this.pos++] = (v & 0x7f) | 0x80; v = Math.floor(v / 128); } this.buf[this.pos++] = v; }
  key(f, w) { this.varint(f * 8 + w); }
  raw(src, s, e) { this.grow(e - s); this.buf.set(src.subarray(s, e), this.pos); this.pos += e - s; }
  message(f, bytes) { this.key(f, 2); this.varint(bytes.length); this.raw(bytes, 0, bytes.length); }
  done() { return this.buf.subarray(0, this.pos); }
}
// Skip a field of wire type w (returns nothing; moves the reader).
function skipField(r, w) {
  if (w === 0) r.varint(); else if (w === 1) r.pos += 8; else if (w === 2) { const n = r.varint(); r.pos += n; } else if (w === 5) r.pos += 4;
}

const SMOOTH_LAYERS = new Set(["water", "waterway", "landcover", "park", "transportation"]);
const zz = n => (n << 1) ^ (n >> 31), unzz = n => (n >>> 1) ^ -(n & 1);

function decodeGeometry(cmds) {
  const parts = []; let x = 0, y = 0, i = 0, cur = null;
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < n; k++) {
        x += unzz(cmds[i++]); y += unzz(cmds[i++]);
        if (id === 1) { cur = { pts: [[x, y]], closed: false }; parts.push(cur); } else cur.pts.push([x, y]);
      }
    } else if (id === 7 && cur) cur.closed = true;
  }
  return parts;
}
function encodeGeometry(parts) {
  const out = []; let x = 0, y = 0;
  for (const p of parts) {
    const pts = p.pts;
    if (!pts.length) continue;
    out.push((1 & 7) | (1 << 3), zz(pts[0][0] - x), zz(pts[0][1] - y)); x = pts[0][0]; y = pts[0][1];
    if (pts.length > 1) {
      out.push((2 & 7) | ((pts.length - 1) << 3));
      for (let i = 1; i < pts.length; i++) { out.push(zz(pts[i][0] - x), zz(pts[i][1] - y)); x = pts[i][0]; y = pts[i][1]; }
    }
    if (p.closed) out.push(7 | (1 << 3));
  }
  return out;
}
/** A centripetal Catmull-Rom spline through the points: new points every ~step units on long segments. */
function spline(pts, closed, step) {
  const n = pts.length;
  if (n < 3) return pts;
  const P = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const out = [], segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    out.push(p1);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.min(24, Math.floor(len / step));
    if (k < 1) continue;
    // Straight on both ends: nothing to round.
    const turn = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1]; return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)); };
    if ((p0 === p1 || turn(p0, p1, p2) < 0.05) && (p2 === p3 || turn(p1, p2, p3) < 0.05)) continue;
    // Centripetal parametrisation (no loops or cusps).
    const d = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let j = 1; j <= k; j++) {
      const t = t1 + (t2 - t1) * j / (k + 1);
      const lerp = (a, b, ta, tb) => [(a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta), (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3), C = lerp(B1, B2, t1, t2);
      const q = [Math.round(C[0]), Math.round(C[1])], last = out[out.length - 1];
      if (q[0] !== last[0] || q[1] !== last[1]) out.push(q);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

function smoothFeature(buf, s, e, extent) {
  const r = new Reader(buf, s, e), w = new Writer();
  let type = 0, geom = null;
  const others = [];
  while (r.pos < r.end) {
    const [f, wt] = r.field(), start = r.pos;
    if (f === 3 && wt === 0) { type = r.varint(); others.push([f, wt, start, r.pos]); continue; }
    if (f === 4 && wt === 2) { const [a, b] = r.bytes(); const rr = new Reader(buf, a, b); geom = []; while (rr.pos < b) geom.push(rr.varint()); continue; }
    skipField(r, wt); others.push([f, wt, start, r.pos]);
  }
  for (const [f, wt, a, b] of others) { w.key(f, wt); w.raw(buf, a, b); }
  if (geom) {
    let out = geom;
    if (type === 2 || type === 3) {
      const step = extent / 512; // about every 4 m at zoom 14
      const parts = decodeGeometry(geom).map(p => ({ pts: p.pts.length > 2 ? spline(p.closed && p.pts.length > 3 && p.pts[0][0] === p.pts[p.pts.length - 1][0] && p.pts[0][1] === p.pts[p.pts.length - 1][1] ? p.pts.slice(0, -1) : p.pts, p.closed, step) : p.pts, closed: p.closed }));
      out = encodeGeometry(parts);
    }
    const g = new Writer(); for (const v of out) g.varint(v);
    w.message(4, g.done());
  }
  return w.done();
}

function smoothTile(data) {
  const buf = new Uint8Array(data), r = new Reader(buf), out = new Writer();
  while (r.pos < r.end) {
    const [f, wt] = r.field();
    if (f !== 3 || wt !== 2) { skipField(r, wt); continue; }
    const [ls, le] = r.bytes();
    // Read the layer's name and extent first.
    let name = "", extent = 4096;
    { const lr = new Reader(buf, ls, le); while (lr.pos < le) { const [lf, lw] = lr.field(); if (lf === 1 && lw === 2) { const [a, b] = lr.bytes(); name = new TextDecoder().decode(buf.subarray(a, b)); } else if (lf === 5 && lw === 0) extent = lr.varint(); else skipField(lr, lw); } }
    if (!SMOOTH_LAYERS.has(name)) { out.message(3, buf.subarray(ls, le)); continue; }
    const lw2 = new Writer(), lr = new Reader(buf, ls, le);
    while (lr.pos < le) {
      const [lf, lw] = lr.field(), start = lr.pos;
      if (lf === 2 && lw === 2) { const [a, b] = lr.bytes(); lw2.message(2, smoothFeature(buf, a, b, extent)); continue; }
      skipField(lr, lw); lw2.key(lf, lw); lw2.raw(buf, start, lr.pos);
    }
    out.message(3, lw2.done());
  }
  return out.done().slice().buffer;
}

/* ------------------------------ Messages ------------------------------ */

self.onmessage = async ({ data: m }) => {
  try {
    if (m.kind === "depth") {
      const buf = await depthTile(m.z, m.x, m.y, m.palette, m.omt);
      postMessage({ id: m.id, buf }, buf ? [buf] : []);
    } else if (m.kind === "mvt") {
      const res = await fetch(m.url);
      if (!res.ok) { postMessage({ id: m.id, status: res.status }); return; }
      const raw = await res.arrayBuffer();
      const buf = m.smooth && raw.byteLength ? smoothTile(raw) : raw;
      postMessage({ id: m.id, buf }, [buf]);
    }
  } catch (e) { postMessage({ id: m.id, error: String(e && e.message || e) }); }
};
