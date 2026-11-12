// Skiing, drawn as vectors: ski areas (their outline and name), runs coloured by difficulty in each
// resort's own convention (Europe: green novice, blue easy, red intermediate, black advanced; North
// America: green easy, blue intermediate, black advanced; Japan: green, red, black; orange freeride),
// cross-country, ski touring, sledging and snowshoe trails, and lifts by type.
//
// The data: OpenSkiMap.org's daily OpenStreetMap extract, made into one vector-tile file (PMTiles,
// data/ski.pmtiles) when the site is published — see tools/build-ski.py and the publish workflow.
// The map reads just the parts in view from it, straight from the site.

import { ensureAll } from "./icons.js";

/* ============================== Icons ============================== */

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const badge = glyph => svg(26, 26, `<rect x=".5" y=".5" width="25" height="25" rx="7" fill="#fff"/><rect x="2" y="2" width="22" height="22" rx="5.6" fill="#3C4043"/><g fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(1 1)">${glyph}</g>`);
const CABLE = `<path d="M3 6l18-3"/>`, DRAG = `${CABLE}<path d="M12 4.5v9M9 13.5h6"/><path d="M6 20l12-2"/>`;
const ICONS = {
  // A skier on a slope, for ski areas.
  "ski-resort": () => svg(30, 30, `<circle cx="15" cy="15" r="14.4" fill="#fff"/><circle cx="15" cy="15" r="12.6" fill="#1F6FE0"/>
    <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="17.6" cy="8.4" r="1.6" fill="#fff" stroke="none"/>
    <path d="M9.5 13.2l4.2-1.6 2.6 2.4-2.4 3 3.2 2.4M13.7 11.6l-1 4.6M7.2 18.6l13.6 4.6"/></g>`),
  "ski-nordic": () => svg(30, 30, `<circle cx="15" cy="15" r="14.4" fill="#fff"/><circle cx="15" cy="15" r="12.6" fill="#2B7BB9"/>
    <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="15.5" cy="7.8" r="1.6" fill="#fff" stroke="none"/>
    <path d="M15 10.5l-2 5 3 2.4-1 4M13 15.5l-3.4 2.4M15.8 12.6l3.4 1.6M8 22.4h14"/></g>`),
  "ski-lift-gondola": () => badge(`${CABLE}<path d="M12 4.5V8"/><rect x="7" y="8" width="10" height="10" rx="2.4"/><path d="M7 12.5h10"/>`),
  "ski-lift-cable_car": () => badge(`${CABLE}<path d="M12 4.5V7.5"/><rect x="5.5" y="7.5" width="13" height="11" rx="1.6"/><path d="M5.5 12.5h13M12 7.5v5"/>`),
  "ski-lift-chair_lift": () => badge(`${CABLE}<path d="M12 4.5v9"/><path d="M8 13.5h8M8 13.5v4h8M16 13.5V10"/>`),
  "ski-lift-mixed_lift": () => badge(`${CABLE}<path d="M9 5v8h5v4M15 4v4"/><rect x="13" y="8" width="6" height="5" rx="1.2"/>`),
  "ski-lift-drag_lift": () => badge(DRAG), "ski-lift-t-bar": () => badge(DRAG),
  "ski-lift-j-bar": () => badge(`${CABLE}<path d="M12 4.5v9h3"/><path d="M6 20l12-2"/>`),
  "ski-lift-platter": () => badge(`${CABLE}<path d="M12 4.5v8"/><circle cx="12" cy="14.5" r="2"/><path d="M6 20l12-2"/>`),
  "ski-lift-rope_tow": () => badge(`<path d="M4 18L20 8"/><path d="M7 16.2v3M12 13.2v3M17 10.2v3"/>`),
  "ski-lift-magic_carpet": () => badge(`<path d="M4 18L20 9"/><path d="M4 18h3l13-7.3V9"/>`),
  "ski-lift-funicular": () => badge(`<path d="M4 19L20 7"/><rect x="8" y="9" width="8" height="6" rx="1.4" transform="rotate(-37 12 12)"/>`),
  "ski-lift-zip_line": () => badge(`<path d="M3 5l18 6"/><path d="M12 8v4M10 16l2-4 2 4"/>`),
  "ski-lift-other": () => badge(`${CABLE}<path d="M12 4.5V8"/><rect x="7.5" y="8" width="9" height="8" rx="1"/>`),
};
const REF = { "#2E9E44": "green", "#1F6FE0": "blue", "#E0332F": "red", "#202124": "black", "#F28C28": "orange", "#7B7F86": "grey", "#2B7BB9": "nordic", "#B5541C": "tour", "#8E5C3E": "sled", "#C2408F": "hike" };
for (const [c, k] of Object.entries(REF)) ICONS["ski-ref-" + k] = () => ({ stretch: true, svg: svg(20, 20, `<rect x=".5" y=".5" width="19" height="19" rx="9.5" fill="#fff"/><rect x="2" y="2" width="16" height="16" rx="8" fill="${c}"/>`) });

export function preloadSkiIcons() {
  return ensureAll(Object.entries(ICONS).map(([id, f]) => [id, () => {
    const r = f(), s = typeof r === "string" ? r : r.svg, [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s);
    return typeof r === "string" ? { svg: s, w: +w, h: +h, ratio: 3 } : { svg: s, w: +w, h: +h, ratio: 3, stretchX: [[9, 11]], stretchY: [[9, 11]], content: [5, 3, 15, 17] };
  }]));
}

/* ============================== The data ============================== */

let registered = false;
/** MapLibre reads the ski tiles out of one file, by byte ranges. */
function register() {
  if (registered || typeof pmtiles === "undefined") return;
  registered = true;
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
}

export function skiSources() {
  register();
  return { ski: { type: "vector", url: "pmtiles://" + new URL("data/ski.pmtiles", location.href).href, maxzoom: 13,
    attribution: '<a href="https://openskimap.org" target="_blank" rel="noopener">OpenSkiMap</a>' } };
}

/* ============================== Layers ============================== */

const zl = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];
const refIcon = ["match", ["get", "col"], ...Object.entries(REF).flatMap(([c, k]) => [c, "ski-ref-" + k]), "ski-ref-grey"];
const runs = { source: "ski", "source-layer": "runs" };

export function skiLayers(t) {
  const isLine = ["==", ["geometry-type"], "LineString"], isArea = ["==", ["geometry-type"], "Polygon"];
  const width = zl(9, ["*", ["get", "w"], 0.45], 13, ["get", "w"], 17, ["*", ["get", "w"], 1.8]);
  const line = (id, kind, arr) => ({ id, type: "line", ...runs, minzoom: 9, filter: ["all", isLine, ["==", ["get", "k"], kind]],
    layout: { "line-cap": kind === "dot" ? "round" : "butt", "line-join": "round" },
    paint: { "line-color": ["get", "col"], "line-width": width, ...(arr ? { "line-dasharray": arr } : {}) } });
  return {
    areas: [
      // Ski areas: a cold, pale tint with a dashed edge.
      { id: "ski-area-fill", type: "fill", source: "ski", "source-layer": "areas", minzoom: 7, paint: { "fill-color": t.skiArea, "fill-opacity": zl(7, 0.3, 12, 0.5) } },
      { id: "ski-area-edge", type: "line", source: "ski", "source-layer": "areas", minzoom: 9, paint: { "line-color": "#5E97F6", "line-width": 1.2, "line-dasharray": [4, 3], "line-opacity": 0.65 } },
      { id: "ski-run-areas", type: "fill", ...runs, minzoom: 11, filter: isArea, paint: { "fill-color": ["get", "col"], "fill-opacity": 0.16 } },
    ],
    lines: [
      // Runs on a white edge, so they read on snow, forest and rock alike; expert runs on an orange edge.
      { id: "ski-run-casing", type: "line", ...runs, minzoom: 11, filter: ["all", isLine, ["==", ["get", "u"], "downhill"]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["==", ["get", "x"], 1], "#F28C28", "#FFFFFF"], "line-width": zl(11, 3.6, 13, 4.6, 17, 7.6), "line-opacity": 0.95 } },
      line("ski-run-solid", "solid"), line("ski-run-dash", "dash", [2.4, 1.4]), line("ski-run-dot", "dot", [0.1, 2]),
      { id: "ski-run-outline", type: "line", ...runs, minzoom: 12, filter: isArea, paint: { "line-color": ["get", "col"], "line-width": 1, "line-opacity": 0.6 } },
      // Lifts: a dark cable, with the cabins or chairs as dots when close.
      { id: "ski-lift", type: "line", source: "ski", "source-layer": "lifts", minzoom: 10, paint: { "line-color": "#3C4043", "line-width": zl(10, 0.7, 16, 1.6) } },
      { id: "ski-lift-dots", type: "line", source: "ski", "source-layer": "lifts", minzoom: 13, layout: { "line-cap": "round" },
        paint: { "line-color": "#3C4043", "line-width": zl(13, 3.4, 17, 5.5), "line-dasharray": [0.1, 6] } },
    ],
    labels: [
      { id: "ski-run-refs", type: "symbol", ...runs, minzoom: 13, filter: ["all", isLine, ["!=", ["get", "r"], ""]],
        layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "r"], "text-font": ["Noto Sans Bold"], "text-size": 10,
          "text-rotation-alignment": "viewport", "icon-rotation-alignment": "viewport", "icon-image": refIcon, "icon-text-fit": "both", "icon-text-fit-padding": [1, 2, 1, 2] },
        paint: { "text-color": "#FFFFFF" } },
      { id: "ski-run-names", type: "symbol", ...runs, minzoom: 14, filter: ["all", isLine, ["!=", ["get", "n"], ""]],
        layout: { "symbol-placement": "line", "symbol-spacing": 320, "text-field": ["get", "n"], "text-font": ["Noto Sans Italic"], "text-size": 11, "text-offset": [0, -0.9] },
        paint: { "text-color": ["get", "col"], "text-halo-color": t.halo, "text-halo-width": 1.6 } },
      { id: "ski-lift-labels", type: "symbol", source: "ski", "source-layer": "lifts", minzoom: 13,
        layout: { "symbol-placement": "line-center",
          "icon-image": ["match", ["get", "t"], ["gondola", "cable_car", "chair_lift", "mixed_lift", "drag_lift", "t-bar", "j-bar", "platter", "rope_tow", "magic_carpet", "funicular", "zip_line"], ["concat", "ski-lift-", ["get", "t"]], "ski-lift-other"],
          "icon-size": 0.8, "icon-rotation-alignment": "viewport", "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 10.5,
          "text-rotation-alignment": "viewport", "text-anchor": "left", "text-offset": [1.2, 0], "text-optional": true },
        paint: { "text-color": "#3C4043", "text-halo-color": t.halo, "text-halo-width": 1.5 } },
      // Ski-area badges from about the 10 km scale (zoom 10) inwards, with their names.
      { id: "ski-areas", type: "symbol", source: "ski", "source-layer": "labels", minzoom: 10, maxzoom: 14.5,
        layout: { "icon-image": ["case", ["==", ["get", "a"], "nordic"], "ski-nordic", "ski-resort"], "icon-size": zl(10, 0.8, 12, 1),
          "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": zl(10, 11.5, 13, 13),
          "text-anchor": "top", "text-offset": [0, 1.2], "text-max-width": 9, "text-optional": true, "icon-padding": 4,
          "symbol-sort-key": ["-", 0, ["coalesce", ["get", "top"], 0]] },
        paint: { "text-color": "#174EA6", "text-halo-color": t.halo, "text-halo-width": 1.6 } },
    ],
  };
}
export const SKI_LAYER_IDS = ["ski-area-fill", "ski-area-edge", "ski-run-areas", "ski-run-casing", "ski-run-solid", "ski-run-dash", "ski-run-dot", "ski-run-outline",
  "ski-lift", "ski-lift-dots", "ski-run-refs", "ski-run-names", "ski-lift-labels", "ski-areas"];
