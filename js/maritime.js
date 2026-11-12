// The sea, drawn as a chart would draw it — crisp, and in the map's own style. Everything is vector:
// buoys and beacons in their real shapes, colours and topmarks, lights with their flares, sectors and
// characteristics, landmarks, rocks, wrecks, moorings, harbour facilities, traffic separation schemes,
// cables, restricted areas… The data is OpenStreetMap's sea marks (the OpenSeaMap tagging) for the whole
// world, made into one vector-tile file (data/sea.pmtiles) when the site is published — see
// tools/build-sea.mjs. The drawings and the reading of the tags live in seamarks-core.js.

import { ensure, ensureAll } from "./icons.js";
import { debounce } from "./util.js";
import { iconDef, FLARE, MAG, STATIC } from "./seamarks-core.js";

/** The icons the base map itself uses (marinas and ferry terminals from its own tiles). */
export function preloadSeaIcons() { return ensureAll(Object.keys(STATIC).map(id => [id, iconDef(id)])); }
/** What a mark is, from its icon id: for its panel's title. */
export function seaKind(icon = "") {
  if (icon.startsWith("sm-b-")) return /stake|tower|lattice|cairn/.test(icon) ? "Beacon" : "Buoy";
  const k = [["sm-lighthouse", "Lighthouse"], ["sm-light-major", "Major light"], ["sm-light", "Light"], ["sm-rock", "Rock"], ["sm-wreck", "Wreck"], ["sm-obstruction", "Obstruction"],
    ["sm-mooring", "Mooring"], ["sm-marina", "Marina"], ["sm-harbour", "Harbour"], ["sm-anchorage", "Anchorage"], ["sm-f-", "Harbour facility"], ["sm-notice", "Notice"], ["sm-hm", "Harbour master"],
    ["sm-lm-", "Landmark"], ["sm-rescue", "Rescue station"], ["sm-coastguard", "Coastguard"], ["sm-signal", "Signal station"], ["sm-radar", "Radar station"], ["sm-station", "Radio station"],
    ["sm-pilot", "Pilot boarding"], ["sm-platform", "Offshore platform"], ["sm-berth", "Berth"], ["sm-crane", "Crane"], ["sm-fog", "Fog signal"], ["sm-distance", "Distance mark"],
    ["sm-callin", "Calling-in point"], ["sm-fishing", "Fishing facility"], ["sm-farm", "Marine farm"], ["sm-blueflag", "Blue Flag"], ["sm-bridge", "Bridge"], ["sm-lock", "Lock"]].find(([p]) => icon.startsWith(p));
  return k ? k[1] : "Sea mark";
}
/** A sea mark's icon, drawn when the map first needs it. */
export function seaIcon(id) { const d = iconDef(id); if (d) ensure(id, d); }

/** Light sectors: arcs a fixed distance on screen from each light, in the sector's colour, with dashed limits. */
export class SeaArcs {
  constructor(map) {
    this.map = map; this.on = true;
    const run = debounce(() => this.update(), 150);
    map.on("moveend", run);
    map.on("sourcedata", e => { if (e.sourceId === "sea" && e.isSourceLoaded) run(); });
  }
  update() {
    const src = this.map.getSource("sea-arcs");
    if (!src) return;
    const z = this.map.getZoom(), feats = [];
    if (this.on && z >= 11.5) {
      const seen = new Set();
      for (const f of this.map.querySourceFeatures("sea", { sourceLayer: "marks", filter: ["has", "sec"] })) {
        const [lon, lat] = f.geometry.coordinates, key = f.properties.oid || lon + "," + lat;
        if (seen.has(key)) continue; // a light near a tile edge comes in each tile
        seen.add(key);
        const k = Math.cos(lat * Math.PI / 180), mpp = 78271.517 * k / 2 ** z, r = (f.properties.maj ? 72 : 48) * mpp;
        const at = (b, d) => [lon + d * Math.sin(b * Math.PI / 180) / (111320 * k), lat + d * Math.cos(b * Math.PI / 180) / 110540];
        for (const s of String(f.properties.sec).split(";")) {
          const [start, end, colour] = s.split(",");
          // Sector limits are bearings towards the light from seaward.
          const a0 = (+start + 180) % 360; let a1 = (+end + 180) % 360; if (a1 <= a0) a1 += 360;
          const pts = []; for (let a = a0; a <= a1 + 0.01; a += Math.max(2, (a1 - a0) / 48)) pts.push(at(Math.min(a, a1), r));
          feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: { c: FLARE[colour] || MAG, t: "arc" } });
          for (const a of [a0, a1]) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lon, lat], at(a, r * 1.55)] }, properties: { t: "limit" } });
        }
      }
    }
    src.setData({ type: "FeatureCollection", features: feats });
  }
}

/* ============================== Layers ============================== */

export const seaSources = () => ({
  sea: { type: "vector", url: "pmtiles://" + new URL("data/sea.pmtiles", location.href).href, maxzoom: 14,
    attribution: '<a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a> tagging' },
  "sea-arcs": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
});
const zs = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];
const lines = { source: "sea", "source-layer": "lines" };

/** Areas and lines go under the labels; marks, arcs and names over everything else. */
export function seaLayers(t) {
  const line = (id, dash, extra = {}) => ({ id, type: "line", ...lines, minzoom: 9, filter: ["all", ["==", ["get", "dash"], dash.k], ["!=", ["geometry-type"], "Polygon"]],
    layout: { "line-cap": dash.k === "dot" ? "round" : "butt", "line-join": "round" },
    paint: { "line-color": ["get", "line"], "line-width": zs(9, ["*", ["get", "w"], 0.7], 14, ["*", ["get", "w"], 1], 18, ["*", ["get", "w"], 1.4]), "line-opacity": ["get", "o"], ...(dash.a ? { "line-dasharray": dash.a } : {}), ...extra } });
  return {
    under: [
      { id: "sea-area", type: "fill", ...lines, minzoom: 9, filter: ["all", ["==", ["geometry-type"], "Polygon"], ["has", "fill"]], paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fo"] } },
      line("sea-line-solid", { k: "solid" }),
      line("sea-line-dash", { k: "dash", a: [4, 3] }),
      line("sea-line-dot", { k: "dot", a: [0.1, 2.6] }),
      { id: "sea-line-names", type: "symbol", ...lines, minzoom: 13, filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "name"], ""]],
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 10.5, "symbol-spacing": 300 },
        paint: { "text-color": t.seaLabel, "text-halo-color": t.halo, "text-halo-width": 1.3 } },
      { id: "sea-lane-arrows", type: "symbol", ...lines, minzoom: 10, filter: ["==", ["get", "lane"], 1],
        layout: { "symbol-placement": "line", "symbol-spacing": 220, "icon-image": "sm-arrow", "icon-size": zs(9, 0.75, 13, 1, 18, 1.3), "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true } },
    ],
    over: [
      { id: "sea-arc-limits", type: "line", source: "sea-arcs", filter: ["==", ["get", "t"], "limit"], paint: { "line-color": t.label, "line-width": 0.8, "line-opacity": 0.55, "line-dasharray": [5, 4] } },
      { id: "sea-arc-halo", type: "line", source: "sea-arcs", filter: ["==", ["get", "t"], "arc"], layout: { "line-cap": "round" }, paint: { "line-color": "#FFFFFF", "line-width": 5.5, "line-opacity": 0.9 } },
      { id: "sea-arcs", type: "line", source: "sea-arcs", filter: ["==", ["get", "t"], "arc"], layout: { "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": 3.2 } },
      ...[[1, 9], [2, 11], [3, 12.5], [4, 14.5]].map(([tier, minzoom]) => ({
        id: "sea-marks-" + tier, type: "symbol", source: "sea", "source-layer": "marks", minzoom, filter: ["==", ["get", "tier"], tier],
        layout: { "icon-image": ["get", "icon"], "icon-anchor": ["get", "anchor"], "icon-size": zs(minzoom, 0.72, Math.min(minzoom + 2.5, 18), 0.92, 19, 1.05), "icon-padding": 0, "icon-allow-overlap": tier <= 2,
          "text-field": ["step", ["zoom"], "", 12.5, ["get", "name"], 14, ["get", "label"]], "text-font": ["Noto Sans Italic"], "text-size": 10.5, "text-optional": true,
          "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 1.3, "text-justify": "auto", "text-max-width": 10, "symbol-sort-key": tier },
        paint: { "text-color": t.seaLabel, "text-halo-color": t.halo, "text-halo-width": 1.3 },
      })),
    ],
  };
}
export const SEA_LAYER_IDS = ["sea-area", "sea-line-solid", "sea-line-dash", "sea-line-dot", "sea-lane-arrows", "sea-line-names", "sea-arc-limits", "sea-arc-halo", "sea-arcs",
  "sea-marks-1", "sea-marks-2", "sea-marks-3", "sea-marks-4", "sea-poi", "ferry-route", "ferry-names", "sea-border"];
export const SEA_CLICK_LAYERS = ["sea-marks-1", "sea-marks-2", "sea-marks-3", "sea-marks-4"];
