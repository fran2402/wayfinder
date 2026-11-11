// The public transport network on the map: every line in view, drawn the way a metro map does —
// lines sharing a street or track glued side by side, a white station at every stop.
//
// Data comes from Transitous' "routes" endpoint per map tile. It returns stop-to-stop shapes;
// shapes between the same two stations (and of the same kind: rail, street, …) are one bundle.

import { api, shape } from "./api.js";
import { ensureLine, colourOf, WIDTH, GROUP, CLASS_ORDER, compareLines, classOf } from "./lines.js";
import { debounce, metres } from "./util.js";

const EMPTY = { type: "FeatureCollection", features: [] };

/** Far out, only the big networks: buses appear from zoom 11, trams from 9, trains always. */
export const DRAW_FROM = { train: 0, metro: 8, tram: 9, ferry: 8, other: 11, bus: 11 };

/** Line width in pixels for a relative width w, by zoom. */
const scaled = (prop, add = 0, mul = 1) => ["interpolate", ["exponential", 1.35], ["zoom"],
  ...[[5, 0.9], [9, 1.5], [12, 2.5], [14, 3.7], [16, 5.4], [19, 9]].flatMap(([z, k]) => [z, ["+", ["*", ["get", prop], k * mul], add]])];

export function networkSources() {
  return { network: { type: "geojson", data: EMPTY, tolerance: 0.3 }, stations: { type: "geojson", data: EMPTY },
    focus: { type: "geojson", data: EMPTY, lineMetrics: false }, trip: { type: "geojson", data: EMPTY } };
}

/** Layers go in three slots of the base style: lines under labels, stations, and labels on top. */
export function networkLayers(t) {
  const lines = [
    { id: "net-casing", type: "line", source: "network", layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "s"] },
      paint: { "line-color": t.land, "line-width": scaled("w", 2.2), "line-offset": scaled("off") } },
    { id: "net-lines", type: "line", source: "network", layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "s"] },
      paint: { "line-color": ["get", "c"], "line-width": scaled("w", 0.35), "line-offset": scaled("off") } },
    { id: "net-rail-dash", type: "line", source: "network", filter: ["==", ["get", "dash"], 1], minzoom: 9,
      paint: { "line-color": t.land, "line-width": scaled("w", 0, 0.32), "line-offset": scaled("off"), "line-dasharray": [0.5, 1.2], "line-opacity": 0.0001 } },
    { id: "net-hit", type: "line", source: "network", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16, "line-offset": scaled("off") } },
    // A followed line or a planned trip, drawn over the network.
    { id: "focus-casing", type: "line", source: "focus", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.land, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12, 18, 20] } },
    { id: "focus-line", type: "line", source: "focus", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "c"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 8, 18, 15] } },
    { id: "trip-casing", type: "line", source: "trip", filter: ["==", ["get", "k"], "ride"], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.land, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12, 18, 20] } },
    { id: "trip-ride", type: "line", source: "trip", filter: ["==", ["get", "k"], "ride"], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "c"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 8, 18, 15] } },
    { id: "trip-walk", type: "line", source: "trip", filter: ["==", ["get", "k"], "walk"], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.walk, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 5.5], "line-dasharray": [0.1, 1.8] } },
    { id: "trip-bike", type: "line", source: "trip", filter: ["==", ["get", "k"], "bike"], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#1E9B55", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 7] } },
  ];
  const stations = [
    { id: "stations", type: "circle", source: "stations",
      filter: ["any", [">=", ["zoom"], 13.5], ["all", [">=", ["zoom"], 9], ["==", ["get", "rail"], 1]], ["all", [">=", ["zoom"], 11.5], [">=", ["get", "n"], 3]]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["+", 2, ["*", ["min", ["get", "n"], 6], 0.25]], 14, ["+", 3.6, ["*", ["min", ["get", "n"], 8], 0.6]], 18, ["+", 6, ["*", ["min", ["get", "n"], 8], 0.9]]],
        "circle-color": t.stopFill, "circle-stroke-color": t.stopRing,
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 15, 2.2], "circle-opacity": ["get", "o"], "circle-stroke-opacity": ["get", "o"],
      } },
    { id: "trip-stops", type: "circle", source: "trip", filter: ["==", ["get", "k"], "stop"],
      paint: { "circle-radius": ["case", ["==", ["get", "end"], 1], 6.5, 3.2], "circle-color": t.stopFill,
        "circle-stroke-color": ["case", ["==", ["get", "end"], 1], t.stopRing, ["get", "c"]], "circle-stroke-width": ["case", ["==", ["get", "end"], 1], 2.4, 1.6] } },
  ];
  const labels = [
    { id: "station-labels", type: "symbol", source: "stations",
      filter: ["any", [">=", ["zoom"], 15], ["all", [">=", ["zoom"], 11], ["==", ["get", "rail"], 1]], ["all", [">=", ["zoom"], 13], [">=", ["get", "n"], 4]]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10.5, 16, 13],
        "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.9, "text-justify": "auto", "text-max-width": 9,
        "symbol-sort-key": ["-", 0, ["get", "n"]] },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.6, "text-opacity": ["get", "o"] } },
    { id: "trip-labels", type: "symbol", source: "trip", filter: ["all", ["==", ["get", "k"], "stop"], ["==", ["get", "end"], 1]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12.5, "text-variable-anchor": ["left", "right", "top", "bottom"],
        "text-radial-offset": 1, "text-allow-overlap": false },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.8 } },
  ];
  return { lines, stations, labels };
}

const tileBox = (x, y, z) => {
  const n = 2 ** z, lon = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
};
const tileOf = (lon, lat, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};

export class Network {
  constructor(map) {
    this.map = map;
    this.segs = new Map();      // bundle key → { coords, lines:Set }
    this.stations = new Map();  // station key → { key, name, lon, lat, lines:Set }
    this.tiles = new Map();     // "zoom/z/x/y" → "queued" | "loading" | "done" | "failed"
    this.queue = [];
    this.active = 0;
    this.enabled = new Set(["train", "metro", "tram", "bus", "ferry", "other"]);
    this.spread = true;
    this.focusKey = null;
    this.dimmed = false;
    this.listeners = new Set();
    this.renderSoon = debounce(() => this.render(), 90);
    this.lastBucket = null;
    this.loading = 0;
    this.seen = new Set();      // kinds of transport met so far
  }
  on(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  /** The server filters by zoom up to 10 (trains only far out); from 11 on the answer is the same. */
  bucket() { return Math.max(6, Math.min(11, Math.floor(this.map.getZoom()))); }

  /** Ask for the tiles that cover the view (and a margin around it). */
  update() {
    const zq = this.bucket(), g = Math.max(4, zq - 1);
    const b = this.map.getBounds(), padX = (b.getEast() - b.getWest()) * 0.15, padY = (b.getNorth() - b.getSouth()) * 0.15;
    const [x0, y0] = tileOf(Math.max(-180, b.getWest() - padX), Math.min(85, b.getNorth() + padY), g);
    const [x1, y1] = tileOf(Math.min(179.999, b.getEast() + padX), Math.max(-85, b.getSouth() - padY), g);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, want = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = `${zq}/${g}/${x}/${y}`;
      const st = this.tiles.get(key);
      if (!st || st === "failed") want.push({ key, zq, x, y, g, depth: 0, box: tileBox(x, y, g), d: Math.hypot(x - cx, y - cy) });
    }
    want.sort((a, b) => a.d - b.d);
    // Tiles queued for another zoom are no longer wanted.
    this.queue = this.queue.filter(q => { if (q.zq === zq) return true; this.tiles.delete(q.key); return false; });
    for (const w of want) { this.tiles.set(w.key, "queued"); this.queue.push(w); }
    this.pump();
    const rz = Math.floor(this.map.getZoom());
    if (this.lastBucket !== zq || this.lastDrawZoom !== rz) { this.lastBucket = zq; this.lastDrawZoom = rz; this.render(); }
  }

  pump() {
    while (this.active < 4 && this.queue.length) {
      const t = this.queue.shift();
      this.active++; this.loading++; this.tiles.set(t.key, "loading"); this.emit();
      api.routes(t.zq, t.box)
        .then(d => { this.ingest(d, t.zq); this.tiles.set(t.key, "done"); this.renderSoon(); })
        .catch(e => {
          // Too dense for one request: ask for its four quarters instead.
          if (/too many/i.test(e.message) && t.depth < 3) {
            this.tiles.set(t.key, "split");
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
              const x = t.x * 2 + dx, y = t.y * 2 + dy, g = t.g + 1, key = `${t.zq}/${g}/${x}/${y}`;
              this.tiles.set(key, "queued");
              this.queue.unshift({ key, zq: t.zq, x, y, g, depth: t.depth + 1, box: tileBox(x, y, g) });
            }
          } else this.tiles.set(t.key, "failed");
        })
        .finally(() => { this.active--; this.loading--; this.emit(); this.pump(); });
    }
  }

  station(s) {
    const key = s.parentId || s.stopId;
    let st = this.stations.get(key);
    if (!st) { st = { key, name: s.name, lon: s.lon, lat: s.lat, lines: new Set() }; this.stations.set(key, st); }
    return st;
  }

  ingest(d, zq) {
    const stops = d.stops.map(s => this.station(s));
    const colourOfRoute = new Map();
    for (const p of d.polylines) p.routeIndexes.forEach((ri, k) => { if (p.colors && p.colors[k]) colourOfRoute.set(ri, p.colors[k]); });
    const shapes = [];
    d.routes.forEach((r, ri) => {
      if (!r.segments.length || !classOf(r.mode)) return;
      const tr = r.transitRoutes[0] || {};
      const line = ensureLine({ mode: r.mode, name: tr.shortName, colour: colourOfRoute.get(ri), longName: tr.longName });
      if (!line) return;
      this.seen.add(line.cls);
      line.routes.add(r.routeIdx);
      if (zq < line.minZoom) line.minZoom = zq;
      line.numStops = Math.max(line.numStops || 0, r.numStops || 0);
      const group = GROUP[line.cls];
      for (const sg of r.segments) {
        const a = stops[sg.from], b = stops[sg.to];
        if (!a || !b || a === b) continue;
        a.lines.add(line); b.lines.add(line);
        const key = group + "|" + (a.key < b.key ? a.key + ">" + b.key : b.key + ">" + a.key);
        let seg = this.segs.get(key);
        if (!seg) {
          const coords = shapes[sg.polyline] ??= shape(d.polylines[sg.polyline]?.polyline);
          if (coords.length < 2) continue;
          seg = { key, coords, lines: new Set() };
          this.segs.set(key, seg);
        }
        seg.lines.add(line);
      }
    });
  }

  visible(l) { return this.enabled.has(l.cls) && l.minZoom <= this.bucket() && Math.floor(this.map.getZoom()) >= DRAW_FROM[l.cls]; }

  render() {
    const src = this.map.getSource("network"), stSrc = this.map.getSource("stations");
    if (!src || !stSrc) return;
    // Colours: lines without one avoid the colours of lines they meet.
    for (const st of this.stations.values()) for (const l of st.lines) if (!l.colour) colourOf(l, st.lines);
    const feats = [];
    for (const seg of this.segs.values()) {
      // Lines that look the same (same kind, same colour: every grey train, buses in the shared blue)
      // are one stroke; side by side they couldn't be told apart anyway. A tap lists them all.
      const groups = new Map();
      for (const l of seg.lines) {
        if (!this.visible(l)) continue;
        const vk = l.cls + "|" + colourOf(l);
        if (!groups.has(vk)) groups.set(vk, []);
        groups.get(vk).push(l);
      }
      if (!groups.size) continue;
      const members = [...groups.values()].map(ls => ls.sort(compareLines)).sort((a, b) => compareLines(a[0], b[0]));
      const total = members.reduce((s, ls) => s + WIDTH[ls[0].cls], 0);
      let acc = -total / 2;
      for (const ls of members) {
        const l = ls[0], w = WIDTH[l.cls], off = this.spread ? acc + w / 2 : 0;
        acc += w;
        feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: seg.coords },
          properties: { line: l.key, lines: ls.map(x => x.key).join("\n"), c: colourOf(l), w, off, s: 10 - CLASS_ORDER[l.cls], dash: l.cls === "train" && !l.raw ? 1 : 0 } });
      }
    }
    src.setData({ type: "FeatureCollection", features: feats });
    const stations = [];
    for (const st of this.stations.values()) {
      const ls = [...st.lines].filter(l => this.visible(l));
      if (!ls.length) continue;
      const on = !this.focusKey || ls.some(l => l.key === this.focusKey);
      stations.push({ type: "Feature", geometry: { type: "Point", coordinates: [st.lon, st.lat] },
        properties: { key: st.key, name: st.name, n: ls.length, rail: ls.some(l => l.cls === "train" || l.cls === "metro") ? 1 : 0, o: this.dimmed ? 0.35 : on ? 1 : 0.3 } });
    }
    stSrc.setData({ type: "FeatureCollection", features: stations });
    this.applyFocus();
    this.emit();
  }

  /** Fade every line but one (a followed line), or all of them (a planned trip). */
  setFocus(key, dimAll = false) {
    if (this.focusKey === key && this.dimmed === dimAll) return;
    this.focusKey = key; this.dimmed = dimAll;
    this.render();
  }
  applyFocus() {
    const m = this.map; if (!m.getLayer("net-lines")) return;
    const op = this.dimmed ? 0.22 : this.focusKey ? ["case", ["in", this.focusKey, ["get", "lines"]], 1, 0.16] : 1;
    m.setPaintProperty("net-lines", "line-opacity", op);
    m.setPaintProperty("net-casing", "line-opacity", op);
    m.setPaintProperty("net-rail-dash", "line-opacity", this.dimmed || this.focusKey ? 0.0001 : 0.9);
  }

  // ---- Questions the interface asks ----

  stationsNear([lon, lat], radius) {
    const out = [];
    for (const st of this.stations.values()) {
      if (Math.abs(st.lat - lat) > 0.01 || Math.abs(st.lon - lon) > 0.015) continue;
      if (metres([lon, lat], [st.lon, st.lat]) <= radius) out.push(st);
    }
    return out;
  }
  /** Lines stopping within `radius` m of a point. */
  linesNear(pt, radius = 140) {
    const set = new Set();
    for (const st of this.stationsNear(pt, radius)) for (const l of st.lines) if (this.enabled.has(l.cls)) set.add(l);
    return set;
  }
  /** Lines running along the stretch between two stations (same kind of way as `cls`). */
  linesAlong(aKey, bKey, cls) {
    const key = GROUP[cls] + "|" + (aKey < bKey ? aKey + ">" + bKey : bKey + ">" + aKey);
    const seg = this.segs.get(key);
    return seg ? [...seg.lines].filter(l => this.enabled.has(l.cls)) : [];
  }
  linesInView() {
    const b = this.map.getBounds(), set = new Set();
    for (const st of this.stations.values()) if (b.contains([st.lon, st.lat])) for (const l of st.lines) if (this.visible(l)) set.add(l);
    return [...set].sort(compareLines);
  }
}
