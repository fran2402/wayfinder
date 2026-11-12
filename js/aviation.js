// Airports: airport markers, runways with their numbers painted at each threshold (in the blocky
// runway-marking numerals, with threshold stripes), taxiway signs (yellow on black, like the real
// location signs), gate signs, and what the airport panel shows: codes, elevation, runways, flights.

import { ensure, ensureAll } from "./icons.js";
import { debounce } from "./util.js";

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/* ============================== Runway numerals ============================== */

// Runway numerals on a 6 × 10 grid, drawn as thick strokes — square, like the paint on a runway.
const GLYPH = {
  0: "M.7 .7H5.3V9.3H.7Z", 1: "M3 0V10", 2: "M.7 .7H5.3V5H.7V9.3H5.3", 3: "M.7 .7H5.3V9.3H.7M1.6 5H5.3", 4: "M.7 0V6H5.3M4.2 2.6V10",
  5: "M5.3 .7H.7V5H5.3V9.3H.7", 6: "M5.3 .7H.7V9.3H5.3V5H.7", 7: "M.7 .7H5.3V10", 8: "M.7 .7H5.3V9.3H.7ZM.7 5H5.3", 9: "M5.3 5H.7V.7H5.3V9.3H.7",
  L: "M.7 0V9.3H5.3", R: "M.7 10V.7H5.3V5H.7M2.6 5L5.3 10", C: "M5.3 .7H.7V9.3H5.3",
};
/** A string in runway numerals, centred on x = cx, top at y, `h` units tall. */
export function numerals(str, cx, y, h, colour = "#fff") {
  const s = h / 10, w = 6 * s, gap = 1.6 * s, total = str.length * w + (str.length - 1) * gap;
  return [...str].map((ch, i) => GLYPH[ch] ? `<path d="${GLYPH[ch]}" transform="translate(${cx - total / 2 + i * (w + gap)} ${y}) scale(${s})" fill="none" stroke="${colour}" stroke-width="1.45" stroke-linejoin="miter" stroke-linecap="butt"/>` : "").join("");
}

/** A runway end: threshold bar and stripes, then the letter, then the number (read from the approach). */
function runwayEndSvg(des, asphalt, paint) {
  const num = des.replace(/[LRC]$/, ""), letter = des.slice(num.length);
  // Asphalt behind the markings hides the centre line there, as on a real runway.
  let stripes = `<rect x="0" y="0" width="40" height="72" fill="${asphalt}"/><rect x="2" y="70" width="36" height="1.6" fill="${paint}"/>`;
  for (const x of [3, 7.2, 11.4, 15.6, 22.2, 26.4, 30.6, 34.8]) stripes += `<rect x="${x}" y="44" width="2.2" height="24.5" fill="${paint}"/>`;
  return svg(40, 72, stripes + (letter ? numerals(letter, 20, 23, 15, paint) : "") + numerals(num, 20, letter ? 3 : 18, 15, paint));
}
/** A small runway badge for the panel: the designators in runway numerals on asphalt. */
export function runwayBadge(ref) {
  const parts = ref.split("/").map(p => p.trim()), cw = n => n * 7.2 + (n - 1) * 1.92;
  const w = 16 + parts.reduce((a, p) => a + cw(p.length), 0) + (parts.length - 1) * 11;
  let x = 8, body = "";
  parts.forEach((p, i) => {
    body += numerals(p, x + cw(p.length) / 2, 6, 12);
    x += cw(p.length);
    if (i < parts.length - 1) { body += `<path d="M${x + 5.5} 8v8" stroke="#fff" stroke-width="1.2" opacity=".55"/>`; x += 11; }
  });
  return `<svg class="rwy" viewBox="0 0 ${w} 24" width="${w}" height="24" aria-label="Runway ${ref}"><rect width="${w}" height="24" rx="5" fill="#3C4043"/>${body}</svg>`;
}

/* ============================== Icons ============================== */

const PLANE = `<path d="M21 15.6v-1.9l-7.6-4.8V3.8a1.4 1.4 0 0 0-2.8 0v5.1L3 13.7v1.9l7.6-2.4v5.2L8.7 19.8v1.5l3.3-1 3.3 1v-1.5l-1.9-1.4v-5.2z" fill="#fff"/>`;
const STATIC = {
  "air-port": () => ({ svg: svg(30, 30, `<circle cx="15" cy="15" r="14.4" fill="#fff"/><circle cx="15" cy="15" r="12.6" fill="#3C4043"/><g transform="translate(3 3)">${PLANE}</g>`), w: 30, h: 30 }),
  "air-port-small": () => ({ svg: svg(24, 24, `<circle cx="12" cy="12" r="11.4" fill="#fff"/><circle cx="12" cy="12" r="10" fill="#5F6368"/><g transform="translate(2.4 2.4) scale(.8)">${PLANE}</g>`), w: 24, h: 24 }),
  "air-heli": () => ({ svg: svg(22, 22, `<circle cx="11" cy="11" r="10.4" fill="#fff"/><circle cx="11" cy="11" r="9" fill="#5F6368"/><path d="M7.6 6.5v9M14.4 6.5v9M7.6 11h6.8" stroke="#fff" stroke-width="2"/>`), w: 22, h: 22 }),
  // Taxiway location sign: yellow on black with a yellow border. Stretches around its text.
  "air-sign-taxi": () => ({ svg: svg(20, 18, `<rect x=".5" y=".5" width="19" height="17" rx="2.5" fill="#111"/><rect x="2" y="2" width="16" height="14" rx="1.4" fill="none" stroke="#F9C80E" stroke-width="1.2"/>`),
    w: 20, h: 18, stretchX: [[5, 15]], stretchY: [[5, 13]], content: [4, 3, 16, 15] }),
  // Gate sign: black on yellow.
  "air-sign-gate": () => ({ svg: svg(20, 18, `<rect x=".5" y=".5" width="19" height="17" rx="2.5" fill="#F9C80E" stroke="#111" stroke-width="1"/>`),
    w: 20, h: 18, stretchX: [[5, 15]], stretchY: [[5, 13]], content: [4, 3, 16, 15] }),
};
export function preloadAirIcons() { return ensureAll(Object.entries(STATIC).map(([id, d]) => [id, () => ({ ratio: 3, ...d() })])); }

/* ============================== Runways from the map tiles ============================== */

const R = 6371008.8, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export const metresBetween = ([a, b], [c, d]) => { const x = rad(c - a) * Math.cos(rad((b + d) / 2)), y = rad(d - b); return Math.hypot(x, y) * R; };
const bearing = ([a, b], [c, d]) => (deg(Math.atan2(Math.sin(rad(c - a)) * Math.cos(rad(d)), Math.cos(rad(b)) * Math.sin(rad(d)) - Math.sin(rad(b)) * Math.cos(rad(d)) * Math.cos(rad(c - a)))) + 360) % 360;
const angleOff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Runways in the loaded tiles: pieces (cut at tile edges) joined by designator; their two ends and numbers. */
export function runwaysIn(map, near = null, within = 8000) {
  const groups = [];
  for (const f of map.querySourceFeatures("omt", { sourceLayer: "aeroway", filter: ["all", ["==", ["get", "class"], "runway"], ["==", ["geometry-type"], "LineString"]] })) {
    const ref = f.properties.ref;
    if (!ref) continue;
    const lines = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const pts of lines) {
      if (near && metresBetween(pts[0], near) > within) continue;
      let g = groups.find(g => g.ref === ref && metresBetween(g.pts[0], pts[0]) < 6000);
      if (!g) groups.push(g = { ref, pts: [] });
      g.pts.push(...pts);
    }
  }
  return groups.map(({ ref, pts }) => {
    // The ends: the two points furthest apart along the runway's direction.
    let a = pts[0], b = pts[0], best = -1;
    for (const p of pts) { const d = metresBetween(pts[0], p); if (d > best) { best = d; b = p; } }
    best = -1; for (const p of pts) { const d = metresBetween(b, p); if (d > best) { best = d; a = p; } }
    const inA = bearing(a, b), inB = bearing(b, a);
    const des = ref.split("/").map(s => /^(\d{1,2})([LRC]?)$/.exec(s.trim().toUpperCase())).filter(Boolean).map(m => m[1].padStart(2, "0") + m[2]);
    // Runway 09 is the end you land on heading 090°: its number sits at the end from which the runway runs that way.
    const ends = des.map(d => { const hdg = parseInt(d, 10) * 10; return angleOff(inA, hdg) <= angleOff(inB, hdg) ? { des: d, at: a, rot: inA } : { des: d, at: b, rot: inB }; });
    return { ref, a, b, length: metresBetween(a, b), heading: Math.min(inA, inB), ends };
  }).filter(r => r.length > 150);
}

/** Keeps the painted runway numbers in step with the tiles in view. */
export class Runways {
  constructor(map) {
    this.map = map;
    const run = debounce(() => this.update(), 250);
    map.on("idle", run);
    map.on("style.load", () => { this.key = null; });
  }
  async update() {
    if (this.map.getZoom() < 13 || !this.map.getSource("runway-ends")) return;
    const feats = [], asphalt = this.map.getPaintProperty("aeroway-runway", "line-color"), paint = this.map.getPaintProperty("aeroway-runway-centre", "line-color");
    const tag = (asphalt + paint).replace(/[^0-9A-Za-z]/g, "");
    for (const r of runwaysIn(this.map)) for (const e of r.ends) {
      const id = `rwy-${e.des}-${tag}`;
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: e.at }, properties: { icon: id, rot: e.rot } });
    }
    const key = feats.map(f => f.properties.icon + f.geometry.coordinates.join()).join("|");
    if (key === this.key) return;
    this.key = key;
    await ensureAll([...new Set(feats.map(f => f.properties.icon))].map(id => [id, () => ({ svg: runwayEndSvg(id.split("-")[1], asphalt, paint), w: 40, h: 72, ratio: 8 })]));
    this.map.getSource("runway-ends")?.setData({ type: "FeatureCollection", features: feats });
  }
}

/* ============================== Layers ============================== */

// A runway is about 45 m wide: this is its width on screen, zoom by zoom (at mid latitudes).
export const RUNWAY_WIDTH = ["interpolate", ["exponential", 2], ["zoom"], 9, 0.9, 12, 3.3, 19, 426];
const TAXIWAY_WIDTH = ["interpolate", ["exponential", 2], ["zoom"], 12, 0.8, 14, 3.4, 19, 110];

export const airSources = () => ({ "runway-ends": { type: "geojson", data: { type: "FeatureCollection", features: [] } } });

export function airLayers(t) {
  const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
  return {
    ground: [
      { id: "aeroway-taxiway", type: "line", source: "omt", "source-layer": "aeroway", minzoom: 12, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "taxiway"]],
        layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": t.taxiway, "line-width": TAXIWAY_WIDTH } },
      { id: "aeroway-taxiway-centre", type: "line", source: "omt", "source-layer": "aeroway", minzoom: 15, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "taxiway"]],
        paint: { "line-color": "#F9C80E", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.6, 19, 2], "line-opacity": 0.9 } },
      { id: "aeroway-runway", type: "line", source: "omt", "source-layer": "aeroway", minzoom: 9, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "runway"]],
        layout: { "line-join": "miter", "line-cap": "butt" }, paint: { "line-color": t.runway, "line-width": RUNWAY_WIDTH } },
      { id: "aeroway-runway-edge", type: "line", source: "omt", "source-layer": "aeroway", minzoom: 15, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "runway"]],
        paint: { "line-color": t.runwayLine, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.5, 19, 2], "line-gap-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 3.3 * 0.9, 19, 426 * 0.9], "line-opacity": 0.85 } },
      { id: "aeroway-runway-centre", type: "line", source: "omt", "source-layer": "aeroway", minzoom: 14, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "runway"]],
        paint: { "line-color": t.runwayLine, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 14, 0.6, 19, 7], "line-dasharray": [8, 6] } },
      { id: "runway-numbers", type: "symbol", source: "runway-ends", minzoom: 13.5,
        layout: { "icon-image": ["get", "icon"], "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-anchor": "bottom",
          "icon-size": ["interpolate", ["exponential", 2], ["zoom"], 12, 3.3 / 40, 19, 426 / 40], "icon-allow-overlap": true, "icon-ignore-placement": true } },
    ],
    labels: [
      { id: "taxiway-signs", type: "symbol", source: "omt", "source-layer": "aeroway", minzoom: 15, filter: ["all", ["==", ["get", "class"], "taxiway"], ["has", "ref"]],
        layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-rotation-alignment": "viewport", "text-keep-upright": true,
          "icon-image": "air-sign-taxi", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3], "icon-rotation-alignment": "viewport" },
        paint: { "text-color": "#F9C80E" } },
      { id: "gate-signs", type: "symbol", source: "omt", "source-layer": "aeroway", minzoom: 16, filter: ["all", ["==", ["get", "class"], "gate"], ["has", "ref"], ["<=", ["length", ["get", "ref"]], 6]],
        layout: { "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": 11, "icon-image": "air-sign-gate", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3] },
        paint: { "text-color": "#111111" } },
      { id: "helipads", type: "symbol", source: "omt", "source-layer": "aeroway", minzoom: 15, filter: ["all", ["match", ["get", "class"], ["helipad", "heliport"], true, false], ["==", ["geometry-type"], "Point"]],
        layout: { "icon-image": "air-heli", "icon-size": 0.9 } },
      // Airports with an IATA code from zoom 8, the rest (airfields, strips) from 11.
      ...[["airports", 8, ["has", "iata"]], ["airfields", 11, ["!", ["has", "iata"]]]].map(([id, minzoom, filter]) => ({
        id, type: "symbol", source: "omt", "source-layer": "aerodrome_label", minzoom, filter,
        layout: { "icon-image": id === "airports" ? "air-port" : "air-port-small", "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.75, 13, 1],
          "text-field": id === "airports" ? ["step", ["zoom"], ["get", "iata"], 10, ["format", NAME, {}, "\n", {}, ["get", "iata"], { "font-scale": 0.9, "text-font": ["literal", ["Noto Sans Regular"]] }]] : NAME,
          "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-anchor": "top", "text-offset": [0, 1.25], "text-max-width": 9, "text-optional": true },
        paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.4 },
      })),
    ],
  };
}
export const AIR_CLICK_LAYERS = ["airports", "airfields"];

/* ============================== Flights ============================== */

/** A flight's route by its number (IATA like "VY1234" or ICAO callsign like "VLG1234"), from adsbdb. */
export async function lookupFlight(code) {
  const c = code.replace(/\s+/g, "").toUpperCase();
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(c)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("flight data " + res.status);
  const r = (await res.json()).response;
  return typeof r === "object" ? r.flightroute : null;
}
