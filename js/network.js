import { isDarkText } from "./vehicles.js";
// The transit network on the map — the main-thread half. It decides which tiles to ask for and
// hands the finished map data to MapLibre; the heavy work happens in net-worker.js.

import { ensureLine, registry } from "./lines.js";
import { debounce } from "./util.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const MAINLINE = new Set(["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "LONG_DISTANCE", "HIGHSPEED_RAIL", "NIGHT_RAIL", "RAIL"]);

/** Line width in pixels for a relative width w, by zoom. */
const scaled = (prop, add = 0, mul = 1) => ["interpolate", ["exponential", 1.35], ["zoom"],
  ...[[5, 0.9], [9, 1.5], [12, 2.5], [14, 3.6], [16, 5.2], [19, 8.5]].flatMap(([z, k]) => [z, ["+", ["*", ["get", prop], k * mul], add]])];
const wide = (a, b, c, d) => ["interpolate", ["linear"], ["zoom"], 8, a, 12, b, 15, c, 18, d];

export function networkSources() {
  return { network: { type: "geojson", data: EMPTY, tolerance: 0.45, buffer: 64 }, stations: { type: "geojson", data: EMPTY, buffer: 32 },
    focus: { type: "geojson", data: EMPTY }, trip: { type: "geojson", data: EMPTY }, vehicles: { type: "geojson", data: EMPTY } };
}

/** Layers for three slots in the base style: lines under the labels, stations, labels on top. */
export function networkLayers(t) {
  const lines = [
    { id: "net-casing", type: "line", source: "network", minzoom: 13.5, layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "s"] },
      paint: { "line-color": t.casing, "line-width": scaled("w", 2.4), "line-offset": scaled("off") } },
    { id: "net-lines", type: "line", source: "network", layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "s"] },
      paint: { "line-color": ["get", "c"], "line-width": scaled("w", 0.4), "line-offset": scaled("off") } },
    { id: "net-rail-dash", type: "line", source: "network", filter: ["==", ["get", "dash"], 1], minzoom: 9,
      paint: { "line-color": t.casing, "line-width": scaled("w", 0, 0.3), "line-offset": scaled("off"), "line-dasharray": [0.6, 1.4] } },
    { id: "focus-casing", type: "line", source: "focus", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": t.casing, "line-width": wide(6, 9, 13, 20) } },
    { id: "focus-line", type: "line", source: "focus", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": wide(3.5, 5.5, 8.5, 15) } },
    { id: "trip-casing", type: "line", source: "trip", filter: ["==", ["get", "k"], "ride"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": t.casing, "line-width": wide(6, 9, 13, 20) } },
    { id: "trip-ride", type: "line", source: "trip", filter: ["==", ["get", "k"], "ride"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": wide(3.5, 5.5, 8.5, 15) } },
    { id: "trip-walk", type: "line", source: "trip", filter: ["==", ["get", "k"], "walk"], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.walk, "line-width": wide(2.5, 3, 4.5, 6), "line-dasharray": [0.1, 1.9] } },
    { id: "trip-bike", type: "line", source: "trip", filter: ["==", ["get", "k"], "bike"], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.bike, "line-width": wide(3, 4, 5.5, 8) } },
  ];
  const showStation = ["any", [">=", ["zoom"], 14.5], ["all", [">=", ["zoom"], 10], ["==", ["get", "rail"], 1]], ["all", [">=", ["zoom"], 13], [">=", ["get", "n"], 3]]];
  const stations = [
    // Walking links between stops of one station: a white bar with an outline, as on metro maps.
    { id: "station-links-casing", type: "line", source: "stations", filter: ["all", ["==", ["get", "link"], 1], [">=", ["zoom"], 14]], layout: { "line-cap": "round" },
      paint: { "line-color": t.ring, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 5, 17, 11] } },
    { id: "station-links", type: "line", source: "stations", filter: ["all", ["==", ["get", "link"], 1], [">=", ["zoom"], 14]], layout: { "line-cap": "round" },
      paint: { "line-color": t.stopFill, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2.4, 17, 6.5] } },
    // Stops: small far out, where they make room for each other (bigger stations win); all of them close in.
    ...[["stations-far", 0, 14.5, false], ["stations", 14.5, 24, true]].map(([id, minzoom, maxzoom, overlap]) => ({
      id, type: "symbol", source: "stations", minzoom, maxzoom, filter: ["all", ["!=", ["get", "link"], 1], showStation],
      layout: { "icon-image": ["concat", "stop-", ["get", "kind"]], "icon-allow-overlap": overlap, "icon-ignore-placement": overlap, "icon-padding": 1,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, ["*", 0.28, ["+", 1, ["*", ["min", ["get", "own"], 6], 0.04]]], 12, ["*", 0.4, ["+", 1, ["*", ["min", ["get", "own"], 6], 0.04]]],
          14, ["*", 0.55, ["+", 1, ["*", ["min", ["get", "own"], 6], 0.05]]], 16, ["*", 0.8, ["+", 1, ["*", ["min", ["get", "own"], 6], 0.06]]], 19, ["*", 1.15, ["+", 1, ["*", ["min", ["get", "own"], 6], 0.06]]]],
        "symbol-sort-key": ["-", 0, ["get", "n"]] } })),
    { id: "trip-stops", type: "circle", source: "trip", filter: ["==", ["get", "k"], "stop"],
      paint: { "circle-radius": ["case", ["==", ["get", "end"], 1], 6.5, 3.2], "circle-color": t.stopFill,
        "circle-stroke-color": ["case", ["==", ["get", "end"], 1], t.ring, ["get", "c"]], "circle-stroke-width": ["case", ["==", ["get", "end"], 1], 2.6, 1.6] } },
  ];
  // Vehicles on the move: a marker in the line's colour pointing the way it goes, the kind of vehicle
  // inside — and from zoom 15 its line number instead.
  const vsize = ["interpolate", ["linear"], ["zoom"], 10, 0.45, 13, 0.7, 15, 0.9, 17, 1.1];
  const vcommon = { "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": vsize };
  stations.push(
    { id: "vehicles", type: "symbol", source: "vehicles",
      layout: { ...vcommon, "icon-image": ["concat", "veh-", ["slice", ["get", "c"], 1]], "icon-rotate": ["get", "b"], "icon-rotation-alignment": "map", "symbol-sort-key": ["get", "rt"] } },
    { id: "vehicle-glyphs", type: "symbol", source: "vehicles", maxzoom: 15,
      layout: { ...vcommon, "icon-image": ["concat", "vg-", ["get", "cls"], ["case", ["==", ["get", "d"], 1], "-d", "-w"]] } },
    { id: "vehicle-labels", type: "symbol", source: "vehicles", minzoom: 15,
      layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 15, 9, 17, 11.5], "text-allow-overlap": true, "text-ignore-placement": true, "text-max-width": 3 },
      paint: { "text-color": ["case", ["==", ["get", "d"], 1], "#111111", "#FFFFFF"] } });
  const labels = [
    // Names only where there's room: big rail stations from zoom 13, busy stops from 15, every stop from 16.5.
    { id: "station-labels", type: "symbol", source: "stations",
      filter: ["all", ["==", ["get", "lbl"], 1], ["any", [">=", ["zoom"], 16.5], ["all", [">=", ["zoom"], 13], ["==", ["get", "rail"], 1]], ["all", [">=", ["zoom"], 15], [">=", ["get", "n"], 4]]]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 12.5],
        "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.8, "text-justify": "auto", "text-max-width": 8, "text-padding": 4,
        "symbol-sort-key": ["-", 0, ["get", "n"]] },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.6 } },
    { id: "trip-labels", type: "symbol", source: "trip", filter: ["all", ["==", ["get", "k"], "stop"], ["==", ["get", "end"], 1]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12.5, "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 1 },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.8 } },
  ];
  return { lines, stations, labels };
}

/** Stop markers, drawn on demand: the shape tells the mode. */
export function stopIcon(map, id, t) {
  const kind = id.replace("stop-", ""), px = 2, S = 32, c = document.createElement("canvas");
  c.width = c.height = S * px;
  const g = c.getContext("2d");
  g.scale(px, px);
  g.fillStyle = t.stopFill; g.strokeStyle = t.ring; g.lineJoin = "round";
  const m = S / 2;
  if (kind === "train" || kind === "metro") {
    g.lineWidth = 3.6; g.beginPath(); g.arc(m, m, 8.6, 0, Math.PI * 2); g.fill(); g.stroke();
    if (kind === "train") { g.fillStyle = t.ring; g.beginPath(); g.arc(m, m, 3, 0, Math.PI * 2); g.fill(); }
  } else if (kind === "tram") {
    g.lineWidth = 3; g.beginPath(); g.arc(m, m, 6.6, 0, Math.PI * 2); g.fill(); g.stroke();
  } else if (kind === "bus") {
    g.lineWidth = 2.6; const s = 11; g.beginPath(); g.roundRect(m - s / 2, m - s / 2, s, s, 2.5); g.fill(); g.stroke();
  } else if (kind === "ferry") {
    g.lineWidth = 2.6; g.beginPath(); g.moveTo(m, m - 8); g.lineTo(m + 8, m); g.lineTo(m, m + 8); g.lineTo(m - 8, m); g.closePath(); g.fill(); g.stroke();
  } else {
    g.lineWidth = 2.6; g.beginPath(); g.moveTo(m, m - 7.5); g.lineTo(m + 7.5, m + 6); g.lineTo(m - 7.5, m + 6); g.closePath(); g.fill(); g.stroke();
  }
  map.addImage(id, { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data }, { pixelRatio: px });
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
    this.worker = new Worker(new URL("./net-worker.js", import.meta.url), { type: "module" });
    this.tiles = new Map();   // key → queued | loading | done | failed | split
    this.queue = [];
    this.active = 0;
    this.enabled = new Set(["train", "metro", "tram", "bus", "ferry", "other"]);
    this.spread = true;
    this.liveOnly = true;       // only lines with something running now
    this.vehicles = true;       // moving vehicles on the map
    // What's running changes: refresh it every three minutes while the page is open.
    setInterval(() => { if (!document.hidden) this.worker.postMessage({ type: "live" }); }, 180000);
    this.focusKey = null;
    this.dimmed = false;
    this.seen = new Set();
    this.listeners = new Set();
    this.asks = new Map(); this.askId = 0;
    this.byId = new Map();    // the worker's short line ids → line keys
    this.urls = [];
    this.lastSent = "";
    this.renderSoon = debounce(force => this.render(force), 120);
    this.worker.onmessage = ({ data: m }) => this.onWorker(m);
    this.worker.onerror = e => console.error("Network worker:", e.message);
  }
  on(fn) { this.listeners.add(fn); }
  onTick(fn) { (this.tickers ||= []).push(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  get loading() { return this.active + this.queue.length; }

  bucket() { return Math.max(6, Math.min(11, Math.floor(this.map.getZoom()))); }

  /** Ask for the tiles that cover the view (with a margin); drop the ones no longer wanted. */
  update() {
    // Far out (a country or more in view) nothing is loaded: too much to fetch and draw for a few
    // long-distance trains. And nothing new is asked for while the map is being moved.
    if (this.map.getZoom() < 7) { this.queue.length = 0; return this.render(); }
    const zq = this.bucket(), g = Math.max(4, zq - 1);
    // Zoomed to another level: what was kept for the old one is dropped (here and in the worker).
    if (this.zq !== zq) {
      if (this.zq != null) { for (const k of [...this.tiles.keys()]) if (!k.startsWith(zq + "/")) this.tiles.delete(k); this.worker.postMessage({ type: "forget", keep: zq }); }
      this.zq = zq;
    }
    const b = this.map.getBounds(), padX = (b.getEast() - b.getWest()) * 0.12, padY = (b.getNorth() - b.getSouth()) * 0.12;
    const [x0, y0] = tileOf(Math.max(-180, b.getWest() - padX), Math.min(85, b.getNorth() + padY), g);
    const [x1, y1] = tileOf(Math.min(179.999, b.getEast() + padX), Math.max(-85, b.getSouth() - padY), g);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, want = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = `${zq}/${g}/${x}/${y}`, st = this.tiles.get(key);
      if (!st || st === "failed" || st === "cancelled") want.push({ key, zq, x, y, g, depth: 0, box: tileBox(x, y, g), d: Math.hypot(x - cx, y - cy) });
    }
    want.sort((a, b) => a.d - b.d);
    want.length = Math.min(want.length, 12); // the nearest first; the rest when the map stops there
    this.queue = this.queue.filter(q => { if (q.zq === zq) return true; this.tiles.delete(q.key); return false; });
    for (const w of want) { this.tiles.set(w.key, "queued"); this.queue.push(w); }
    this.pump();
    this.render();
  }
  pump() {
    while (this.active < 4 && this.queue.length) {
      const t = this.queue.shift();
      this.active++;
      this.tiles.set(t.key, "loading");
      this.pending = this.pending || new Map();
      this.pending.set(t.key, t);
      this.worker.postMessage({ type: "tile", key: t.key, zq: t.zq, box: t.box });
    }
    this.emit();
  }
  onWorker(m) {
    if (m.type === "tile") {
      const t = this.pending.get(m.key); this.pending.delete(m.key);
      this.active--;
      this.tiles.set(m.key, m.status);
      if (m.status === "split" && t && t.depth < 3) {
        // Too dense for one request: its four quarters instead.
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const x = t.x * 2 + dx, y = t.y * 2 + dy, g = t.g + 1, key = `${t.zq}/${g}/${x}/${y}`;
          this.tiles.set(key, "queued");
          this.queue.unshift({ key, zq: t.zq, x, y, g, depth: t.depth + 1, box: tileBox(x, y, g) });
        }
      }
      if (m.status === "done") this.renderSoon(true);
      this.pump();
    } else if (m.type === "data") {
      for (const l of m.lines) {
        const r = ensureLine({ mode: l.mode, name: l.name, colour: l.raw, textColour: l.rawText, longName: l.longName, key: l.key });
        if (!r) continue;
        if (l.colour) r.colour = l.colour;
        if (l.bbox) r.bbox = l.bbox;
        r.wid = l.nid; this.byId.set(l.nid, r.key);
        for (const id of l.routes) r.routes.add(id);
        r.numStops = Math.max(r.numStops || 0, l.numStops); r.minZoom = Math.min(r.minZoom, l.minZoom);
      }
      for (const s of m.seen) this.seen.add(s);
      this.setData("network", m.network);
      this.setData("stations", m.stations);
      this.lastMs = m.ms;
      this.emit();
    } else if (m.type === "vehicles") {
      // Not while the map is being moved (redrawing them then makes panning stutter).
      if (this.map.isMoving() || this.map.isZooming()) return;
      this.vehicleCount = m.features.length;
      for (const f of m.features) { const c = f.properties.c; if (!/^#[0-9a-fA-F]{6}$/.test(c)) f.properties.c = "#5F6368"; f.properties.d = isDarkText(f.properties.c) ? 1 : 0; }
      this.map.getSource("vehicles")?.setData({ type: "FeatureCollection", features: m.features });
      for (const fn of this.tickers || []) fn();
    } else if (m.type === "reset") {
      // The worker let go of everything (it had grown too big): ask again for what's in view.
      this.tiles.clear(); this.queue.length = 0; this.pending?.clear(); this.active = 0;
      this.update();
    } else if (m.type === "error") {
      console.error("Network worker:", m.message);
    } else if (m.type === "answer") {
      this.asks.get(m.id)?.(m.result); this.asks.delete(m.id);
    }
  }
  setData(name, buf) {
    // While the map moves, new data waits for it to stop (swapping it in mid-gesture makes it stutter).
    if (this.map.isMoving()) {
      (this.waiting ||= new Map()).set(name, buf);
      if (!this.waitHooked) { this.waitHooked = true; this.map.once("moveend", () => { this.waitHooked = false; const w = this.waiting; this.waiting = null; for (const [n, b] of w) this.setData(n, b); }); }
      return;
    }
    const src = this.map.getSource(name);
    // Not on the map yet (the style is still loading): ask again once it is.
    if (!src) { if (!this.waitingStyle) { this.waitingStyle = true; this.map.once("style.load", () => { this.waitingStyle = false; this.render(true); }); } return; }
    const url = URL.createObjectURL(new Blob([buf], { type: "application/json" }));
    src.setData(url);
    this.urls.push(url);
    while (this.urls.length > 6) URL.revokeObjectURL(this.urls.shift());
  }
  /** Ask the worker to rebuild the map data — only when something that matters changed, or the
   *  view left the area built last time (the worker builds three screens around the view). */
  render(force = false) {
    const b = this.map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
    const inside = this.box && w >= this.box[0] && e <= this.box[2] && s >= this.box[1] && n <= this.box[3];
    const opts = { zoom: Math.floor(this.map.getZoom()), bucket: this.bucket(), enabled: [...this.enabled].sort(), spread: this.spread, liveOnly: this.liveOnly, vehicles: this.vehicles };
    const sig = JSON.stringify(opts);
    if (!force && sig === this.lastSent && inside) return;
    const dx = e - w, dy = n - s;
    this.box = [w - dx, Math.max(-85, s - dy), e + dx, Math.min(85, n + dy)];
    this.lastSent = sig;
    this.worker.postMessage({ type: "render", opts: { ...opts, box: this.box } });
  }
  ask(q, args) { return new Promise(res => { const id = ++this.askId; this.asks.set(id, res); this.worker.postMessage({ type: "query", id, q, args }); }); }

  /** Fade every line but one (a followed line), or everything (a planned trip). */
  setFocus(key, dimAll = false) { this.focusKey = key; this.dimmed = dimAll; this.applyFocus(); }
  applyFocus() {
    const m = this.map; if (!m.getLayer("net-lines")) return;
    const k = "\n" + (registry.get(this.focusKey)?.wid ?? "none") + "\n";
    const op = this.dimmed ? 0.2 : this.focusKey ? ["case", ["in", k, ["get", "lines"]], 1, 0.13] : 1;
    for (const id of ["net-lines", "net-casing"]) m.setPaintProperty(id, "line-opacity", op);
    m.setPaintProperty("net-rail-dash", "line-opacity", this.dimmed || this.focusKey ? 0 : 0.9);
    const sop = this.dimmed ? 0.4 : this.focusKey ? ["case", ["in", k, ["get", "lines"]], 1, 0.35] : 1;
    for (const id of ["stations", "stations-far"]) if (m.getLayer(id)) m.setPaintProperty(id, "icon-opacity", sop);
    for (const id of ["station-links", "station-links-casing"]) m.setPaintProperty(id, "line-opacity", sop);
    m.setPaintProperty("station-labels", "text-opacity", sop);
    if (m.getLayer("vehicles")) {
      const vop = this.dimmed ? 0.35 : this.focusKey ? ["case", ["==", ["get", "key"], this.focusKey], 1, 0.12] : 1;
      m.setPaintProperty("vehicles", "icon-opacity", vop); m.setPaintProperty("vehicle-glyphs", "icon-opacity", vop);
      m.setPaintProperty("vehicle-labels", "text-opacity", vop);
    }
  }

  // ---- Questions the interface asks (answered by the worker) ----
  async diagram(line, stops) {
    const r = await this.ask("diagram", { cls: line.cls, stops: stops.map(s => ({ key: s.key, lon: s.lon, lat: s.lat })) });
    // One badge per line name (feeds list some lines twice, in different colours), never the line itself.
    const get = ks => {
      const seen = new Set(), out = [];
      for (const l of ks.map(k => registry.get(k))) {
        if (!l || !this.enabled.has(l.cls) || (l.cls === line.cls && l.name === line.name)) continue;
        // On a rail, metro or tram line, the changes worth showing are to other rail, metro, tram and ferry lines.
        if (line.cls !== "bus" && l.cls === "bus") continue;
        // Main-line trains are numbered per train ("IC 2172"): one "Rail" badge stands for all of them.
        if (l.cls === "train" && MAINLINE.has(l.mode)) {
          if (!seen.has("rail")) { seen.add("rail"); out.push(ensureLine({ mode: "RAIL", name: "Rail", colour: "5E6772", key: "train|Rail@any" })); }
          continue;
        }
        const k = l.cls + "|" + l.name;
        if (!seen.has(k)) { seen.add(k); out.push(l); }
      }
      return out;
    };
    return { meet: r.meet.map(get), along: r.along.map(get) };
  }
  async linesInView() {
    const b = this.map.getBounds();
    const keys = await this.ask("inview", { box: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
    return keys.map(k => registry.get(k)).filter(Boolean);
  }
  group(key) { return this.ask("group", { key }); }
  /** Every loaded variant of a line, as station sequences, and whether each runs now. */
  variants(key) { return this.ask("variants", { key }); }
  gids(keys) { return this.ask("gids", { keys }); }
  /** The line as drawn on the map right now (pairs of points), for highlighting it. */
  shape(key) { return this.ask("shape", { key }); }
  /** Line keys from a map feature's "lines" property. */
  keysOf(prop) { return String(prop || "").split("\n").filter(Boolean).map(id => this.byId.get(+id)).filter(Boolean); }
}
