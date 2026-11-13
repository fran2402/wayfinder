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

import { ensureLine, colourOf, registry, byBase, baseKey, WIDTH, GROUP, CLASS_ORDER, compareLines, classOf, TRAIN_GREY, BUS_BLUE, rankLines } from "./lines.js";

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
/** Far out only the big networks: metro from zoom 8, trams from 10, buses from 13. */
const DRAW_FROM = { train: 0, metro: 8, tram: 10, ferry: 8, other: 12, bus: 13 };

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
  edge(a, b, routes, touched) {
    if (a === b) return;
    const k = a < b ? a * 67108864 + b : b * 67108864 + a;
    let e = this.edges.get(k);
    if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), routes: new Set() }; this.edges.set(k, e); this.nodes[a].edges.push(e); this.nodes[b].edges.push(e); }
    for (const r of routes) e.routes.add(r);
    touched?.push(e);
  }
  /** Lay a shape (mercator points) onto the graph, inside a box, for some route variants.
   *  A gap longer than maxJump between two points is a broken shape, not a road: it's skipped. */
  add(pts, routes, box, maxJump) {
    const step = this.r * 0.7, touched = [];
    let prev = -1, prev2 = -1;
    const visit = (x, y) => {
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) { prev = prev2 = -1; return; }
      const n = this.node(x, y);
      if (n === prev) return;
      if (n === prev2) { prev = n; return; } // jitter between two nodes
      if (prev >= 0) this.edge(prev, n, routes, touched);
      prev2 = prev; prev = n;
    };
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === 0) { visit(x, y); continue; }
      const [px, py] = pts[i - 1];
      // Pieces wholly outside the box (most of a long-distance train's route) cost nothing.
      if ((x < box[0] && px < box[0]) || (x > box[2] && px > box[2]) || (y < box[1] && py < box[1]) || (y > box[3] && py > box[3])) { prev = prev2 = -1; continue; }
      const len = Math.hypot(x - px, y - py);
      if (len > maxJump) { prev = prev2 = -1; visit(x, y); continue; }
      const k = Math.ceil(len / step);
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
const variants = new Map();    // route index → { idx, line, seq:[station], pairs:Set("stopId>stopId"), run }
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

/** The line of this name in this area: lines of one name far apart (every city has a "1") are
 *  different lines; a route joins the instance whose stops are within ~20 km of its own. */
function regionalLine(fields, pts) {
  const cls = classOf(fields.mode);
  if (!cls || !pts.length) return null;
  const name = String(fields.name || fields.longName || "?").trim(), base = baseKey(cls, name);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) { box[0] = Math.min(box[0], p.lon); box[1] = Math.min(box[1], p.lat); box[2] = Math.max(box[2], p.lon); box[3] = Math.max(box[3], p.lat); }
  const near = b => b[0] - 0.28 <= box[2] && b[2] + 0.28 >= box[0] && b[1] - 0.18 <= box[3] && b[3] + 0.18 >= box[1];
  const list = (byBase.get(base) || []).filter(l => l.bbox && l.region != null);
  let line = list.find(l => near(l.bbox));
  if (!line) {
    line = ensureLine({ ...fields, key: `${base}@${list.length}` });
    line.region = list.length; line.bbox = [...box];
  } else {
    ensureLine({ ...fields, key: line.key });
    line.bbox = [Math.min(line.bbox[0], box[0]), Math.min(line.bbox[1], box[1]), Math.max(line.bbox[2], box[2]), Math.max(line.bbox[3], box[3])];
  }
  return line;
}

function station(s) {
  const key = s.parentId || s.stopId;
  let st = stations.get(key);
  if (!st) { st = { key, name: s.name, lon: s.lon, lat: s.lat, lines: new Set(), routes: new Set(), gid: null }; stations.set(key, st); groupsDirty = true; }
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
    const pts = r.segments.flatMap(sg => [d.stops[sg.from], d.stops[sg.to]]).filter(Boolean);
    const line = regionalLine({ mode: r.mode, name: tr.shortName, colour: colourOfRoute.get(ri), longName: tr.longName }, pts);
    if (!line) return null;
    seen.add(line.cls);
    line.routes.add(r.routeIdx);
    if (zq < line.minZoom) line.minZoom = zq;
    line.numStops = Math.max(line.numStops || 0, r.numStops || 0);
    dirty.add(line);
    // The variant: its stops in order, and its stop-to-stop hops (to tell whether it runs now).
    // A tile only carries the part of a route inside it: pieces from several tiles add up.
    let v = variants.get(r.routeIdx);
    if (r.segments.length) {
      if (!v) { v = { idx: r.routeIdx, line, seq: [], pairs: new Set(), run: true, numStops: r.numStops || 0 }; variants.set(r.routeIdx, v); }
      const ids = [r.segments[0].from, ...r.segments.map(x => x.to)], piece = [];
      ids.forEach((si, k) => { const st = stops[si]; if (st && st !== piece[piece.length - 1]) piece.push(st); if (k) v.pairs.add(d.stops[ids[k - 1]].stopId + ">" + d.stops[si].stopId); });
      if (piece.length > v.seq.length) v.seq = piece;
      for (const st of piece) { st.lines.add(line); st.routes.add(v); }
    }
    for (const sg of r.segments) {
      const a = stops[sg.from], b = stops[sg.to];
      if (!a || !b || a === b) continue;
      const pk = GROUP[line.cls] + "|" + (a.key < b.key ? a.key + ">" + b.key : b.key + ">" + a.key);
      if (!pairs.has(pk)) pairs.set(pk, new Set());
      pairs.get(pk).add(line);
    }
    return v || null;
  });
  // Shapes: each polyline once, with every line that uses it, per kind of way.
  const copies = new Map();
  const lay = (p, byGroup) => {
    const pts = decode(p.polyline.points, p.polyline.precision ?? 6);
    if (pts.length < 2) return;
    // Feeds often carry near-copies of one shape (same ends, same length): lay it down once.
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    const [a, b] = [pts[0], pts[pts.length - 1]], q = v => Math.round(v / 60);
    const stretch = 1 / Math.cos(ilat(a[1]) * RAD); // mercator metres per metre here
    for (const [g, vs] of byGroup) {
      const dk = g + "|" + q(a[0]) + "," + q(a[1]) + "|" + q(b[0]) + "," + q(b[1]) + "|" + Math.round(Math.log(len + 1) * 12);
      const known = copies.get(dk);
      if (known) { for (const e of known) for (const v of vs) e.routes.add(v); continue; }
      const maxJump = (g === "rail" || g === "water" ? 8000 : 1200) * stretch;
      copies.set(dk, graphFor(zq, g).add(pts, vs, mbox, maxJump));
    }
  };
  // Bus shapes are most of the work and only drawn from zoom 13: trains, metros and trams are laid
  // down (and drawn) first, the buses right after, in slices.
  let buses = 0;
  d.polylines.forEach(p => {
    const byGroup = new Map();
    let onlyBus = true;
    for (const ri of p.routeIndexes) {
      const v = lineOf[ri]; if (!v) continue;
      if (v.line.cls !== "bus") onlyBus = false;
      const g = GROUP[v.line.cls];
      if (!byGroup.has(g)) byGroup.set(g, new Set());
      byGroup.get(g).add(v);
    }
    if (!byGroup.size) return;
    if (onlyBus) { later.push(() => lay(p, byGroup)); buses++; } else lay(p, byGroup);
  });
  if (buses) { later.push("render"); setTimeout(pumpLater, 0); }
}
const later = [];
let pumping = false;
function pumpLater() {
  if (pumping) return;
  pumping = true;
  const t0 = performance.now();
  let draw = false;
  while (later.length && performance.now() - t0 < 60) { const job = later.shift(); if (job === "render") { draw = true; break; } job(); }
  pumping = false;
  if (draw && opts.zoom >= DRAW_FROM.bus) render();
  if (later.length) setTimeout(pumpLater, 0);
}

/* ------------------------------ Stations with the same name ------------------------------ */

const STOPWORDS = new Set(["s", "u", "s+u", "bhf", "bf", "station", "stn", "stop", "bahnhof", "gare", "stazione", "estacion", "platform", "gleis", "the",
  "hoofdstation", "centraal", "central", "centrale", "hauptbahnhof", "hbf", "busstation", "bus", "tram"]);
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
  // "Groningen" isn't "Groningen, Zuiderdiep": a one-word name only matches itself.
  if (small.size === 1 && big.size > 1) return false;
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

let opts = { zoom: 13, bucket: 11, spread: true, liveOnly: true, enabledSet: new Set(["train", "metro", "tram", "bus", "ferry", "other"]), box: [-180, -85, 180, 85], mbox: [-2e7, -2e7, 2e7, 2e7] };
/* Lines running right now: every vehicle on the move in a tile (from now to 30 minutes ahead),
   by kind and name. A line with nothing running isn't drawn, and neither are its stops. */
const live = new Map();          // tile key → { box, names:Set } | { box, failed:true }
let running = new Set();         // "cls|name" running in the tiles whose live data arrived
const unknown = new Map();       // tile key → box, while its live data hasn't arrived (or failed): lines there are drawn meanwhile
let runningHops = new Set();     // "stopId>stopId" hops vehicles are making now
let runDirty = true;
const norm = n => String(n || "").toLowerCase().replace(/\s+/g, "");
function recomputeRunning() {
  const vals = [...live.values()];
  running = new Set(vals.filter(v => !v.failed).flatMap(v => [...v.names]));
  for (const [k, v] of live) if (v.failed) unknown.set(k, v.box); else unknown.delete(k);
  runningHops = new Set(vals.flatMap(v => v.hops ? [...v.hops] : []));
  runDirty = true;
}
/** Which variants run now: a vehicle is on one of their hops. A line none of whose loaded variants
 *  shows a vehicle (but whose name does) keeps all its variants. */
function markRunning() {
  if (!runDirty) return;
  runDirty = false;
  for (const l of registry.values()) l.anyRun = false;
  for (const v of variants.values()) {
    v.run = false;
    for (const h of v.pairs) if (runningHops.has(h)) { v.run = true; break; }
    if (v.run) v.line.anyRun = true;
  }
}
// A line is drawn while it isn't known yet whether it runs (its area's live data is still on its way).
const inUnknown = l => { if (!l.bbox) return true; for (const b of unknown.values()) if (b[0] <= l.bbox[2] && b[2] >= l.bbox[0] && b[1] <= l.bbox[3] && b[3] >= l.bbox[1]) return true; return false; };
// These are asked thousands of times per build: each answer is kept until something changes (stamp).
let stamp = 1;
const fresh = () => { stamp++; };
const runKey = l => l.rk || (l.rk = l.cls + "|" + norm(l.name));
const unk = l => { if (l.us !== stamp) { l.us = stamp; l.uv = inUnknown(l); } return l.uv; };
const isRunning = l => !opts.liveOnly || running.has(runKey(l)) || unk(l);
const variantRuns = v => !opts.liveOnly || (isRunning(v.line) && (v.run || !v.line.anyRun || unk(v.line)));
const visible = l => { if (l.vs !== stamp) { l.vs = stamp; l.vv = opts.enabledSet.has(l.cls) && l.minZoom <= opts.bucket && opts.zoom >= DRAW_FROM[l.cls] && isRunning(l); } return l.vv; };
const shownVariant = v => { if (v.ss !== stamp) { v.ss = stamp; v.sv = visible(v.line) && variantRuns(v); } return v.sv; };

function buildNetwork() {
  const out = [];
  for (const [gk, g] of graphs) {
    if (+gk.split("|")[0] !== opts.bucket) continue;
    // Each edge's visible members: lines that look alike (same kind and colour) share one stroke.
    const sig = new Map(), [bx0, by0, bx1, by1] = opts.mbox, inBox = n => n.x >= bx0 && n.x <= bx1 && n.y >= by0 && n.y <= by1;
    for (const e of g.edges.values()) {
      if (!inBox(g.nodes[e.a]) && !inBox(g.nodes[e.b])) continue;
      // One stroke per line name (feeds disagree on colours: "S3" twice) and per look (same kind, same colour).
      const byName = new Map(), byLook = new Map(), ls0 = new Set();
      for (const v of e.routes) if (shownVariant(v)) ls0.add(v.line);
      for (const l of ls0) {
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
      const ls = [...new Set([...st.routes].filter(shownVariant).map(v => v.line))];
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
  return { key: l.key, nid: l.nid, bbox: l.bbox, cls: l.cls, mode: l.mode, name: l.name, raw: l.raw, rawText: l.rawText, longName: l.longName, colour: l.colour,
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
    markRunning();
    fresh();
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
  unknown.set(t.key, t.box);
  loadLive(t); // what runs there, at the same time as the lines themselves
  try {
    const url = `${API}/experimental/map/routes?zoom=${t.zq}&min=${f(s)},${f(w)}&max=${f(n)},${f(e)}&language=en`;
    // Lines change rarely: an area fetched in the last 6 hours comes straight from the browser's cache.
    let cache = null, d = null;
    try { cache = await caches.open("wayfinder-routes-v1"); const hit = await cache.match(url); if (hit && Date.now() - +hit.headers.get("x-at") < 6 * 36e5) d = await hit.json(); } catch { cache = null; }
    const res = d ? null : await fetch(url, { signal: ctrl.signal });
    if (res && !res.ok) {
      let msg = String(res.status);
      try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
      postMessage({ type: "tile", key: t.key, status: /too many/i.test(msg) ? "split" : "failed" });
      return;
    }
    if (!d) {
      const text = await res.text();
      d = JSON.parse(text);
      if (cache) cache.put(url, new Response(text, { headers: { "content-type": "application/json", "x-at": String(Date.now()) } }))
        .then(async () => { const ks = await cache.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - 14))) cache.delete(k); }).catch(() => {});
    }
    // Grown too big (a long session over many places): let go of everything and start again from
    // what's in view (mostly from the browser's cache).
    if (stations.size > 60000 || [...graphs.values()].reduce((a, g) => a + g.nodes.length, 0) > 1500000) {
      for (const c of inflight.values()) c.abort();
      graphs.clear(); stations.clear(); pairs.clear(); variants.clear(); live.clear(); unknown.clear(); groups.clear(); later.length = 0;
      groupsDirty = true; recomputeRunning();
      postMessage({ type: "reset" });
      return;
    }
    try { ingest(d, t.zq, t.box); } catch (err) { postMessage({ type: "error", message: String(err && err.stack || err) }); }
    runDirty = true;
    render(); // draw this tile's lines now, without waiting for the rest
    postMessage({ type: "tile", key: t.key, status: "done" });
  } catch (err) {
    postMessage({ type: "tile", key: t.key, status: err.name === "AbortError" ? "cancelled" : "failed" });
  } finally { inflight.delete(t.key); }
}

async function loadLive(t) {
  const [w, s, e, n] = t.box, f = v => v.toFixed(5), now = Date.now();
  const from = new Date(now - 5 * 60000).toISOString(), to = new Date(now + 30 * 60000).toISOString();
  try {
    const res = await fetch(`${API}/v6/map/trips?zoom=${t.zq}&min=${f(s)},${f(w)}&max=${f(n)},${f(e)}&startTime=${from}&endTime=${to}&precision=5&language=en`);
    if (!res.ok) throw new Error(res.status);
    const names = new Set(), hops = new Set(), trips = new Map();
    for (const seg of await res.json()) {
      const cls = classOf(seg.mode);
      if (!cls) continue;
      if (seg.from?.stopId && seg.to?.stopId) hops.add(seg.from.stopId + ">" + seg.to.stopId);
      // For the moving vehicles: each trip's hops with their times and shapes.
      const tr0 = seg.trips[0];
      if (tr0 && seg.polyline) {
        if (!trips.has(tr0.tripId)) trips.set(tr0.tripId, { id: tr0.tripId, mode: seg.mode, name: tr0.routeShortName || tr0.displayName, colour: seg.routeColor, rt: seg.realTime, hops: [] });
        trips.get(tr0.tripId).hops.push({ t0: Date.parse(seg.departure), t1: Date.parse(seg.arrival), poly: seg.polyline, from: seg.from });
      }
      for (const tr of seg.trips) {
        const dn = norm(tr.routeShortName || tr.displayName);
        names.add(cls + "|" + dn);
        // Trains are often shown as "IC 1234" but named "1234" (or the other way round).
        if (cls === "train") { const parts = String(tr.displayName || "").trim().split(/\s+/); names.add(cls + "|" + norm(parts[parts.length - 1])); }
      }
    }
    for (const tr of trips.values()) tr.hops.sort((a, b) => a.t0 - b.t0);
    live.set(t.key, { box: t.box, zq: t.zq, names, hops, trips, at: now });
  } catch {
    live.set(t.key, { box: t.box, zq: t.zq, failed: true, at: now });
    // The live service is busy at times: try again soon (a few times), not only at the next refresh.
    const tries = (t.tries || 0) + 1;
    if (tries <= 3) setTimeout(() => { if (live.get(t.key)?.failed) loadLive({ ...t, tries }); }, 15000 * tries);
  }
  recomputeRunning();
  render();
}

/* ------------------------------ Moving vehicles ------------------------------ */

function decodeLL(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (let w = 0; w < 2; w++) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const dd = result & 1 ? ~(result >> 1) : result >> 1;
      if (w === 0) lat += dd; else lon += dd;
    }
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}
function along(h, f) {
  if (!h.pts) { h.pts = decodeLL(h.poly); h.cum = [0]; for (let i = 1; i < h.pts.length; i++) h.cum.push(h.cum[i - 1] + Math.hypot(h.pts[i][0] - h.pts[i - 1][0], h.pts[i][1] - h.pts[i - 1][1])); }
  const L = h.cum[h.cum.length - 1] * Math.max(0, Math.min(1, f));
  let i = 1; while (i < h.cum.length - 1 && h.cum[i] < L) i++;
  const a = h.pts[i - 1], b = h.pts[i] || a, seg = (h.cum[i] - h.cum[i - 1]) || 1, k = (L - h.cum[i - 1]) / seg;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
/** Where every vehicle in view is now: along its current hop, or waiting at the stop it reached. */
function vehicles() {
  if (!opts.vehicles) return [];
  const now = Date.now(), [bw, bs, be, bn] = opts.box, out = [], seenTrips = new Set();
  for (const v of live.values()) {
    if (!v.trips || v.zq !== opts.bucket) continue;
    for (const tr of v.trips.values()) {
      if (seenTrips.has(tr.id)) continue;
      let h = tr.hops.find(x => x.t0 <= now && now <= x.t1), f;
      if (h) f = (now - h.t0) / Math.max(1, h.t1 - h.t0);
      else { h = tr.hops.filter(x => x.t1 < now && now - x.t1 < 150000).pop(); f = 1; }
      if (!h) continue;
      const cls = classOf(tr.mode);
      if (!opts.enabledSet.has(cls) || opts.zoom < DRAW_FROM[cls]) continue;
      const p = along(h, f);
      // Which way it's heading: towards a point a little further along (or from a little before, at the end).
      const q = f < 0.97 ? along(h, Math.min(1, f + 0.03)) : p, o = f < 0.97 ? p : along(h, 0.97);
      const dx = (q[0] - o[0]) * Math.cos(p[1] * RAD), dy = q[1] - o[1];
      const brg = dx || dy ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : 0;
      if (p[0] < bw || p[0] > be || p[1] < bs || p[1] > bn) continue;
      seenTrips.add(tr.id);
      // The line it belongs to: that name's instance around here.
      const base = baseKey(cls, String(tr.name || "?").trim());
      const line = (byBase.get(base) || []).find(l => l.bbox && p[0] > l.bbox[0] - 0.3 && p[0] < l.bbox[2] + 0.3 && p[1] > l.bbox[1] - 0.2 && p[1] < l.bbox[3] + 0.2);
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: p },
        properties: { trip: tr.id, n: tr.name, key: line?.key || "", c: line ? drawColour(line) === TRAIN_GREY ? TRAIN_GREY : colourOf(line) : (tr.colour ? "#" + tr.colour : TRAIN_GREY), rt: tr.rt ? 1 : 0, cls, b: Math.round(brg) } });
    }
  }
  return out;
}
setInterval(() => { if (opts.vehicles && live.size) postMessage({ type: "vehicles", features: vehicles() }); }, 2000);

function query(q, a) {
  markRunning();
  fresh();
  const linesNear = (lon, lat, radius) => {
    const out = new Set(), cosl = Math.cos(lat * RAD);
    for (const st of stations.values()) {
      if (Math.abs(st.lat - lat) > 0.006 || Math.abs(st.lon - lon) > 0.009) continue;
      if (Math.hypot((st.lon - lon) * 111320 * cosl, (st.lat - lat) * 110540) <= radius) for (const v of st.routes) if (variantRuns(v)) out.add(v.line.key);
    }
    return [...out];
  };
  if (q === "diagram") {
    const g = GROUP[a.cls];
    return {
      meet: a.stops.map(s => linesNear(s.lon, s.lat, 150)),
      along: a.stops.slice(0, -1).map((s, i) => {
        const b = a.stops[i + 1].key, k = g + "|" + (s.key < b ? s.key + ">" + b : b + ">" + s.key);
        return [...(pairs.get(k) || [])].filter(isRunning).map(l => l.key);
      }),
    };
  }
  if (q === "inview") {
    const [w, s, e, n] = a.box, out = new Set();
    for (const st of stations.values()) if (st.lon >= w && st.lon <= e && st.lat >= s && st.lat <= n) for (const l of st.lines) if (visible(l)) out.add(l.key);
    return [...out];
  }
  if (q === "variants") {
    // Every loaded variant of a line, as station sequences (stops with one name are one station).
    regroup();
    const l = registry.get(a.key);
    if (!l) return [];
    return [...l.routes].map(i => variants.get(i)).filter(Boolean).map(v => ({ idx: v.idx, run: variantRuns(v), n: v.numStops, sig: v.seq.map(st => st.key).join(">") }));
  }
  if (q === "gids") {
    // Stops → stations (stops with one name are one station), for a line diagram.
    regroup();
    return a.keys.map(k => { const st = stations.get(k); return st ? { gid: st.gid, name: groups.get(st.gid)?.name || st.name } : null; });
  }
  if (q === "shape") {
    // The line as drawn on the map (its running variants), for highlighting.
    const out = [];
    for (const [gk, g] of graphs) {
      if (+gk.split("|")[0] !== opts.bucket) continue;
      for (const e of g.edges.values()) {
        for (const v of e.routes) if (v.line.key === a.key && variantRuns(v)) { out.push([ll([g.nodes[e.a].x, g.nodes[e.a].y]), ll([g.nodes[e.b].x, g.nodes[e.b].y])]); break; }
      }
    }
    return out;
  }
  if (q === "group") { regroup(); const st = stations.get(a.key); const g = st && groups.get(st.gid); return g ? { name: g.name, keys: g.members.map(m => m.key) } : null; }
  return null;
}

globalThis.onmessage = ({ data: m }) => {
  if (m.type === "tile") loadTile(m);
  else if (m.type === "cancel") inflight.get(m.key)?.abort();
  else if (m.type === "forget") {
    // Another zoom level now: its corridor graphs and live data go (stops and lines stay, they're small).
    for (const k of [...graphs.keys()]) if (+k.split("|")[0] !== m.keep) graphs.delete(k);
    for (const [k, v] of live) if (v.zq !== m.keep) { live.delete(k); unknown.delete(k); }
    later.length = 0;
    recomputeRunning();
  }
  else if (m.type === "live") {
    // Refresh what's running, for the tiles around the view.
    const [bw, bs, be, bn] = opts.box;
    for (const [key, v] of live) {
      if (v.zq !== opts.bucket || v.box[2] < bw || v.box[0] > be || v.box[3] < bs || v.box[1] > bn) continue;
      loadLive({ key, box: v.box, zq: v.zq });
    }
  }
  else if (m.type === "render") {
    const b = m.opts.box;
    opts = { ...m.opts, enabledSet: new Set(m.opts.enabled), mbox: [mx(b[0]), my(b[1]), mx(b[2]), my(b[3])] };
    fresh();
    render();
  }
  else if (m.type === "query") postMessage({ type: "answer", id: m.id, result: query(m.q, m.args) });
  else if (m.type === "lines") for (const l of m.lines) { const r = registry.get(l.key); if (r && !r.colour && l.colour) r.colour = l.colour; }
};
