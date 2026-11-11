// A line drawn the way a metro diagram shows it, after the reference design:
//  - the followed line is the thickest stroke, running down the stops with direction marks,
//  - lines sharing a stretch are glued to it, left and right in turn,
//  - lines that only meet it at a stop come in as short ticks from both sides,
//  - stops where you can change are white capsules that grow with the number of lines,
//  - each stop shows its name, minutes from the start, the lines to change to, and the time.

import { badge, colourOf, compareLines, WIDTH } from "./lines.js";
import { clock, esc } from "./util.js";

const BADGES_SHOWN = 3;

/** Who meets the line where. */
export function diagramModel(line, stops, net) {
  const meet = stops.map(s => [...net.linesNear([s.lon, s.lat])].filter(o => o !== line).sort(compareLines));
  const along = stops.slice(0, -1).map((s, i) => net.linesAlong(s.key, stops[i + 1].key, line.cls).filter(o => o !== line).sort(compareLines));
  const crossing = stops.map((s, i) => {
    const near = new Set([...(along[i - 1] || []), ...(along[i] || [])]);
    return meet[i].filter(o => !near.has(o));
  });
  return { meet, along, crossing };
}

export function diagramHtml(line, stops, model, { expandAll, expanded, current }) {
  const t0 = Date.parse(stops[0].time || stops[0].sched || 0);
  return `<div class="diagram" id="diagram">${stops.map((s, i) => {
    const meet = model.meet[i], open = expandAll || expanded.has(s.key);
    const shown = open ? meet : meet.slice(0, BADGES_SHOWN), more = meet.length - shown.length;
    const rows = Math.ceil(model.crossing[i].length / 2), minH = Math.max(44, 30 + rows * 4.6);
    const mins = s.time && t0 ? Math.round((Date.parse(s.time) - t0) / 60000) : null;
    const end = i === 0 || i === stops.length - 1;
    return `<div class="srow${s.key === current ? " here" : ""}${s.past ? " past" : ""}" data-stop="${esc(s.key)}" data-name="${esc(s.name)}" tabindex="0" role="button" style="min-height:${minH}px">
      <span class="nmwrap"><span class="nm${end ? " end" : ""}">${esc(s.name)}</span><small class="tt">${i === 0 ? "start" : mins != null ? `${mins} min` : ""}</small></span>
      <span class="bd">${shown.map(o => badge(o, "sm")).join("")}${more > 0 ? `<button class="more" data-more="${esc(s.key)}" aria-label="Show ${more} more lines">+${more}</button>` : ""}${open && meet.length > BADGES_SHOWN && !expandAll ? `<button class="more" data-less="${esc(s.key)}" aria-label="Show fewer lines">–</button>` : ""}</span>
      <span class="clk${s.late ? " late" : s.rt ? " rt" : ""}">${s.time ? clock(s.time, s.tz) : ""}</span></div>`;
  }).join("")}<svg class="track" id="diagsvg" aria-hidden="true"></svg></div>`;
}

/** Draw the track once the rows are laid out, from their real positions. */
export function drawDiagram(line, stops, model) {
  const box = document.getElementById("diagram"), svg = document.getElementById("diagsvg");
  if (!box || !svg) return;
  const rows = [...box.querySelectorAll(".srow")];
  if (rows.length !== stops.length) return;
  const ys = rows.map(r => r.offsetTop + r.offsetHeight / 2), H = box.offsetHeight, X = 32, TW = 7.5;
  svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 66 ${H}`);
  const c = colourOf(line);
  let g = "";
  // Lines sharing a stretch: glued to the track.
  model.along.forEach((ls, i) => {
    let L = X - TW / 2, R = X + TW / 2;
    ls.forEach((o, k) => {
      const w = 2.2 * WIDTH[o.cls], x = k % 2 === 0 ? (R += w) - w / 2 : (L -= w) + w / 2;
      g += `<line x1="${x}" y1="${ys[i]}" x2="${x}" y2="${ys[i + 1]}" stroke="${colourOf(o)}" stroke-width="${w + 0.3}"/>`;
    });
  });
  // The followed line, thickest; the part already travelled is faded.
  const pastIdx = stops.findIndex(s => !s.past);
  g += `<line x1="${X}" y1="${ys[0]}" x2="${X}" y2="${ys[ys.length - 1]}" stroke="${c}" stroke-width="${TW}" stroke-linecap="round"/>`;
  if (pastIdx > 0) g += `<line x1="${X}" y1="${ys[0]}" x2="${X}" y2="${ys[pastIdx]}" stroke="var(--surface)" stroke-width="${TW + 1}" opacity=".55"/>`;
  for (let i = 0; i + 1 < ys.length; i++) {
    const m = (ys[i] + ys[i + 1]) / 2;
    g += `<path d="M${X - 2.6} ${m - 1.8} L${X} ${m + 1.4} L${X + 2.6} ${m - 1.8}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  stops.forEach((s, i) => {
    const y = ys[i], cross = model.crossing[i], n = model.meet[i].length;
    const r = Math.ceil(cross.length / 2), step = 4.6, top = y - (r - 1) * step / 2;
    cross.slice(0, 16).forEach((o, k) => {
      const yy = top + Math.floor(k / 2) * step, w = 1.9 * WIDTH[o.cls] + 0.4;
      g += k % 2 === 0 ? `<line x1="${X - 29}" y1="${yy}" x2="${X - 8}" y2="${yy}" stroke="${colourOf(o)}" stroke-width="${w}" stroke-linecap="round"/>`
        : `<line x1="${X + 8}" y1="${yy}" x2="${X + 29}" y2="${yy}" stroke="${colourOf(o)}" stroke-width="${w}" stroke-linecap="round"/>`;
    });
    if (n) {
      const w = 19 + Math.min(n, 8) * 1.4, h = Math.max(12.5, 8 + Math.min(r, 8) * step);
      g += `<rect x="${X - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${Math.min(h, w) / 2}" fill="var(--stop-fill)" stroke="var(--stop-ring)" stroke-width="1.9"/>`;
    } else {
      g += `<circle cx="${X}" cy="${y}" r="${i === 0 || i === stops.length - 1 ? 6.6 : 5.4}" fill="var(--stop-fill)" stroke="var(--stop-ring)" stroke-width="1.9"/>`;
    }
  });
  svg.innerHTML = g;
}
