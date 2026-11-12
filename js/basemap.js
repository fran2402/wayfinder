// The base map: OpenStreetMap data as vector tiles from OpenFreeMap (free, no key),
// styled quietly so the transport network reads first. Labels are in English where OSM has it.

import { networkSources, networkLayers } from "./network.js";
export { stopIcon } from "./network.js";

export const THEMES = {
  // Light: soft neutral land, white roads, cool water; colour is saved for the network.
  light: {
    land: "#EFEFED", water: "#C3DAEE", park: "#D9E8D2", wood: "#CFE2C7", residential: "#EAEAE7", industrial: "#E7E6E3",
    building: "#E2E1DD", buildingLine: "#D6D5D0", road: "#FFFFFF", roadEdge: "#DDDDD8", major: "#FFFFFF", majorEdge: "#D3D2CC",
    motorway: "#FFFFFF", motorwayEdge: "#C9C8C2", path: "#CFCEC8", rail: "#C6C5C0", boundary: "#B9B4C8",
    label: "#27272A", labelMuted: "#71717A", halo: "#F4F4F3", waterLabel: "#5880A8",
    casing: "#F4F4F3", stopFill: "#FFFFFF", ring: "#18181B", walk: "#3F3F46", bike: "#16A34A",
  },
  // Dark: near-black land, roads just above it, so the network glows.
  dark: {
    land: "#0E0F12", water: "#0A1B29", park: "#0F1F17", wood: "#102118", residential: "#121317", industrial: "#131418",
    building: "#1A1B20", buildingLine: "#22232A", road: "#1F2128", roadEdge: "#121317", major: "#272A32", majorEdge: "#121317",
    motorway: "#30333C", motorwayEdge: "#15161A", path: "#2A2C33", rail: "#3A3D45", boundary: "#4B4560",
    label: "#E4E4E7", labelMuted: "#8A8A93", halo: "#0E0F12", waterLabel: "#6E97BE",
    casing: "#0E0F12", stopFill: "#F4F4F5", ring: "#09090B", walk: "#D4D4D8", bike: "#4ADE80",
  },
};

const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
const z = (...stops) => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops];
const cls = (...v) => ["match", ["get", "class"], v, true, false];

export function buildStyle(theme) {
  const t = THEMES[theme];
  const net = networkLayers(t);
  const road = (id, filter, minzoom, edge, fill, widths) => [
    { id: id + "-casing", type: "line", source: "omt", "source-layer": "transportation", minzoom, filter,
      layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": edge, "line-width": z(...widths.flatMap(([zz, w]) => [zz, w + 1.6])) } },
    { id, type: "line", source: "omt", "source-layer": "transportation", minzoom, filter,
      layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": fill, "line-width": z(...widths.flatMap(([zz, w]) => [zz, w])) } },
  ];
  const notTunnel = ["!=", ["get", "brunnel"], "tunnel"];
  return {
    version: 8,
    name: "Wayfinder " + theme,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      ...networkSources(),
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": t.land } },
      { id: "landuse-residential", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 9, filter: cls("residential", "suburb", "neighbourhood"),
        paint: { "fill-color": t.residential, "fill-opacity": z(9, 0, 12, 1) } },
      { id: "landuse-industrial", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 11, filter: cls("industrial", "commercial", "retail", "railway"),
        paint: { "fill-color": t.industrial } },
      { id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wood", "forest"), paint: { "fill-color": t.wood, "fill-opacity": 0.8 } },
      { id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover", minzoom: 9, filter: cls("grass", "park", "meadow"), paint: { "fill-color": t.park, "fill-opacity": 0.7 } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": t.park } },
      { id: "landuse-green", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 11, filter: cls("cemetery", "pitch", "playground", "garden", "stadium"),
        paint: { "fill-color": t.park, "fill-opacity": 0.8 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": t.water } },
      { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 9, filter: notTunnel,
        paint: { "line-color": t.water, "line-width": z(9, 0.6, 14, 2, 18, 6) } },
      { id: "aeroway", type: "fill", source: "omt", "source-layer": "aeroway", minzoom: 11, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": t.industrial } },
      { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14,
        paint: { "fill-color": t.building, "fill-outline-color": t.buildingLine, "fill-opacity": z(14, 0, 15, 1) } },
      { id: "path", type: "line", source: "omt", "source-layer": "transportation", minzoom: 15, filter: ["all", cls("path", "track"), notTunnel],
        paint: { "line-color": t.path, "line-width": z(15, 0.8, 18, 2), "line-dasharray": [2, 1.5] } },
      ...road("road-minor", ["all", cls("minor", "service"), notTunnel], 12.5, t.roadEdge, t.road, [[12.5, 0.6], [14, 2.6], [16, 7], [19, 22]]),
      ...road("road-mid", ["all", cls("secondary", "tertiary"), notTunnel], 10, t.majorEdge, t.major, [[10, 0.8], [12, 1.8], [14, 4.5], [16, 10], [19, 30]]),
      ...road("road-major", ["all", cls("primary", "trunk"), notTunnel], 7, t.majorEdge, t.major, [[7, 0.6], [10, 1.6], [12, 2.6], [14, 6], [16, 12], [19, 34]]),
      ...road("road-motorway", ["all", cls("motorway"), notTunnel], 5, t.motorwayEdge, t.motorway, [[5, 0.6], [8, 1.2], [12, 3], [14, 6.5], [16, 13], [19, 36]]),
      { id: "rail-base", type: "line", source: "omt", "source-layer": "transportation", minzoom: 10, filter: ["all", cls("rail", "transit"), notTunnel],
        paint: { "line-color": t.rail, "line-width": z(10, 0.6, 16, 1.6) } },
      { id: "boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["<=", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": t.boundary, "line-width": z(3, 0.8, 10, 1.6), "line-dasharray": [3, 2] } },
      { id: "road-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14,
        layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": z(14, 10, 18, 13), "text-max-angle": 30 },
        paint: { "text-color": t.labelMuted, "text-halo-color": t.halo, "text-halo-width": 1.4 } },
      ...net.lines,
      ...net.stations,
      { id: "water-names", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 9, filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12, "text-max-width": 8 },
        paint: { "text-color": t.waterLabel, "text-halo-color": t.halo, "text-halo-width": 1.2 } },
      { id: "water-names-line", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 9, filter: ["==", ["geometry-type"], "LineString"],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12, "symbol-placement": "line" },
        paint: { "text-color": t.waterLabel, "text-halo-color": t.halo, "text-halo-width": 1.2 } },
      { id: "place-small", type: "symbol", source: "omt", "source-layer": "place", minzoom: 12, maxzoom: 17, filter: cls("suburb", "quarter", "neighbourhood"),
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": z(12, 10, 16, 12), "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 },
        paint: { "text-color": t.labelMuted, "text-halo-color": t.halo, "text-halo-width": 1.4, "text-opacity": 0.85 } },
      { id: "place-village", type: "symbol", source: "omt", "source-layer": "place", minzoom: 10, filter: cls("village", "hamlet"),
        layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": z(10, 10.5, 15, 13), "text-max-width": 8 },
        paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.5 } },
      { id: "place-town", type: "symbol", source: "omt", "source-layer": "place", minzoom: 6, maxzoom: 15, filter: cls("town"),
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": z(6, 10.5, 13, 15), "text-max-width": 8 },
        paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.6 } },
      { id: "place-city", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 14, filter: cls("city"),
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": z(4, 11, 8, 14, 12, 19), "text-max-width": 8,
          "symbol-sort-key": ["coalesce", ["get", "rank"], 99] },
        paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.8 } },
      { id: "place-country", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 7, filter: cls("country"),
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": z(2, 11, 6, 15), "text-transform": "uppercase", "text-letter-spacing": 0.1, "text-max-width": 7 },
        paint: { "text-color": t.labelMuted, "text-halo-color": t.halo, "text-halo-width": 1.6 } },
      ...net.labels,
    ],
  };
}
