// A line drawn the way a metro diagram shows it, after the reference design:
//  - one compact row per stop: name with the travel time from the start beside it, the lines you
//    can change to as small badges (two rows at most, then "+"), and the time on the right;
//  - the followed line is a thick track with small white diamonds between stops;
//  - lines sharing a stretch run glued beside the track, left and right in turn;
//  - lines crossing at a stop pass straight through it, stacked, and the white stop capsule
//    grows with them; a stop where nothing else calls is a small circle.
// Only lines running right now are shown (the network worker leaves the others out).

import { badge, colourOf, compareLines, WIDTH } from "./lines.js";
import { clock, esc, icon } from "./util.js";

const BADGES_SHOWN = 6;

/** Who meets the line where (asked of the network worker). */
export async function diagramModel(line, stops, net) {
  const { meet, along } = await net.diagram(line, stops);
  meet.forEach(m => m.sort(compareLines)); along.forEach(a => a.sort(compareLines));
  const crossing = stops.map((s, i) => {
    const near = new Set([...(along[i - 1] || []), ...(along[i] || [])]);
    return meet[i].filter(o => !near.has(o));
  });
  return { meet, along, crossing };
}

/** 8m33s, or 1h13m from an hour up. */
export function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h${String(Math.round(sec % 3600 / 60)).padStart(2, "0")}m`;
  return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
}

export function diagramHtml(line, stops, model, { expanded, current, rightLabel = "next trip" }) {
  const t0 = Date.parse(stops[0].dep || stops[0].time || 0);
  return `<div class="ldh"><b>Stops</b>${icon(line.cls === "bus" ? "bus" : line.cls === "train" ? "train" : line.cls === "metro" ? "metro" : "tram", "xs")}<span class="sp"></span><span>${esc(rightLabel)}</span></div>
  <div class="diagram" id="diagram">${stops.map((s, i) => {
    const meet = model.meet[i], open = expanded.has(s.key);
    const shown = open ? meet : meet.slice(0, BADGES_SHOWN), more = meet.length - shown.length;
    const cross = model.crossing[i].length, minH = Math.max(27, 12 + cross * 3.6 + 6, meet.length > 3 ? 40 : 0);
    const at = Date.parse(s.arr || s.time || 0);
    const tt = i > 0 && t0 && at ? mmss((at - t0) / 1000) : "";
    return `<div class="srow${s.key === current ? " here" : ""}${s.past ? " past" : ""}" data-stop="${esc(s.key)}" data-name="${esc(s.name)}" tabindex="0" role="button" style="min-height:${minH}px">
      <span class="nm"><span class="n">${esc(s.name)}</span>${tt ? `<small>${tt}</small>` : ""}</span>
      <span class="bd">${shown.map(o => badge(o, "xs")).join("")}${more > 0 ? `<button class="more" data-more="${esc(s.key)}" aria-label="Show ${more} more lines">+</button>` : ""}</span>
      <span class="clk${s.late ? " late" : s.rt ? " rt" : ""}">${s.time ? clock(s.time, s.tz) : ""}</span></div>`;
  }).join("")}<svg class="track" id="diagsvg" aria-hidden="true"></svg></div>`;
}

/** Round trip, running and dwell, under the stops. */
export function summaryHtml(stops, back) {
  const first = stops[0], last = stops[stops.length - 1];
  const t0 = Date.parse(first.dep || first.time), t1 = Date.parse(last.arr || last.time);
  if (!t0 || !t1) return "";
  let dwell = 0;
  for (const s of stops.slice(1, -1)) if (s.arr && s.dep) dwell += Math.max(0, Date.parse(s.dep) - Date.parse(s.arr)) / 1000;
  const journey = (t1 - t0) / 1000, running = journey - dwell;
  // Round trip: there and back, with the turnaround at the far end (from the trip back, when known).
  const round = back ? journey + back.journey + back.turn * 2 : journey * 2;
  return `<div class="lsum"><span class="k strong">Round trip</span><b>${back ? "" : "≈ "}${mmss(round)}</b>
    <span class="k">Running</span><span>${mmss(running)}</span>
    <span class="k">Dwell at stops</span><span>${mmss(dwell)}</span></div>`;
}

/** Draw the track once the rows are laid out, from their real positions. */
export function drawDiagram(line, stops, model) {
  const box = document.getElementById("diagram"), svg = document.getElementById("diagsvg");
  if (!box || !svg) return;
  const rows = [...box.querySelectorAll(".srow")];
  if (rows.length !== stops.length) return;
  const ys = rows.map(r => r.offsetTop + r.offsetHeight / 2), H = box.offsetHeight, X = 21, TW = 6.5, W = 44;
  svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let g = "";
  // Lines sharing a stretch: thin strands glued to the track.
  model.along.forEach((ls, i) => {
    let L = X - TW / 2, R = X + TW / 2;
    ls.slice(0, 6).forEach((o, k) => {
      const w = 2.3 * WIDTH[o.cls] + 0.2, x = k % 2 === 0 ? (L -= w) + w / 2 : (R += w) - w / 2;
      g += `<line x1="${x}" y1="${ys[i]}" x2="${x}" y2="${ys[i + 1]}" stroke="${colourOf(o)}" stroke-width="${w + 0.25}"/>`;
    });
  });
  // Lines crossing at a stop: straight through it, stacked.
  stops.forEach((s, i) => {
    const cross = model.crossing[i].slice(0, 10), step = 3.6, top = ys[i] - (cross.length - 1) * step / 2;
    cross.forEach((o, k) => {
      const y = top + k * step;
      g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${colourOf(o)}" stroke-width="${o.cls === "bus" ? 1.8 : 2.2}"/>`;
    });
  });
  // The followed line: the thick track, faded where the trip has already been.
  g += `<line x1="${X}" y1="${ys[0]}" x2="${X}" y2="${ys[ys.length - 1]}" stroke="${colourOf(line)}" stroke-width="${TW}"/>`;
  const pastIdx = stops.findIndex(s => !s.past);
  if (pastIdx > 0) g += `<line x1="${X}" y1="${ys[0]}" x2="${X}" y2="${ys[pastIdx]}" stroke="var(--paper)" stroke-width="${TW + 1}" opacity=".5"/>`;
  // Diamonds between stops.
  for (let i = 0; i + 1 < ys.length; i++) {
    const m = (ys[i] + ys[i + 1]) / 2, d = 3.6;
    g += `<path d="M${X} ${m - d} L${X + d} ${m} L${X} ${m + d} L${X - d} ${m} Z" fill="var(--stop-fill)" stroke="var(--ring)" stroke-width="1.2"/>`;
  }
  // Stops: a capsule that grows with the lines crossing there, else a circle.
  stops.forEach((s, i) => {
    const y = ys[i], n = Math.min(model.crossing[i].length, 10);
    if (n || model.meet[i].length > 2) {
      const w = 19, h = Math.max(12, 7 + n * 3.6);
      g += `<rect x="${X - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${Math.min(6, h / 2)}" fill="var(--stop-fill)" stroke="var(--ring)" stroke-width="1.8"/>`;
    } else {
      g += `<circle cx="${X}" cy="${y}" r="5.6" fill="var(--stop-fill)" stroke="var(--ring)" stroke-width="1.8"/>`;
    }
  });
  svg.innerHTML = g;
}
