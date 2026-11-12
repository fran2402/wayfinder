// Streets: every road class in one casing layer under one fill layer, so junctions and the places
// where a road changes class blend into each other instead of overlapping. Tunnels are dashed and
// see-through, under the buildings; bridges are cased and drawn over everything below them.
// Then one-way arrows, route shields, street names and house numbers.

import { ensureAll } from "./icons.js";

const STOPS = [5, 8, 10, 12, 14, 16, 19];
// Fill widths (px) at those zooms.
const W = {
  motorway: [0.6, 1.2, 1.8, 3, 6.5, 13, 38],
  trunk: [0.5, 1, 1.6, 2.6, 6, 12, 34],
  primary: [0, 0.8, 1.4, 2.4, 5.5, 11, 32],
  secondary: [0, 0, 0.8, 1.8, 4.6, 10, 30],
  tertiary: [0, 0, 0.6, 1.5, 4, 9, 28],
  minor: [0, 0, 0, 0.6, 2.6, 7, 22],
  service: [0, 0, 0, 0, 1.2, 4, 14],
  ramp: [0, 0.6, 1, 1.6, 3.6, 7.5, 22],
  pedestrian: [0, 0, 0, 0, 1.4, 5, 18],
  busway: [0, 0, 0, 0.6, 2.4, 6, 18],
  raceway: [0, 0, 0, 0.6, 2.6, 7, 22],
};
const EDGE = [0, 0, 0.8, 1, 1.6, 2.2, 3.2];
const RANK = { motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6, minor: 4, raceway: 4, busway: 4, service: 3, pedestrian: 2 };

const isRamp = ["==", ["get", "ramp"], 1];
const kind = ["case", ["==", ["get", "subclass"], "pedestrian"], "pedestrian", ["get", "class"]];
const ROADS = ["any", ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "busway", "raceway"], true, false], ["==", ["get", "subclass"], "pedestrian"]];
function widths(edge) {
  const out = ["interpolate", ["exponential", 1.5], ["zoom"]];
  STOPS.forEach((z, i) => {
    const w = k => W[k][i] && W[k][i] + (edge ? EDGE[i] : 0);
    const m = ["match", kind]; for (const k in W) if (k !== "ramp") m.push(k, w(k)); m.push(0);
    out.push(z, ["case", isRamp, w("ramp"), m]);
  });
  return out;
}
const byClass = (t, motorway, major, mid, road, ped) => ["match", kind, "motorway", motorway, ["trunk", "primary"], major, ["secondary", "tertiary"], mid, "pedestrian", ped, road];
const sortKey = (extra = 0) => ["+", ["case", isRamp, 5, ["match", kind, ...Object.entries(RANK).flat(), 1]], extra];

function set(t, id, filter, { casing, fill, dash, opacity = 1, sort }) {
  return [
    { id: id + "-casing", type: "line", source: "omt", "source-layer": "transportation", minzoom: 5, filter,
      layout: { "line-join": "round", "line-cap": dash ? "butt" : "round", "line-sort-key": sort },
      paint: { "line-color": casing, "line-width": widths(true), "line-opacity": opacity, ...(dash ? { "line-dasharray": dash } : {}) } },
    { id, type: "line", source: "omt", "source-layer": "transportation", minzoom: 5, filter,
      layout: { "line-join": "round", "line-cap": "round", "line-sort-key": sort },
      paint: { "line-color": fill, "line-width": widths(false), "line-opacity": opacity } },
  ];
}

export function streetLayers(t) {
  const fill = byClass(t, t.motorway, t.major, t.mid, t.road, t.pedestrian);
  const edge = byClass(t, t.motorwayEdge, t.majorEdge, t.majorEdge, t.roadEdge, t.roadEdge);
  const brunnel = b => ["==", ["get", "brunnel"], b];
  return {
    // Under the buildings: a dashed outline round a pale road, like seeing it through the ground.
    tunnels: set(t, "road-tunnel", ["all", ROADS, brunnel("tunnel")], { casing: t.tunnelEdge, fill: t.tunnel, dash: [1.4, 0.9], opacity: 0.9, sort: sortKey() }),
    roads: [
      ...set(t, "road", ["all", ROADS, ["!", ["match", ["get", "brunnel"], ["tunnel", "bridge"], true, false]]], { casing: edge, fill, sort: sortKey() }),
      { id: "road-oneway", type: "symbol", source: "omt", "source-layer": "transportation", minzoom: 16,
        filter: ["all", ["match", ["get", "oneway"], [1, -1], true, false], ["match", ["get", "class"], ["minor", "service", "tertiary", "secondary"], true, false]],
        layout: { "symbol-placement": "line", "symbol-spacing": 140, "icon-image": "road-oneway", "icon-size": 0.9, "icon-rotate": ["case", ["==", ["get", "oneway"], -1], 180, 0], "icon-rotation-alignment": "map", "icon-padding": 0 } },
    ],
    bridges: set(t, "road-bridge", ["all", ROADS, brunnel("bridge")], { casing: t.bridgeEdge, fill, sort: sortKey(["*", ["coalesce", ["get", "layer"], 1], 20]) }),
  };
}

const FIRST_REF = ["case", [">=", ["index-of", ";", ["get", "ref"]], 0], ["slice", ["get", "ref"], 0, ["index-of", ";", ["get", "ref"]]], ["get", "ref"]];
const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
export function streetLabels(t) {
  const major = ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary"], true, false];
  return [
    { id: "house-numbers", type: "symbol", source: "omt", "source-layer": "housenumber", minzoom: 17,
      layout: { "text-field": ["get", "housenumber"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 17, 9.5, 19, 11.5], "text-padding": 2 },
      paint: { "text-color": t.labelMuted, "text-halo-color": t.building, "text-halo-width": 1.2, "text-opacity": 0.95 } },
    { id: "road-names-minor", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14.5,
      filter: ["any", ["match", ["get", "class"], ["minor", "service", "busway", "raceway"], true, false], ["==", ["get", "subclass"], "pedestrian"]],
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 10, 18, 13.5], "text-max-angle": 30, "symbol-spacing": 320, "text-padding": 4 },
      paint: { "text-color": t.labelMuted, "text-halo-color": t.halo, "text-halo-width": 1.6 } },
    { id: "road-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 12.5, filter: major,
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 10, 18, 14.5], "text-max-angle": 30, "symbol-spacing": 380, "text-padding": 4, "text-letter-spacing": 0.02 },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.8 } },
    // Route numbers in shields: motorways in blue (from zoom 8), other main roads in white (from 10.5).
    ...[["road-shields", 8, ["==", ["get", "class"], "motorway"]], ["road-shields-main", 10.5, ["match", ["get", "class"], ["trunk", "primary"], true, false]]].map(([id, minzoom, cls]) => ({
      id, type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom, filter: ["all", ["has", "ref"], ["<=", ["get", "ref_length"], 7], cls],
      layout: { "symbol-placement": "line", "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 8, 260, 14, 520], "text-field": FIRST_REF,
        "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-rotation-alignment": "viewport", "icon-rotation-alignment": "viewport",
        "icon-image": id === "road-shields" ? "shield-motorway" : "shield-road", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3.5, 1, 3.5] },
      paint: { "text-color": id === "road-shields" ? "#FFFFFF" : "#202124" } })),
  ];
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const stretch = (body) => ({ svg: svg(20, 18, body), w: 20, h: 18, ratio: 3, stretchX: [[6, 14]], stretchY: [[6, 12]], content: [4, 3, 16, 15] });
export function preloadStreetIcons() {
  return ensureAll([
    ["shield-motorway", () => stretch(`<rect x=".5" y=".5" width="19" height="17" rx="4" fill="#fff"/><rect x="1.6" y="1.6" width="16.8" height="14.8" rx="3.2" fill="#1A5FB4"/>`)],
    ["shield-road", () => stretch(`<rect x=".5" y=".5" width="19" height="17" rx="4" fill="#fff" stroke="#9AA0A6" stroke-width="1"/>`)],
    ["road-oneway", () => ({ svg: svg(18, 10, `<path d="M2 5h11M10 1.8L14.5 5 10 8.2" fill="none" stroke="#80868B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`), w: 18, h: 10, ratio: 3 })],
  ]);
}
