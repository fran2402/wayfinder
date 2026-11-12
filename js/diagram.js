// The whole line as a diagram, after the reference (a metro "strip map"):
//  - every running variant of the line merged into one picture: the trunk in the first column,
//    branches and short loops in columns beside it, joining where they share stations;
//  - stops are white: a small circle where nothing else calls, a capsule where you can change
//    (it spans every track that calls there), with short ticks for the lines crossing it;
//  - each end of a branch carries the line's badge;
//  - station names sit well to the right of the tracks, the lines you can change to at the far right.

import { badge, colourOf, compareLines } from "./lines.js";
import { esc, icon } from "./util.js";

const COL = 11, X0 = 14, TRACK = 4.4;

/** 8m33s, or 1h13m from an hour up. */
export function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h${String(Math.round(sec % 3600 / 60)).padStart(2, "0")}m`;
  return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
}

/**
 * Merge variants (each a list of stations { key, name, lon, lat }) into rows and tracks.
 * Returns { rows: [station], segs: [{ r0, r1, col }], span: [[min, max]] per row, ends: [{ row, up }], cols }.
 */
export function layoutLine(variantList) {
  const seqKey = s => ">" + s.map(x => x.key).join(">") + ">";
  // Longest first; drop variants that are part of another (short turns), in either direction.
  let seqs = variantList.map(v => v.stops.filter((x, i, a) => !i || x.key !== a[i - 1].key)).filter(s => s.length > 1).sort((a, b) => b.length - a.length);
  const kept = [];
  for (const s of seqs) {
    const f = seqKey(s), r = seqKey([...s].reverse());
    if (!kept.some(k => { const ks = seqKey(k); return ks.includes(f) || ks.includes(r); })) kept.push(s);
  }
  if (!kept.length) return null;
  // One direction for all: each variant runs the way the ones already placed do.
  const pos = new Map(), info = new Map();
  kept[0].forEach((x, i) => pos.set(x.key, i));
  const oriented = [kept[0]];
  const rest = kept.slice(1);
  while (rest.length) {
    rest.sort((a, b) => b.filter(x => pos.has(x.key)).length - a.filter(x => pos.has(x.key)).length);
    let s = rest.shift();
    const shared = s.map((x, i) => [i, pos.get(x.key)]).filter(([, p]) => p != null);
    if (shared.length >= 2) { if (shared[shared.length - 1][1] < shared[0][1]) s = [...s].reverse(); }
    else if (shared.length === 1) {
      // A branch touching the rest at one station: it flows in at the start, out at the end.
      const [i, p] = shared[0], mid = (Math.max(...pos.values()) + Math.min(...pos.values())) / 2;
      if ((p < mid && i < s.length / 2) || (p >= mid && i >= s.length / 2)) s = [...s].reverse();
    }
    // Positions for the new stations, between their neighbours.
    let last = null;
    s.forEach(x => { if (pos.has(x.key)) last = pos.get(x.key); else { last = (last ?? -1) + 0.001; pos.set(x.key, last); } });
    oriented.push(s);
  }
  // Stations and the hops between them.
  const prio = new Map(), out = new Map(), indeg = new Map();
  oriented.forEach((s, vi) => s.forEach((x, i) => {
    if (!prio.has(x.key)) { prio.set(x.key, [vi, i]); info.set(x.key, x); out.set(x.key, new Set()); indeg.set(x.key, 0); }
  }));
  for (const s of oriented) for (let i = 1; i < s.length; i++) {
    const a = s[i - 1].key, b = s[i].key;
    if (!out.get(a).has(b)) { out.get(a).add(b); indeg.set(b, indeg.get(b) + 1); }
  }
  // Rows: stations in travel order, a branch's stations together (Kahn's sort, trunk first).
  const order = [], left = new Set(prio.keys()), cmp = (a, b) => prio.get(a)[0] - prio.get(b)[0] || prio.get(a)[1] - prio.get(b)[1];
  while (left.size) {
    let ready = [...left].filter(k => indeg.get(k) === 0);
    if (!ready.length) ready = [...left]; // a loop: break it at the first station
    ready.sort(cmp);
    const k = ready[0];
    left.delete(k); order.push(k);
    for (const b of out.get(k)) indeg.set(b, indeg.get(b) - 1);
  }
  const row = new Map(order.map((k, i) => [k, i]));
  // Tracks: every hop is a vertical stretch in a column; a variant keeps its column while it can.
  const segs = new Map(), used = [];
  const free = (c, r0, r1) => !(used[c] || []).some(([a, b]) => Math.max(a, r0) < Math.min(b, r1));
  const nodeCols = new Map();
  oriented.forEach((s, vi) => {
    let prevCol = vi === 0 ? 0 : null;
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1].key, b = s[i].key, r0 = Math.min(row.get(a), row.get(b)), r1 = Math.max(row.get(a), row.get(b));
      const k = r0 + ":" + r1;
      let seg = segs.get(k);
      if (!seg) {
        const pref = prevCol ?? nodeCols.get(a)?.[0] ?? nodeCols.get(b)?.[0] ?? 0;
        let col = pref;
        for (let d = 0; d < 40; d++) { const tryCols = [pref + d, pref - d]; const c = tryCols.find(c => c >= 0 && free(c, r0, r1)); if (c != null) { col = c; break; } }
        (used[col] ||= []).push([r0, r1]);
        seg = { r0, r1, col };
        segs.set(k, seg);
      }
      for (const n of [a, b]) { if (!nodeCols.has(n)) nodeCols.set(n, []); nodeCols.get(n).push(seg.col); }
      prevCol = seg.col;
    }
  });
  const rows = order.map(k => info.get(k));
  const span = order.map(k => { const cs = nodeCols.get(k) || [0]; return [Math.min(...cs), Math.max(...cs)]; });
  // Ends of branches: stations with only one neighbour.
  const ends = [];
  order.forEach((k, r) => {
    const above = [...segs.values()].filter(s => s.r1 === r).length, below = [...segs.values()].filter(s => s.r0 === r).length;
    if (above + below === 1) ends.push({ row: r, up: below === 1, col: span[r][0] });
  });
  return { rows, segs: [...segs.values()], span, ends, cols: Math.max(1, ...[...segs.values()].map(s => s.col + 1)) };
}

/** Lines meeting the line at each row, for its badges and ticks. */
export async function meetings(line, lay, net) {
  const { meet } = await net.diagram(line, lay.rows);
  return meet.map(m => m.sort(compareLines));
}

export function lineDiagramHtml(line, lay, meet, { expanded, here, onTrip }) {
  const nameX = Math.max(84, X0 + lay.cols * COL + 22);
  const endUp = new Set(lay.ends.filter(e => e.up).map(e => e.row)), endDown = new Set(lay.ends.filter(e => !e.up).map(e => e.row));
  return `<div class="ldh"><b>Stops</b>${icon(line.cls === "bus" ? "bus" : line.cls === "train" ? "train" : line.cls === "metro" ? "metro" : "tram", "xs")}<span class="sp"></span><span>${lay.rows.length} stations${lay.ends.length > 2 ? ` · ${lay.ends.length} ends` : ""}</span></div>
  <div class="ldiagram" id="diagram" style="--name-x:${nameX}px">${lay.rows.map((st, i) => {
    const m = meet[i] || [], open = expanded.has(st.key), shown = open ? m : m.slice(0, 8), more = m.length - shown.length;
    const pt = endUp.has(i) ? 22 : 0, pb = endDown.has(i) ? 22 : 0;
    return `<div class="lrow${st.key === here || st.sk === here ? " here" : ""}${onTrip && !onTrip.has(st.key) ? " off" : ""}" data-stop="${esc(st.sk)}" data-name="${esc(st.name)}" tabindex="0" role="button" style="padding-top:${pt + 2}px;padding-bottom:${pb + 2}px">
      <span class="nm">${esc(st.name)}</span>
      <span class="bd">${shown.map(o => badge(o, "dot")).join("")}${more > 0 ? `<button class="more" data-more="${esc(st.key)}" aria-label="Show ${more} more lines">+${more}</button>` : ""}</span></div>`;
  }).join("")}<svg class="track" id="diagsvg" aria-hidden="true"></svg></div>`;
}

/** Draw the tracks once the rows are laid out, from their real positions. */
export function drawLineDiagram(line, lay, meet) {
  const box = document.getElementById("diagram"), svg = document.getElementById("diagsvg");
  if (!box || !svg) return;
  const rows = [...box.querySelectorAll(".lrow")];
  if (rows.length !== lay.rows.length) return;
  const ys = rows.map(r => { const n = r.querySelector(".nm"); return n.offsetTop + Math.min(n.offsetHeight, 18) / 2; });
  const W = X0 + lay.cols * COL + 8, H = box.offsetHeight, x = c => X0 + c * COL, c = colourOf(line);
  svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let g = "";
  // Tracks.
  for (const s of lay.segs) g += `<line x1="${x(s.col)}" y1="${ys[s.r0]}" x2="${x(s.col)}" y2="${ys[s.r1]}" stroke="${c}" stroke-width="${TRACK}"/>`;
  // Ends of branches: a stub and the line's badge.
  const label = esc(line.name.length > 4 ? line.name.slice(0, 3) : line.name), fs = label.length > 2 ? 7 : label.length > 1 ? 8.5 : 10;
  for (const e of lay.ends) {
    const y = ys[e.row] + (e.up ? -15 : 15);
    g += `<line x1="${x(e.col)}" y1="${ys[e.row]}" x2="${x(e.col)}" y2="${y}" stroke="${c}" stroke-width="${TRACK}"/>
      <circle cx="${x(e.col)}" cy="${y}" r="8" fill="${c}"/><text x="${x(e.col)}" y="${y + fs * 0.36}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#fff" font-family="var(--sans)">${label}</text>`;
  }
  // Stations: ticks for crossing lines, then a capsule over every track that calls, or a circle.
  lay.rows.forEach((st, i) => {
    const [a, b] = lay.span[i], y = ys[i], m = (meet[i] || []).slice(0, 8), n = m.length;
    const left = x(a) - 6.5, right = x(b) + 6.5, h = n ? Math.max(11, 5 + Math.ceil(n / 2) * 3.4) : 11;
    const top = y - (Math.ceil(n / 2) - 1) * 3.4 / 2;
    m.forEach((o, k) => {
      const yy = top + Math.floor(k / 2) * 3.4, col = colourOf(o);
      g += k % 2 === 0 ? `<line x1="${left - 8}" y1="${yy}" x2="${left}" y2="${yy}" stroke="${col}" stroke-width="2"/>` : `<line x1="${right}" y1="${yy}" x2="${right + 8}" y2="${yy}" stroke="${col}" stroke-width="2"/>`;
    });
    if (a === b && !n) g += `<circle cx="${x(a)}" cy="${y}" r="4.6" fill="var(--stop-fill)" stroke="var(--ring)" stroke-width="1.7"/>`;
    else g += `<rect x="${left}" y="${y - h / 2}" width="${right - left}" height="${h}" rx="${Math.min(4.5, h / 2)}" fill="var(--stop-fill)" stroke="var(--ring)" stroke-width="1.7"/>`;
  });
  svg.innerHTML = g;
}

/** Round trip, running and dwell for one trip (when there is one). */
export function summaryHtml(stops, back) {
  const first = stops[0], last = stops[stops.length - 1];
  const t0 = Date.parse(first.dep || first.time), t1 = Date.parse(last.arr || last.time);
  if (!t0 || !t1) return "";
  let dwell = 0;
  for (const s of stops.slice(1, -1)) if (s.arr && s.dep) dwell += Math.max(0, Date.parse(s.dep) - Date.parse(s.arr)) / 1000;
  const journey = (t1 - t0) / 1000, running = journey - dwell;
  const round = back ? journey + back.journey + back.turn * 2 : journey * 2;
  return `<div class="lsum"><span class="k strong">Round trip</span><b>${back ? "" : "≈ "}${mmss(round)}</b>
    <span class="k">Running</span><span>${mmss(running)}</span>
    <span class="k">Dwell at stops</span><span>${mmss(dwell)}</span></div>`;
}
