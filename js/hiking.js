// Walking and hiking: paths drawn by kind (trails, footways, steps, tracks, cycle and bridle paths),
// marked hiking routes as coloured bands under them — by network, as on hiking maps (international,
// national, regional, local) — with their numbers along the way, and mountain peaks with their height.
// All from the base map's own vector tiles.

import { ensureAll } from "./icons.js";

const HIKE_NETS = ["iwn", "nwn", "rwn", "lwn"];
export const NET_COLOURS = { iwn: "#B5179E", nwn: "#D93025", rwn: "#1A73E8", lwn: "#7B61FF" };
const NET_NAMES = { iwn: "International", nwn: "National", rwn: "Regional", lwn: "Local" };

// A route runs along a street or path when any of its (up to 6) routes is a hiking one.
const R = [1, 2, 3, 4, 5, 6];
const netIs = n => ["any", ...R.map(r => ["==", ["get", `route_${r}_network`], n])];
const isHike = ["any", ...HIKE_NETS.map(netIs)];
const bandColour = ["case", ...HIKE_NETS.flatMap(n => [netIs(n), NET_COLOURS[n]]), "#7B61FF"];
const firstHike = field => ["case", ...R.flatMap(r => [["in", ["get", `route_${r}_network`], ["literal", HIKE_NETS]], ["coalesce", ["get", `route_${r}_${field}`], ""]]), ""];
const label = ["case", ["!=", firstHike("ref"), ""], firstHike("ref"), firstHike("name")];
const zl = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
export function preloadHikeIcons() {
  return ensureAll([
    ["peak", () => ({ svg: svg(16, 14, `<path d="M8 1.5l6.6 11H1.4z" fill="#6D4C41" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`), w: 16, h: 14, ratio: 3 })],
    ["volcano", () => ({ svg: svg(16, 14, `<path d="M5.6 4.5h4.8l4.2 8H1.4z" fill="#B23A22" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`), w: 16, h: 14, ratio: 3 })],
    ...HIKE_NETS.map(n => ["hike-" + n, () => ({ svg: svg(20, 18, `<rect x=".5" y=".5" width="19" height="17" rx="4" fill="#fff"/><rect x="1.8" y="1.8" width="16.4" height="14.4" rx="3" fill="${NET_COLOURS[n]}"/>`),
      w: 20, h: 18, ratio: 3, stretchX: [[6, 14]], stretchY: [[6, 12]], content: [4, 3, 16, 15] })]),
  ]);
}

/** Layers: route bands go under the roads, paths over them, labels with the other labels. */
export function hikeLayers(t) {
  const path = (id, filter, paint, minzoom = 13) => ({ id, type: "line", source: "omt", "source-layer": "transportation", minzoom,
    filter: ["all", ["!=", ["get", "brunnel"], "tunnel"], filter], layout: { "line-cap": "butt", "line-join": "round" }, paint });
  const sub = (...v) => ["match", ["get", "subclass"], v, true, false];
  return {
    bands: [
      { id: "hike-routes", type: "line", source: "omt", "source-layer": "transportation_name", minzoom: 10, filter: isHike,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": bandColour, "line-width": zl(10, 2.5, 14, 6, 17, 10), "line-opacity": zl(10, 0.55, 15, 0.4) } },
    ],
    paths: [
      // Trails: a brown dashed line, a white edge so they read on any ground.
      path("path-trail-edge", ["all", ["==", ["get", "class"], "path"], sub("path", "bridleway")], { "line-color": t.halo, "line-width": zl(13, 2.4, 18, 5), "line-opacity": 0.6 }),
      path("path-trail", ["all", ["==", ["get", "class"], "path"], sub("path")], { "line-color": t.trail, "line-width": zl(13, 1.1, 18, 2.6), "line-dasharray": [2.2, 1.2] }),
      path("path-bridleway", ["all", ["==", ["get", "class"], "path"], sub("bridleway")], { "line-color": "#3E8E41", "line-width": zl(13, 1.1, 18, 2.4), "line-dasharray": [3, 1.4] }),
      path("path-footway", ["all", ["==", ["get", "class"], "path"], sub("footway", "sidewalk", "crossing", "corridor")], { "line-color": t.footway, "line-width": zl(14, 0.9, 18, 2.4), "line-dasharray": [1, 0.9] }, 14.5),
      path("path-cycleway", ["all", ["==", ["get", "class"], "path"], sub("cycleway")], { "line-color": "#1A73E8", "line-width": zl(13, 1, 18, 2.6), "line-dasharray": [2.6, 1], "line-opacity": 0.85 }),
      path("path-steps", ["all", ["==", ["get", "class"], "path"], sub("steps")], { "line-color": t.trail, "line-width": zl(14, 2.4, 18, 6), "line-dasharray": [0.35, 0.35] }, 14),
      path("path-track", ["==", ["get", "class"], "track"], { "line-color": t.track, "line-width": zl(12, 1, 18, 3), "line-dasharray": [4, 1.6] }, 12),
    ],
    labels: [
      { id: "hike-route-labels", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 12, filter: ["all", isHike, ["!=", label, ""]],
        layout: { "symbol-placement": "line", "symbol-spacing": 420, "text-field": ["slice", label, 0, 28], "text-font": ["Noto Sans Bold"], "text-size": 10.5,
          "text-rotation-alignment": "viewport", "icon-rotation-alignment": "viewport",
          "icon-image": ["case", ...HIKE_NETS.flatMap(n => [netIs(n), "hike-" + n]), "hike-lwn"], "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3] },
        paint: { "text-color": "#FFFFFF" } },
      { id: "path-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 15, filter: ["all", ["match", ["get", "class"], ["path", "track"], true, false], ["!", isHike]],
        layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Italic"], "text-size": 10.5, "symbol-spacing": 300 },
        paint: { "text-color": t.trail, "text-halo-color": t.halo, "text-halo-width": 1.4 } },
      { id: "peaks", type: "symbol", source: "omt", "source-layer": "mountain_peak", minzoom: 9, filter: ["==", ["geometry-type"], "Point"],
        layout: { "icon-image": ["case", ["==", ["get", "class"], "volcano"], "volcano", "peak"], "icon-size": zl(9, 0.75, 14, 1),
          "text-field": ["format", ["coalesce", ["get", "name:en"], ["get", "name"], ""], {}, ["case", ["has", "ele"], ["concat", "\n", ["to-string", ["get", "ele"]], " m"], ""], { "font-scale": 0.85, "text-font": ["literal", ["Noto Sans Regular"]] }],
          "text-font": ["Noto Sans Bold"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.8], "text-max-width": 8, "text-optional": true,
          "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]] },
        paint: { "text-color": "#5D4037", "text-halo-color": t.halo, "text-halo-width": 1.5 } },
    ],
  };
}
export const HIKE_LAYER_IDS = ["hike-routes", "hike-route-labels"];
export const NETWORK_NAMES = NET_NAMES;
