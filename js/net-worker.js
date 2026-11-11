// The transit network, built off the main thread so the map never stutters.
//
// 1. Lines arrive per map tile from Transitous ("routes": stop-to-stop shapes, shared between routes).
// 2. Every shape is sampled every few metres and snapped onto a graph of corridor nodes: a sample
//    joins an existing node within a few metres, or starts a new one. Lines running along the same
//    street or track therefore share the same edges, wherever their stops are.
// 3. Edges with the same set of lines are chained into long paths, smoothed, oriented the same way,
//    and each line gets its own offset: glued side by side, like a metro map.
// 4. Stops are grouped into stations; stops with the same name within a short walk are one station,
//    joined by interchange connectors.
// The finished map data goes back as JSON bytes, which the map reads in its own worker.

import { ensureLine, colourOf, registry, WIDTH, GROUP, CLASS_ORDER, compareLines, classOf, TRAIN_GREY, BUS_BLUE, rankLines } from "./lines.js";

/** Main-line trains (regional, long distance, night) are one grey track on the map, as on metro maps;
 *  suburban rail and metros keep their own colours. Badges keep every line's real colour. */
const MAINLINE = new Set(["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "LONG_DISTANCE", "HIGHSPEED_RAIL", "NIGHT_RAIL", "RAIL"]);
const drawColour = l => l.cls === "train" && MAINLINE.has(l.mode) ? TRAIN_GREY : colourOf(l);
const MAX_STROKES = 8;

const API = "https://api.transitous.org/api";
const R = 6378137, RAD = Math.PI / 180;
const mx = lon => R * lon * RAD;
const my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
const ilon = x => x / R / RAD;
const ilat = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / RAD;

/** Snap radius (mercator metres) per request zoom: wide far out, tight close in. */
const SNAP = { 6: 900, 7: 600, 8: 320, 9: 160, 10: 70, 11: 22 };
/** Far out only the big networks; buses appear from zoom 11, trams from 9. */
const DRAW_FROM = { train: 0, metro: 8, tram: 9, ferry: 8, other: 11, bus: 11 };

/* ------------------------------ Corridor graph ------------------------------ */

class Graph {
  constructor(r) { this.r = r; this.nodes = []; this.grid = new Map(); this.edges = new Map(); }
  cellKey(cx, cy) { return cx * 4194304 + cy; }
  node(x, y) {
    const r = this.r, cx = Math.floor(x / r), cy = Math.floor(y / r);
    // Fast path: most samples fall right next to a node in their own cell.
    const own = this.grid.get(this.cellKey(cx, cy));
    if (own) for (const id of own) { const n = this.nodes[id]; if ((n.x - x) ** 2 + (n.y - y) ** 2 < r * r * 0.3) return id; }
    let best = -1, bd = r * r;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = this.grid.get(this.cellKey(cx + dx, cy + dy));
      if (!list) continue;
      for (const id of list) { const n = this.nodes[id], d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = id; } }
    }
    if (best >= 0) return best;
    const id = this.nodes.length;
    this.nodes.push({ x, y, edges: [] });
    const k = this.cellKey(cx, cy);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(id);
    return id;
  }
  edge(a, b, lines, touched) {
    if (a === b) return;
    const k = a < b ? a * 67108864 + b : b * 67108864 + a;
    let e = this.edges.get(k);
    if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), lines: new Set() }; this.edges.set(k, e); this.nodes[a].edges.push(e); this.nodes[b].edges.push(e); }
    for (const l of lines) e.lines.add(l);
    touched?.push(e);
  }
  /** Lay a shape (mercator points) onto the graph, inside a box. */
  add(pts, lines, box) {
    const step = this.r * 0.7, touched = [];
    let prev = -1, prev2 = -1;
    const visit = (x, y) => {
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) { prev = prev2 = -1; return; }
      const n = this.node(x, y);
      if (n === prev) return;
      if (n === prev2) { prev = n; return; } // jitter between two nodes
      if (prev >= 0) this.edge(prev, n, lines, touched);
      prev2 = prev; prev = n;
    };
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === 0) { visit(x, y); continue; }
      const [px, py] = pts[i - 1];
      // Pieces wholly outside the box (most of a long-distance train's route) cost nothing.
      if ((x < box[0] && px < box[0]) || (x > box[2] && px > box[2]) || (y < box[1] && py < box[1]) || (y > box[3] && py > box[3])) { prev = prev2 = -1; continue; }
      const len = Math.hypot(x - px, y - py), k = Math.ceil(len / step);
      for (let j = 1; j <= k; j++) visit(px + (x - px) * j / k, py + (y - py) * j / k);
    }
    return touched;
  }
}

/* ------------------------------ State ------------------------------ */

const graphs = new Map();      // `${zq}|${group}` → Graph
const stations = new Map();    // stop key → { key, name, lon, lat, lines:Set, gid }
const pairs = new Map();       // `${group}|a>b` → Set(line): lines running between two stations
const seen = new Set();        // kinds of transport met
const dirty = new Set();       // lines to send to the main thread
let groupsDirty = true;
const groups = new Map();      // gid → { gid, name, members:[station] }

function graphFor(zq, group) {
  const k = zq + "|" + group;
  if (!graphs.has(k)) graphs.set(k, new Graph(SNAP[zq] || 22));
  return graphs.get(k);
}

function decode(str, precision = 6) {
  const f = 10 ** precision, out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (let w = 0; w < 2; w++) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (w === 0) lat += d; else lon += d;
    }
    out.push([mx(lon / f), my(lat / f)]);
  }
  return out;
}

function station(s) {
  const key = s.parentId || s.stopId;
  let st = stations.get(key);
  if (!st) { st = { key, name: s.name, lon: s.lon, lat: s.lat, lines: new Set(), gid: null }; stations.set(key, st); groupsDirty = true; }
  return st;
}

function ingest(d, zq, box) {
  const [w, s, e, n] = box, padX = (e - w) * 0.04, padY = (n - s) * 0.04;
  const mbox = [mx(w - padX), my(s - padY), mx(e + padX), my(n + padY)];
  const stops = d.stops.map(station);
  // Lines of this response, by route index.
  const colourOfRoute = new Map();
  for (const p of d.polylines) p.routeIndexes.forEach((ri, k) => { if (p.colors && p.colors[k]) colourOfRoute.set(ri, p.colors[k]); });
  const lineOf = d.routes.map((r, ri) => {
    if (!classOf(r.mode)) return null;
    const tr = r.transitRoutes[0] || {};
    const line = ensureLine({ mode: r.mode, name: tr.shortName, colour: colourOfRoute.get(ri), longName: tr.longName });
    if (!line) return null;
    seen.add(line.cls);
    line.routes.add(r.routeIdx);
    if (zq < line.minZoom) line.minZoom = zq;
    line.numStops = Math.max(line.numStops || 0, r.numStops || 0);
    dirty.add(line);
    for (const sg of r.segments) {
      const a = stops[sg.from], b = stops[sg.to];
      if (!a || !b || a === b) continue;
      a.lines.add(line); b.lines.add(line);
      const pk = GROUP[line.cls] + "|" + (a.key < b.key ? a.key + ">" + b.key : b.key + ">" + a.key);
      if (!pairs.has(pk)) pairs.set(pk, new Set());
      pairs.get(pk).add(line);
    }
    return line;
  });
  // Shapes: each polyline once, with every line that uses it, per kind of way.
  const copies = new Map();
  d.polylines.forEach(p => {
    const byGroup = new Map();
    for (const ri of p.routeIndexes) {
      const l = lineOf[ri]; if (!l || !d.routes[ri].segments.length) continue;
      const g = GROUP[l.cls];
      if (!byGroup.has(g)) byGroup.set(g, new Set());
      byGroup.get(g).add(l);
    }
    if (!byGroup.size) return;
    const pts = decode(p.polyline.points, p.polyline.precision ?? 6);
    if (pts.length < 2) return;
    // Feeds often carry near-copies of one shape (same ends, same length): lay it down once.
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    const [a, b] = [pts[0], pts[pts.length - 1]], q = v => Math.round(v / 60);
    for (const [g, ls] of byGroup) {
      const dk = g + "|" + q(a[0]) + "," + q(a[1]) + "|" + q(b[0]) + "," + q(b[1]) + "|" + Math.round(Math.log(len + 1) * 12);
      const known = copies.get(dk);
      if (known) { for (const e of known) for (const l of ls) e.lines.add(l); continue; }
      copies.set(dk, graphFor(zq, g).add(pts, ls, mbox));
    }
  });
}

/* ------------------------------ Stations with the same name ------------------------------ */

const STOPWORDS = new Set(["s", "u", "s+u", "bhf", "bf", "station", "stn", "stop", "bahnhof", "gare", "stazione", "estacion", "platform", "gleis", "the"]);
function tokens(name) {
  return new Set(name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9+]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t)));
}
function sameName(a, b) {
  if (a === b) return true;
  const ta = a.t || (a.t = tokens(a.name)), tb = b.t || (b.t = tokens(b.name));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (!small.size) return false;
  let chars = 0;
  for (const t of small) {
    // "kol" matches "kolodvor": abbreviations are common in stop names.
    if (!big.has(t) && !(t.length >= 3 && [...big].some(b => b.startsWith(t) || (b.length >= 3 && t.startsWith(b))))) return false;
    chars += t.length;
  }
  return chars >= 5 || small.size === big.size;
}
function regroup() {
  if (!groupsDirty) return;
  groupsDirty = false;
  const list = [...stations.values()], cell = 0.004, grid = new Map(), parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const st of list) {
    parent.set(st.key, st.key);
    const ck = Math.floor(st.lon / cell) + ":" + Math.floor(st.lat / cell);
    if (!grid.has(ck)) grid.set(ck, []);
    grid.get(ck).push(st);
  }
  for (const st of list) {
    const cx = Math.floor(st.lon / cell), cy = Math.floor(st.lat / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get((cx + dx) + ":" + (cy + dy)) || []) {
      if (o.key <= st.key) continue;
      const dm = Math.hypot((o.lon - st.lon) * 111320 * Math.cos(st.lat * RAD), (o.lat - st.lat) * 110540);
      if (dm < 330 && sameName(st, o)) parent.set(find(st.key), find(o.key));
    }
  }
  groups.clear();
  for (const st of list) {
    const gid = find(st.key);
    st.gid = gid;
    if (!groups.has(gid)) groups.set(gid, { gid, members: [] });
    groups.get(gid).members.push(st);
  }
  for (const g of groups.values()) {
    // The shortest name usually reads best ("Alexanderplatz", not "S+U Alexanderplatz Bhf (Berlin)").
    g.name = g.members.map(m => m.name).sort((a, b) => a.length - b.length)[0];
  }
}

/* ------------------------------ Building the map data ------------------------------ */

function smooth(pts, iterations) {
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (i > 0) out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      if (i < pts.length - 2) out.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
/** Drop points that add nothing (within tol metres of the straight line). */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ll = ([x, y]) => [Math.round(ilon(x) * 1e5) / 1e5, Math.round(ilat(y) * 1e5) / 1e5];

let opts = { zoom: 13, bucket: 11, spread: true, enabledSet: new Set(["train", "metro", "tram", "bus", "ferry", "other"]), box: [-180, -85, 180, 85], mbox: [-2e7, -2e7, 2e7, 2e7] };
const visible = l => opts.enabledSet.has(l.cls) && l.minZoom <= opts.bucket && opts.zoom >= DRAW_FROM[l.cls];

function buildNetwork() {
  const out = [];
  for (const [gk, g] of graphs) {
    if (+gk.split("|")[0] !== opts.bucket) continue;
    // Each edge's visible members: lines that look alike (same kind and colour) share one stroke.
    const sig = new Map(), [bx0, by0, bx1, by1] = opts.mbox, inBox = n => n.x >= bx0 && n.x <= bx1 && n.y >= by0 && n.y <= by1;
    for (const e of g.edges.values()) {
      if (!inBox(g.nodes[e.a]) && !inBox(g.nodes[e.b])) continue;
      // One stroke per line name (feeds disagree on colours: "S3" twice) and per look (same kind, same colour).
      const byName = new Map(), byLook = new Map();
      for (const l of e.lines) {
        if (!visible(l)) continue;
        const nk = l.cls + "|" + l.name, lk = l.cls + "|" + drawColour(l);
        let grp = byName.get(nk) || byLook.get(lk);
        if (!grp) grp = { c: drawColour(l), ls: [] };
        grp.ls.push(l);
        byName.set(nk, grp); if (!byLook.has(lk)) byLook.set(lk, grp);
      }
      if (!byName.size) continue;
      let members = [...new Set(byName.values())];
      // Never wider than MAX_STROKES: buses become one blue stroke first, then trams one stroke.
      for (const cls of ["bus", "tram"]) {
        if (members.length <= MAX_STROKES) break;
        const these = members.filter(x => x.ls[0].cls === cls);
        if (these.length < 2) continue;
        members = members.filter(x => x.ls[0].cls !== cls);
        members.push({ c: cls === "bus" ? BUS_BLUE : TRAIN_GREY, ls: these.flatMap(x => x.ls) });
      }
      members.forEach(x => x.ls.sort(compareLines));
      members.sort((a, b) => compareLines(a.ls[0], b.ls[0]));
      sig.set(e, { key: members.map(x => x.ls[0].cls + "|" + x.c).join(","), members });
    }
    // Chain edges with the same members through nodes where nothing else joins.
    const done = new Set();
    const nextEdge = (node, from, key) => {
      const es = g.nodes[node].edges.filter(x => sig.has(x));
      if (es.length !== 2) return null;
      const o = es[0] === from ? es[1] : es[0];
      return !done.has(o) && sig.get(o).key === key ? o : null;
    };
    for (const [e, s] of sig) {
      if (done.has(e)) continue;
      done.add(e);
      const path = [e.a, e.b];
      for (let end = 0; end < 2; end++) {
        let node = end ? path[path.length - 1] : path[0], from = e, o;
        while ((o = nextEdge(node, from, s.key))) {
          done.add(o);
          node = o.a === node ? o.b : o.a;
          if (end) path.push(node); else path.unshift(node);
          from = o;
          if (path.length > 5000) break;
        }
      }
      let pts = path.map(id => [g.nodes[id].x, g.nodes[id].y]);
      // One orientation for every path (west to east, else south to north), so a line keeps its side.
      const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1];
      if (dx < -Math.abs(dy) * 0.2 || (Math.abs(dx) <= Math.abs(dy) * 0.2 && dy < 0)) pts.reverse();
      pts = simplify(smooth(pts, 2), g.r * 0.08);
      const coords = pts.map(ll);
      const total = s.members.reduce((t, x) => t + WIDTH[x.ls[0].cls], 0);
      let acc = -total / 2;
      for (const x of s.members) {
        const l = x.ls[0], w = WIDTH[l.cls], off = opts.spread ? acc + w / 2 : 0;
        acc += w;
        out.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords },
          properties: { line: l.nid, lines: "\n" + x.ls.map(y => y.nid).join("\n") + "\n", c: x.c, w, off, s: 10 - CLASS_ORDER[l.cls], dash: x.c === TRAIN_GREY && l.cls === "train" ? 1 : 0 } });
      }
    }
  }
  return out;
}

const KIND_RANK = ["train", "metro", "ferry", "tram", "other", "bus"];
function buildStations() {
  regroup();
  const out = [];
  // Colours: lines without one avoid the colours of lines they meet.
  for (const st of stations.values()) for (const l of st.lines) if (!l.colour) colourOf(l, st.lines);
  const [bw, bs, be, bn] = opts.box;
  for (const g of groups.values()) {
    const m0 = g.members[0];
    if (m0.lon < bw || m0.lon > be || m0.lat < bs || m0.lat > bn) continue;
    const shown = [];
    for (const st of g.members) {
      const ls = [...st.lines].filter(visible);
      if (!ls.length) continue;
      const kinds = new Set(ls.map(l => l.cls));
      shown.push({ st, ls, kind: KIND_RANK.find(k => kinds.has(k)) });
    }
    if (!shown.length) continue;
    const all = new Set(shown.flatMap(x => x.ls)), n = all.size;
    // Stops of the same kind facing each other across a street: one marker between them.
    for (let i = 0; i < shown.length; i++) for (let j = shown.length - 1; j > i; j--) {
      const a = shown[i], b = shown[j];
      if (a.kind !== b.kind) continue;
      const dm = Math.hypot((a.st.lon - b.st.lon) * 111320 * Math.cos(a.st.lat * RAD), (a.st.lat - b.st.lat) * 110540);
      if (dm > 90) continue;
      a.st = { ...a.st, lon: (a.st.lon + b.st.lon) / 2, lat: (a.st.lat + b.st.lat) / 2 };
      a.ls = [...new Set([...a.ls, ...b.ls])];
      shown.splice(j, 1);
    }
    const lines = "\n" + [...all].map(l => l.nid).join("\n") + "\n";
    const rail = shown.some(x => x.kind === "train" || x.kind === "metro") ? 1 : 0;
    // The member with the most important mode carries the label.
    shown.sort((a, b) => KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind) || b.ls.length - a.ls.length);
    const keys = g.members.map(m => m.key).join("\n");
    shown.forEach((x, i) => out.push({ type: "Feature", geometry: { type: "Point", coordinates: [x.st.lon, x.st.lat] },
      properties: { key: x.st.key, gid: g.gid, keys, name: g.name, kind: x.kind, n, own: x.ls.length, rail, lbl: i === 0 ? 1 : 0, lines } }));
    // Interchange connectors between the stops of one station.
    for (let i = 1; i < shown.length; i++) {
      let best = shown[0], bd = Infinity;
      for (let j = 0; j < i; j++) { const d = (shown[j].st.lon - shown[i].st.lon) ** 2 + (shown[j].st.lat - shown[i].st.lat) ** 2; if (d < bd) { bd = d; best = shown[j]; } }
      if (bd < 1e-8) continue;
      out.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[best.st.lon, best.st.lat], [shown[i].st.lon, shown[i].st.lat]] },
        properties: { link: 1, rail, lines } });
    }
  }
  return out;
}

const enc = new TextEncoder();
const bytes = features => enc.encode(JSON.stringify({ type: "FeatureCollection", features })).buffer;

function lineInfo(l) {
  return { key: l.key, nid: l.nid, cls: l.cls, mode: l.mode, name: l.name, raw: l.raw, rawText: l.rawText, longName: l.longName, colour: l.colour,
    routes: [...l.routes].slice(0, 6), numStops: l.numStops || 0, minZoom: l.minZoom };
}

/* ------------------------------ Messages ------------------------------ */

const inflight = new Map();
let rendering = false, again = false;

async function render() {
  if (rendering) { again = true; return; }
  rendering = true;
  try {
    const t0 = performance.now();
    rankLines();
    const net = bytes(buildNetwork()), sta = bytes(buildStations());
    const lines = [...dirty].map(lineInfo); dirty.clear();
    postMessage({ type: "data", network: net, stations: sta, lines, seen: [...seen], ms: Math.round(performance.now() - t0) }, [net, sta]);
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.stack || err) });
  } finally {
    rendering = false;
    if (again) { again = false; setTimeout(render, 0); }
  }
}

async function loadTile(t) {
  const ctrl = new AbortController();
  inflight.set(t.key, ctrl);
  const [w, s, e, n] = t.box, f = v => v.toFixed(6);
  try {
    const res = await fetch(`${API}/experimental/map/routes?zoom=${t.zq}&min=${f(s)},${f(w)}&max=${f(n)},${f(e)}&language=en`, { signal: ctrl.signal });
    if (!res.ok) {
      let msg = String(res.status);
      try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
      postMessage({ type: "tile", key: t.key, status: /too many/i.test(msg) ? "split" : "failed" });
      return;
    }
    const d = await res.json();
    try { ingest(d, t.zq, t.box); } catch (err) { postMessage({ type: "error", message: String(err && err.stack || err) }); }
    postMessage({ type: "tile", key: t.key, status: "done" });
  } catch (err) {
    postMessage({ type: "tile", key: t.key, status: err.name === "AbortError" ? "cancelled" : "failed" });
  } finally { inflight.delete(t.key); }
}

function query(q, a) {
  const linesNear = (lon, lat, radius) => {
    const out = new Set(), cosl = Math.cos(lat * RAD);
    for (const st of stations.values()) {
      if (Math.abs(st.lat - lat) > 0.006 || Math.abs(st.lon - lon) > 0.009) continue;
      if (Math.hypot((st.lon - lon) * 111320 * cosl, (st.lat - lat) * 110540) <= radius) for (const l of st.lines) out.add(l.key);
    }
    return [...out];
  };
  if (q === "diagram") {
    const g = GROUP[a.cls];
    return {
      meet: a.stops.map(s => linesNear(s.lon, s.lat, 150)),
      along: a.stops.slice(0, -1).map((s, i) => {
        const b = a.stops[i + 1].key, k = g + "|" + (s.key < b ? s.key + ">" + b : b + ">" + s.key);
        return [...(pairs.get(k) || [])].map(l => l.key);
      }),
    };
  }
  if (q === "inview") {
    const [w, s, e, n] = a.box, out = new Set();
    for (const st of stations.values()) if (st.lon >= w && st.lon <= e && st.lat >= s && st.lat <= n) for (const l of st.lines) if (visible(l)) out.add(l.key);
    return [...out];
  }
  if (q === "group") { regroup(); const st = stations.get(a.key); const g = st && groups.get(st.gid); return g ? { name: g.name, keys: g.members.map(m => m.key) } : null; }
  return null;
}

globalThis.onmessage = ({ data: m }) => {
  if (m.type === "tile") loadTile(m);
  else if (m.type === "cancel") inflight.get(m.key)?.abort();
  else if (m.type === "render") {
    const b = m.opts.box;
    opts = { ...m.opts, enabledSet: new Set(m.opts.enabled), mbox: [mx(b[0]), my(b[1]), mx(b[2]), my(b[3])] };
    render();
  }
  else if (m.type === "query") postMessage({ type: "answer", id: m.id, result: query(m.q, m.args) });
  else if (m.type === "lines") for (const l of m.lines) { const r = registry.get(l.key); if (r && !r.colour && l.colour) r.colour = l.colour; }
};
