// Skiing: ski resorts (their areas and names), runs coloured by difficulty as on a resort's piste map
// (green novice, blue easy, red intermediate, black advanced, orange freeride), cross-country, ski touring,
// sledging and snowshoe trails, and lifts by type with their stations. Lifts come with the base map;
// runs and resorts come from OpenStreetMap (Overpass) with the sea marks, with OpenSnowMap's tiles as
// the fallback while they load.

import { ensureAll } from "./icons.js";

const DIFF = { novice: "#2E9E44", easy: "#1F6FE0", intermediate: "#E0332F", advanced: "#202124", expert: "#202124", freeride: "#F28C28", extreme: "#F28C28" };
const TYPE = {
  downhill: { w: 2.6, dash: "solid" }, playground: { w: 2, dash: "solid", col: "#2E9E44" }, snow_park: { w: 2.4, dash: "solid", col: "#F28C28" },
  nordic: { w: 1.7, dash: "dash", col: "#2B7BB9" }, skitour: { w: 1.6, dash: "dash", col: "#B5541C" }, sled: { w: 1.8, dash: "dash", col: "#8E5C3E" },
  sleigh: { w: 1.6, dash: "dash", col: "#8E5C3E" }, hike: { w: 1.6, dash: "dot", col: "#C2408F" }, connection: { w: 1.2, dash: "dot", col: "#80868B" },
  fatbike: { w: 1.4, dash: "dot", col: "#80868B" },
};
const PRIORITY = ["downhill", "snow_park", "playground", "nordic", "skitour", "sled", "sleigh", "hike", "connection"];
const LABEL = { downhill: "Run", nordic: "Cross-country trail", skitour: "Ski-touring route", sled: "Sledge run", sleigh: "Sleigh route", hike: "Snowshoe trail", connection: "Connection", snow_park: "Snow park", playground: "Ski school area" };

/** An OpenStreetMap element → ski features (none if it isn't one). */
export function skiFeatures(el, geom, centroid) {
  const t = el.tags || {};
  if (t.landuse === "winter_sports" && geom?.length > 3) {
    const name = t.name || "";
    return [
      { type: "Feature", id: el.type + el.id + "r", ski: true, geometry: { type: "Polygon", coordinates: [geom] }, properties: { sk: "resort", name } },
      ...(name ? [{ type: "Feature", id: el.type + el.id + "rl", ski: true, geometry: { type: "Point", coordinates: centroid(geom) }, properties: { sk: "resort", name } }] : []),
    ];
  }
  if (!t["piste:type"] || !geom || geom.length < 2) return null;
  const types = t["piste:type"].split(";"), pt = PRIORITY.find(p => types.includes(p)) || types[0];
  const st = TYPE[pt] || TYPE.connection, diff = t["piste:difficulty"] || "";
  const col = pt === "downhill" ? DIFF[diff] || "#7B7F86" : st.col;
  const dash = pt === "downhill" && (diff === "freeride" || diff === "extreme") ? "dash" : st.dash;
  const closed = geom.length > 3 && geom[0][0] === geom.at(-1)[0] && geom[0][1] === geom.at(-1)[1] && (t.area === "yes" || pt === "snow_park" || pt === "playground");
  const props = { sk: "piste", pt, diff, col, dash, w: st.w, name: t["piste:name"] || t.name || "", ref: (t["piste:ref"] || t.ref || "").slice(0, 3),
    kind: LABEL[pt] || "Trail", expert: diff === "expert" ? 1 : 0 };
  return [{ type: "Feature", id: el.type + el.id, ski: true, geometry: closed ? { type: "Polygon", coordinates: [geom] } : { type: "LineString", coordinates: geom }, properties: props }];
}

/* ============================== Icons ============================== */

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const badge = glyph => svg(26, 26, `<rect x=".5" y=".5" width="25" height="25" rx="7" fill="#fff"/><rect x="2" y="2" width="22" height="22" rx="5.6" fill="#3C4043"/><g fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(1 1)">${glyph}</g>`);
const ICONS = {
  // A skier on a slope, for resorts.
  "ski-resort": () => svg(30, 30, `<circle cx="15" cy="15" r="14.4" fill="#fff"/><circle cx="15" cy="15" r="12.6" fill="#1F6FE0"/>
    <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="17.6" cy="8.4" r="1.6" fill="#fff" stroke="none"/>
    <path d="M9.5 13.2l4.2-1.6 2.6 2.4-2.4 3 3.2 2.4M13.7 11.6l-1 4.6M7.2 18.6l13.6 4.6"/></g>`),
  "ski-lift-gondola": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5V8"/><rect x="7" y="8" width="10" height="10" rx="2.4"/><path d="M7 12.5h10"/>`),
  "ski-lift-cable_car": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5V7.5"/><rect x="5.5" y="7.5" width="13" height="11" rx="1.6"/><path d="M5.5 12.5h13M12 7.5v5"/>`),
  "ski-lift-chair_lift": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5v9"/><path d="M8 13.5h8M8 13.5v4h8M16 13.5V10"/>`),
  "ski-lift-mixed_lift": () => badge(`<path d="M3 6l18-3"/><path d="M9 5v8h5v4M15 4v4"/><rect x="13" y="8" width="6" height="5" rx="1.2"/>`),
  "ski-lift-drag_lift": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5v9M9 13.5h6"/><path d="M6 20l12-2"/>`),
  "ski-lift-t-bar": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5v9M9 13.5h6"/><path d="M6 20l12-2"/>`),
  "ski-lift-j-bar": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5v9h3"/><path d="M6 20l12-2"/>`),
  "ski-lift-platter": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5v8"/><circle cx="12" cy="14.5" r="2"/><path d="M6 20l12-2"/>`),
  "ski-lift-rope_tow": () => badge(`<path d="M4 18L20 8"/><path d="M7 16.2v3M12 13.2v3M17 10.2v3"/>`),
  "ski-lift-magic_carpet": () => badge(`<path d="M4 18L20 9"/><path d="M4 18h3l13-7.3V9"/>`),
  "ski-lift-zip_line": () => badge(`<path d="M3 5l18 6"/><path d="M12 8v4M10 16l2-4 2 4"/>`),
  "ski-lift-goods": () => badge(`<path d="M3 6l18-3"/><path d="M12 4.5V8"/><rect x="7.5" y="8" width="9" height="8" rx="1"/>`),
  "ski-station": () => svg(14, 14, `<rect x="1" y="1" width="12" height="12" rx="3" fill="#fff"/><rect x="2.6" y="2.6" width="8.8" height="8.8" rx="2" fill="#3C4043"/>`),
};
const REF_COLOURS = { green: "#2E9E44", blue: "#1F6FE0", red: "#E0332F", black: "#202124", orange: "#F28C28", grey: "#7B7F86" };
for (const [k, c] of Object.entries(REF_COLOURS)) ICONS["ski-ref-" + k] = () => ({ stretch: true, svg: svg(20, 20, `<rect x=".5" y=".5" width="19" height="19" rx="9.5" fill="#fff"/><rect x="2" y="2" width="16" height="16" rx="8" fill="${c}"/>`) });

export function preloadSkiIcons() {
  return ensureAll(Object.entries(ICONS).map(([id, f]) => [id, () => {
    const r = f(), s = typeof r === "string" ? r : r.svg, [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s);
    return typeof r === "string" ? { svg: s, w: +w, h: +h, ratio: 3 } : { svg: s, w: +w, h: +h, ratio: 3, stretchX: [[9, 11]], stretchY: [[9, 11]], content: [5, 3, 15, 17] };
  }]));
}

/* ============================== Layers ============================== */

export const skiSources = () => ({
  "ski-lines": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  "ski-points": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  "pistes-tiles": { type: "raster", tiles: ["https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 9, maxzoom: 18,
    attribution: '<a href="https://www.opensnowmap.org" target="_blank" rel="noopener">OpenSnowMap</a>' },
});
const zl = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];
const refIcon = ["match", ["get", "col"], "#2E9E44", "ski-ref-green", "#1F6FE0", "ski-ref-blue", "#E0332F", "ski-ref-red", "#202124", "ski-ref-black", "#F28C28", "ski-ref-orange", "ski-ref-grey"];

export function skiLayers(t) {
  const isLine = ["==", ["geometry-type"], "LineString"], piste = ["==", ["get", "sk"], "piste"];
  const width = zl(10, ["*", ["get", "w"], 0.5], 13, ["get", "w"], 17, ["*", ["get", "w"], 1.8]);
  const line = (id, dash, arr) => ({ id, type: "line", source: "ski-lines", minzoom: 10, filter: ["all", piste, isLine, ["==", ["get", "dash"], dash]],
    layout: { "line-cap": dash === "dot" ? "round" : "butt", "line-join": "round" },
    paint: { "line-color": ["get", "col"], "line-width": width, ...(arr ? { "line-dasharray": arr } : {}) } });
  return {
    areas: [
      // Resorts: a cold, pale tint with a dashed edge.
      { id: "ski-resort-fill", type: "fill", source: "ski-lines", minzoom: 8, filter: ["==", ["get", "sk"], "resort"], paint: { "fill-color": t.skiArea, "fill-opacity": 0.45 } },
      { id: "ski-resort-edge", type: "line", source: "ski-lines", minzoom: 9, filter: ["==", ["get", "sk"], "resort"], paint: { "line-color": "#5E97F6", "line-width": 1.2, "line-dasharray": [4, 3], "line-opacity": 0.7 } },
      { id: "ski-piste-areas", type: "fill", source: "ski-lines", minzoom: 11, filter: ["all", piste, ["==", ["geometry-type"], "Polygon"]], paint: { "fill-color": ["get", "col"], "fill-opacity": 0.16 } },
    ],
    lines: [
      { id: "pistes-tiles", type: "raster", source: "pistes-tiles", minzoom: 9, paint: { "raster-fade-duration": 200 } },
      // Runs on a white edge so they read on snow, forest and rock; expert runs with an orange edge.
      { id: "ski-piste-casing", type: "line", source: "ski-lines", minzoom: 11, filter: ["all", piste, isLine, ["==", ["get", "pt"], "downhill"]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["==", ["get", "expert"], 1], "#F28C28", "#FFFFFF"], "line-width": zl(10, 2.3, 13, 4.6, 17, 7.6), "line-opacity": 0.95 } },
      line("ski-piste-solid", "solid"), line("ski-piste-dash", "dash", [2.4, 1.4]), line("ski-piste-dot", "dot", [0.1, 2]),
      { id: "ski-piste-outline", type: "line", source: "ski-lines", minzoom: 12, filter: ["all", piste, ["==", ["geometry-type"], "Polygon"]], paint: { "line-color": ["get", "col"], "line-width": 1, "line-opacity": 0.6 } },
      // Lifts (base map): a dark cable with the cabins/chairs as dots.
      { id: "ski-lift", type: "line", source: "omt", "source-layer": "transportation", minzoom: 11, filter: ["==", ["get", "class"], "aerialway"],
        paint: { "line-color": "#3C4043", "line-width": zl(11, 0.8, 16, 1.6) } },
      { id: "ski-lift-dots", type: "line", source: "omt", "source-layer": "transportation", minzoom: 13, filter: ["==", ["get", "class"], "aerialway"],
        layout: { "line-cap": "round" }, paint: { "line-color": "#3C4043", "line-width": zl(13, 3.4, 17, 5.5), "line-dasharray": [0.1, 6] } },
    ],
    labels: [
      { id: "ski-piste-refs", type: "symbol", source: "ski-lines", minzoom: 13, filter: ["all", piste, isLine, ["!=", ["get", "ref"], ""]],
        layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": 10,
          "text-rotation-alignment": "viewport", "icon-rotation-alignment": "viewport", "icon-image": refIcon, "icon-text-fit": "both", "icon-text-fit-padding": [1, 2, 1, 2] },
        paint: { "text-color": "#FFFFFF" } },
      { id: "ski-piste-names", type: "symbol", source: "ski-lines", minzoom: 14, filter: ["all", piste, isLine, ["!=", ["get", "name"], ""]],
        layout: { "symbol-placement": "line", "symbol-spacing": 320, "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 11, "text-offset": [0, -0.9] },
        paint: { "text-color": ["get", "col"], "text-halo-color": t.halo, "text-halo-width": 1.6 } },
      { id: "ski-lift-labels", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 13, filter: ["==", ["get", "class"], "aerialway"],
        layout: { "symbol-placement": "line-center", "icon-image": ["concat", "ski-lift-", ["get", "subclass"]], "icon-size": 0.8, "icon-rotation-alignment": "viewport",
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-rotation-alignment": "viewport",
          "text-anchor": "left", "text-offset": [1.2, 0], "text-optional": true },
        paint: { "text-color": "#3C4043", "text-halo-color": t.halo, "text-halo-width": 1.5 } },
      { id: "ski-stations", type: "symbol", source: "omt", "source-layer": "poi", minzoom: 13, filter: ["all", ["==", ["get", "class"], "aerialway"], ["==", ["geometry-type"], "Point"]],
        layout: { "icon-image": "ski-station", "icon-allow-overlap": true, "text-field": ["step", ["zoom"], "", 15, ["coalesce", ["get", "name:en"], ["get", "name"]]],
          "text-font": ["Noto Sans Regular"], "text-size": 10, "text-anchor": "top", "text-offset": [0, 0.7], "text-optional": true },
        paint: { "text-color": "#3C4043", "text-halo-color": t.halo, "text-halo-width": 1.3 } },
      { id: "ski-resorts", type: "symbol", source: "ski-points", minzoom: 8, maxzoom: 15,
        layout: { "icon-image": "ski-resort", "icon-size": zl(8, 0.7, 12, 1), "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": zl(8, 11, 13, 13),
          "text-anchor": "top", "text-offset": [0, 1.2], "text-max-width": 9, "text-optional": true },
        paint: { "text-color": "#174EA6", "text-halo-color": t.halo, "text-halo-width": 1.6 } },
    ],
  };
}
export const SKI_LAYER_IDS = ["ski-resort-fill", "ski-resort-edge", "ski-piste-areas", "pistes-tiles", "ski-piste-casing", "ski-piste-solid", "ski-piste-dash", "ski-piste-dot",
  "ski-piste-outline", "ski-lift", "ski-lift-dots", "ski-piste-refs", "ski-piste-names", "ski-lift-labels", "ski-stations", "ski-resorts"];
