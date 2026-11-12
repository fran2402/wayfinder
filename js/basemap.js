// The base map: OpenStreetMap data as vector tiles from OpenFreeMap (free, no key),
// styled quietly so the transport network reads first. Labels are in English where OSM has it.

import { networkSources, networkLayers } from "./network.js";
export { stopIcon } from "./network.js";

/* The map palette:
   Water — Blue 250/400/800 · Vegetation — Green 150/200 · City — Grey 50/100/200/300 · Medical — Red 50
   Sand/shrub — warm Natural 100–300 · Reserves/tundra — green Natural 100–300 · Roads — asphalt greys. */
export const THEMES = {
  light: {
    land: "#EEF2E7", residential: "#EEF0F2", industrial: "#E8EAED", building: "#E1E3E6", buildingLine: "#D3D6DA",
    water: "#A8C7FA", waterLine: "#A8C7FA", waterLabel: "#185ABC",
    // Sea depth, from the shallows to the deep ocean (transparent on land).
    depth: [-9000, "#0D3A80", -6000, "#174EA6", -4000, "#185ABC", -2500, "#1A73E8", -1500, "#4285F4", -700, "#669DF6", -250, "#8AB4F8", -80, "#A8C7FA", -25, "#BCD5FB", -6, "rgba(188,213,251,0.5)", -2, "rgba(188,213,251,0)"],
    park: "#C3E6CB", wood: "#A8DAB5", grass: "#CEEAD6",
    medical: "#FCE8E6", sand: "#F5F0E4", shrub: "#EFE8D8", farm: "#F3EEE2", reserve: "#E0EBE4", wetland: "#C9DBCF", ice: "#FFFFFF", rock: "#E1E3E6",
    road: "#E3E5E8", roadEdge: "#D2D5DA", major: "#D2D5DA", majorEdge: "#BDC1C6", motorway: "#BDC1C6", motorwayEdge: "#A6AAB0",
    path: "#C6CACF", rail: "#B4B8BE", boundary: "#9AA0A6",
    label: "#3C4043", labelMuted: "#70757A", halo: "#FFFFFF", poi: "#5F6368",
    casing: "#FFFFFF", stopFill: "#FFFFFF", ring: "#1A1A1A", walk: "#1A1A1A", bike: "#1E8E3E",
    // Height, from the coast to the peaks: lowland greens, hill tans, mountain browns, rock grey, snow.
    relief: [-50, "#D8EDCB", 0, "#D8EDCB", 100, "#E0F0CC", 250, "#EAF1C8", 500, "#F1EDC0", 800, "#EEDFAE", 1200, "#E4CB98", 1700, "#D3B486", 2300, "#C3A68E", 2900, "#C9BCB3", 3500, "#E4E0DD", 4200, "#FAFAFA"],
    // Crops by the colour of their leaves.
    crops: { farmland: "#E3EBC2", orchard: "#C9E1AE", vineyard: "#D3E3A6", plant_nursery: "#C6E3B4", farm: "#ECE5D3", meadow: "#D6EBC4", allotments: "#CFE6BC" },
  },
  dark: {
    land: "#1E2320", residential: "#232528", industrial: "#25282B", building: "#2B2E32", buildingLine: "#33363B",
    water: "#16314F", waterLine: "#16314F", waterLabel: "#8AB4F8",
    depth: [-9000, "#04101F", -6000, "#06152A", -4000, "#081B35", -2500, "#0B2242", -1500, "#0E294D", -700, "#123058", -250, "#163762", -80, "#1A3D6A", -25, "#1E4372", -6, "rgba(30,67,114,0.5)", -2, "rgba(30,67,114,0)"],
    park: "#1B3324", wood: "#1E3A28", grass: "#1D3125",
    medical: "#3A2626", sand: "#2E2B24", shrub: "#2B2924", farm: "#292824", reserve: "#212D27", wetland: "#22332A", ice: "#2F3237", rock: "#2A2C30",
    road: "#3C4043", roadEdge: "#2A2D30", major: "#4A4E52", majorEdge: "#2A2D30", motorway: "#5F6368", motorwayEdge: "#2A2D30",
    path: "#45494E", rail: "#55595E", boundary: "#6E737A",
    label: "#E8EAED", labelMuted: "#9AA0A6", halo: "#1F2124", poi: "#BDC1C6",
    casing: "#1F2124", stopFill: "#F2F2F2", ring: "#0A0A0A", walk: "#F2F2F2", bike: "#81C995",
    relief: [-50, "#1C2A1F", 0, "#1C2A1F", 100, "#1F2C1F", 250, "#252D1F", 500, "#2B2D20", 800, "#302B20", 1200, "#352B21", 1700, "#382C24", 2300, "#3A302B", 2900, "#3E3836", 3500, "#4A4645", 4200, "#5C5A5A"],
    crops: { farmland: "#2A3021", orchard: "#233322", vineyard: "#28331F", plant_nursery: "#213322", farm: "#2B2924", meadow: "#22301F", allotments: "#24321F" },
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
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    sources: {
      // Elevation (Terrarium tiles, AWS Open Data): drives the height colours and the hill shading.
      dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 13,
        attribution: 'Terrain <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS</a>' },
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      ...networkSources(),
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": t.land } },
      // The ground coloured by height in steps (hypsometric tints): green lowland to white peaks. No shading.
      { id: "relief", type: "color-relief", source: "dem", paint: { "color-relief-color": ["interpolate", ["linear"], ["elevation"], ...t.relief], "color-relief-opacity": z(4, 1, 12, 0.85, 16, 0.55) } },
      { id: "landuse-residential", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 9, filter: cls("residential", "suburb", "neighbourhood"),
        paint: { "fill-color": t.residential, "fill-opacity": z(9, 0.5, 12, 1) } },
      { id: "landuse-industrial", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 11, filter: cls("industrial", "commercial", "retail", "railway"),
        paint: { "fill-color": t.industrial } },
      // Natural ground: sand and beaches, shrub and heath, farmland, wetland, ice and rock.
      { id: "landcover-farm", type: "fill", source: "omt", "source-layer": "landcover", minzoom: 8, filter: cls("farmland"),
        paint: { "fill-color": ["match", ["get", "subclass"], ...Object.entries(t.crops).flat(), t.crops.farmland], "fill-opacity": z(8, 0.45, 13, 0.8) } },
      { id: "landcover-sand", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("sand"), paint: { "fill-color": t.sand } },
      { id: "landcover-shrub", type: "fill", source: "omt", "source-layer": "landcover", filter: ["match", ["get", "subclass"], ["scrub", "heath", "fell"], true, false], paint: { "fill-color": t.shrub, "fill-opacity": 0.6 } },
      { id: "landcover-wetland", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wetland"), paint: { "fill-color": t.wetland } },
      { id: "landcover-ice", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("ice"), paint: { "fill-color": t.ice } },
      { id: "landcover-rock", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("rock"), paint: { "fill-color": t.rock } },
      // Vegetation.
      { id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wood", "forest"), paint: { "fill-color": t.wood, "fill-opacity": 0.45 } },
      { id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover", minzoom: 9, filter: ["all", cls("grass", "park", "meadow"), ["!", ["match", ["get", "subclass"], ["scrub", "heath", "fell"], true, false]]],
        paint: { "fill-color": ["match", ["get", "subclass"], "meadow", t.crops.meadow, "allotments", t.crops.allotments, t.grass], "fill-opacity": 0.5 } },
      { id: "park-reserve", type: "fill", source: "omt", "source-layer": "park", filter: cls("nature_reserve", "national_park", "protected_area"), paint: { "fill-color": t.reserve, "fill-opacity": 0.35 } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", filter: ["!", cls("nature_reserve", "national_park", "protected_area")], paint: { "fill-color": t.park } },
      { id: "landuse-green", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 11, filter: cls("cemetery", "pitch", "playground", "garden", "stadium"),
        paint: { "fill-color": t.park, "fill-opacity": 0.8 } },
      // Medical.
      { id: "landuse-medical", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 12, filter: cls("hospital"), paint: { "fill-color": t.medical } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": t.water } },
      // How deep the sea is (the elevation tiles carry the sea floor too).
      { id: "depth", type: "color-relief", source: "dem", paint: { "color-relief-color": ["interpolate", ["linear"], ["elevation"], ...t.depth], "color-relief-opacity": 1 } },
      { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 9, filter: notTunnel,
        paint: { "line-color": t.waterLine, "line-width": z(9, 0.6, 14, 2, 18, 6) } },
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
      // Places: shops, food, culture, health… (transit stops come from the network instead).
      ...[["poi-major", ["<", ["get", "rank"], 8], 14.5], ["poi-minor", [">=", ["get", "rank"], 8], 16.5]].map(([id, rank, minzoom]) => ({
        id, type: "symbol", source: "omt", "source-layer": "poi", minzoom,
        filter: ["all", ["==", ["geometry-type"], "Point"], rank, ["!", ["match", ["get", "class"], ["bus", "rail", "railway", "tram", "ferry_terminal", "aerialway"], true, false]]],
        layout: { "icon-image": ["match", ["get", "subclass"], ["florist", "furniture"], ["get", "subclass"], ["get", "class"]], "icon-size": 0.9,
          "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.7], "text-max-width": 8,
          "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": t.poi, "text-halo-color": t.halo, "text-halo-width": 1.3, "icon-opacity": 0.9 },
      })),
      ...net.labels,
    ],
  };
}
