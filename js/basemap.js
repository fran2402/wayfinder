// The base map: OpenStreetMap data as vector tiles from OpenFreeMap (free, no key),
// styled quietly so the transport network reads first. Labels are in English where OSM has it.

import { networkSources, networkLayers } from "./network.js";
import { seaSources, seaLayers } from "./maritime.js";
import { airSources, airLayers } from "./aviation.js";
import { streetLayers, streetLabels } from "./streets.js";
import { skiSources, skiLayers } from "./ski.js";
import { placeIcon, placeTextColour, HIDDEN } from "./places.js";
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
    road: "#E3E5E8", roadEdge: "#CDD0D5", major: "#D2D5DA", mid: "#DADCE0", majorEdge: "#B4B8BE", motorway: "#BDC1C6", motorwayEdge: "#9AA0A6", pedestrian: "#EEEFF1",
    tunnel: "#F4F5F7", tunnelEdge: "#9AA0A6", bridgeEdge: "#80868B", taxiway: "#A9ADB3", pierLine: "#C4C7CC",
    path: "#C6CACF", rail: "#B4B8BE", boundary: "#9AA0A6",
    label: "#3C4043", labelMuted: "#70757A", halo: "#FFFFFF", poi: "#5F6368",
    casing: "#FFFFFF", stopFill: "#FFFFFF", ring: "#1A1A1A", walk: "#1A1A1A", bike: "#1E8E3E",
    // Height, from the coast to the peaks: lowland greens, hill tans, mountain browns, rock grey, snow.
    relief: [-50, "#D8EDCB", 0, "#D8EDCB", 100, "#E0F0CC", 250, "#EAF1C8", 500, "#F1EDC0", 800, "#EEDFAE", 1200, "#E4CB98", 1700, "#D3B486", 2300, "#C3A68E", 2900, "#C9BCB3", 3500, "#E4E0DD", 4200, "#FAFAFA"],
    // Crops by the colour of their leaves.
    skiArea: "#EEF4FC", ferry: "#1A73E8", seaBorder: "#669DF6", coast: "#8AB4F8", seaLabel: "#185ABC",
    edu: "#FEF7E0", eduLine: "#F0D27A", cemetery: "#D9E5D6", cemLine: "#9DB09A", military: "#FCE8E6", milLine: "#D93025", pitch: "#B7DFB9", pitchLine: "#FFFFFF",
    pool: "#8FDCF5", poolLine: "#3BA5D8", npLine: "#1E8E3E", reserveLine: "#4CAF6A", beachLine: "#4A90E2", apron: "#DDE0E4", runway: "#8E9399", runwayLine: "#FFFFFF",
    zoo: "#E6EFD3", zooLine: "#98B56F", border: "#8E7CA8", borderHalo: "#D7CCE6", region: "#A99BBF", pier: "#F8F9FA", dam: "#C4C7CC",
    crops: { farmland: "#E3EBC2", orchard: "#C9E1AE", vineyard: "#D3E3A6", plant_nursery: "#C6E3B4", farm: "#ECE5D3", meadow: "#D6EBC4", allotments: "#CFE6BC" },
  },
  dark: {
    land: "#1E2320", residential: "#232528", industrial: "#25282B", building: "#2B2E32", buildingLine: "#33363B",
    water: "#16314F", waterLine: "#16314F", waterLabel: "#8AB4F8",
    depth: [-9000, "#04101F", -6000, "#06152A", -4000, "#081B35", -2500, "#0B2242", -1500, "#0E294D", -700, "#123058", -250, "#163762", -80, "#1A3D6A", -25, "#1E4372", -6, "rgba(30,67,114,0.5)", -2, "rgba(30,67,114,0)"],
    park: "#1B3324", wood: "#1E3A28", grass: "#1D3125",
    medical: "#3A2626", sand: "#2E2B24", shrub: "#2B2924", farm: "#292824", reserve: "#212D27", wetland: "#22332A", ice: "#2F3237", rock: "#2A2C30",
    road: "#3C4043", roadEdge: "#2A2D30", major: "#4A4E52", mid: "#44484C", majorEdge: "#2A2D30", motorway: "#5F6368", motorwayEdge: "#2A2D30", pedestrian: "#34373A",
    tunnel: "#2C2F33", tunnelEdge: "#5F6368", bridgeEdge: "#141518", taxiway: "#4A4E54", pierLine: "#3C4043",
    path: "#45494E", rail: "#55595E", boundary: "#6E737A",
    label: "#E8EAED", labelMuted: "#9AA0A6", halo: "#1F2124", poi: "#BDC1C6",
    casing: "#1F2124", stopFill: "#F2F2F2", ring: "#0A0A0A", walk: "#F2F2F2", bike: "#81C995",
    relief: [-50, "#1C2A1F", 0, "#1C2A1F", 100, "#1F2C1F", 250, "#252D1F", 500, "#2B2D20", 800, "#302B20", 1200, "#352B21", 1700, "#382C24", 2300, "#3A302B", 2900, "#3E3836", 3500, "#4A4645", 4200, "#5C5A5A"],
    skiArea: "#25303D", ferry: "#8AB4F8", seaBorder: "#4A7CC7", coast: "#2B5C93", seaLabel: "#8AB4F8",
    edu: "#2E2B20", eduLine: "#6B5B2A", cemetery: "#24302A", cemLine: "#4E6152", military: "#3A2424", milLine: "#E57373", pitch: "#25402B", pitchLine: "#6C8F72",
    pool: "#1B5A75", poolLine: "#3D8FB8", npLine: "#5FBF7A", reserveLine: "#4E9E68", beachLine: "#5B8FD0", apron: "#2C2F34", runway: "#45494F", runwayLine: "#C4C7CC",
    zoo: "#26301F", zooLine: "#5C7044", border: "#9C8BB8", borderHalo: "#3A3248", region: "#7A6E90", pier: "#2A2D31", dam: "#55595E",
    crops: { farmland: "#2A3021", orchard: "#233322", vineyard: "#28331F", plant_nursery: "#213322", farm: "#2B2924", meadow: "#22301F", allotments: "#24321F" },
  },
};

const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
const z = (...stops) => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops];
const cls = (...v) => ["match", ["get", "class"], v, true, false];

export function buildStyle(theme) {
  const t = THEMES[theme];
  const net = networkLayers(t), sea = seaLayers(t), air = airLayers(t), streets = streetLayers(t), ski = skiLayers(t);
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
      // Sea depth, made in tile-worker.js: the sea floor (only in the zoom ≤ 8 elevation tiles) spline-interpolated and coloured.
      depth: { type: "raster", tiles: [`wfdepth://${theme}/{z}/{x}/{y}`], tileSize: 256, maxzoom: 14 },
      ...seaSources(),
      ...airSources(),
      ...skiSources(),
      omt: { type: "vector", url: "wfomt://planet", attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      ...networkSources(),
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": t.land } },
      // The ground coloured by height in steps (hypsometric tints): green lowland to white peaks. No shading.
      { id: "relief", type: "color-relief", source: "dem", paint: { "color-relief-color": ["interpolate", ["linear"], ["elevation"], ...t.relief], "color-relief-opacity": 1 } },
      { id: "landuse-residential", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 9, filter: cls("residential", "suburb", "neighbourhood"),
        paint: { "fill-color": t.residential, "fill-opacity": z(9, 0.5, 12, 1) } },
      { id: "landuse-industrial", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 11, filter: cls("industrial", "commercial", "retail", "railway"),
        paint: { "fill-color": t.industrial } },
      // Natural ground: sand and beaches, shrub and heath, farmland, wetland, ice and rock.
      { id: "landcover-farm", type: "fill", source: "omt", "source-layer": "landcover", minzoom: 8, filter: cls("farmland"),
        paint: { "fill-color": ["match", ["get", "subclass"], ...Object.entries(t.crops).flat(), t.crops.farmland], "fill-opacity": 0.5 } },
      { id: "landcover-sand", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("sand"), paint: { "fill-color": t.sand } },
      { id: "landcover-shrub", type: "fill", source: "omt", "source-layer": "landcover", filter: ["match", ["get", "subclass"], ["scrub", "heath", "fell"], true, false], paint: { "fill-color": t.shrub, "fill-opacity": 0.6 } },
      { id: "landcover-wetland", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wetland"), paint: { "fill-color": t.wetland } },
      { id: "landcover-ice", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("ice"), paint: { "fill-color": t.ice } },
      { id: "landcover-rock", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("rock"), paint: { "fill-color": t.rock } },
      // Vegetation: see-through tints over the height colours, so a forest high up looks different from one low down.
      { id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wood", "forest"), paint: { "fill-color": t.wood, "fill-opacity": 0.45 } },
      { id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover", minzoom: 9, filter: ["all", cls("grass", "park", "meadow"), ["!", ["match", ["get", "subclass"], ["scrub", "heath", "fell"], true, false]]],
        paint: { "fill-color": ["match", ["get", "subclass"], "meadow", t.crops.meadow, "allotments", t.crops.allotments, t.grass], "fill-opacity": 0.5 } },
      { id: "park-reserve", type: "fill", source: "omt", "source-layer": "park", filter: cls("nature_reserve", "national_park", "protected_area"), paint: { "fill-color": t.reserve, "fill-opacity": 0.35 } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", filter: ["!", cls("nature_reserve", "national_park", "protected_area")], paint: { "fill-color": t.park, "fill-opacity": 0.55 } },
      { id: "landuse-green", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 11, filter: cls("cemetery", "pitch", "playground", "garden", "stadium"),
        paint: { "fill-color": t.park, "fill-opacity": 0.5 } },
      // Medical.
      { id: "landuse-medical", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 12, filter: cls("hospital"), paint: { "fill-color": t.medical } },
      // More land use: schools, cemeteries, sports, zoos, military, quarries, dams.
      { id: "landuse-edu", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 12, filter: cls("school", "university", "college", "kindergarten"), paint: { "fill-color": t.edu } },
      { id: "landuse-cemetery", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 12, filter: cls("cemetery"), paint: { "fill-color": t.cemetery } },
      { id: "landuse-pitch", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 14, filter: cls("pitch", "track", "stadium"), paint: { "fill-color": t.pitch, "fill-opacity": 0.8 } },
      { id: "landuse-zoo", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 12, filter: cls("zoo", "theme_park"), paint: { "fill-color": t.zoo } },
      { id: "landuse-military", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 10, filter: cls("military"), paint: { "fill-color": t.military, "fill-opacity": 0.6 } },
      { id: "landuse-quarry", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 12, filter: cls("quarry"), paint: { "fill-color": t.rock } },
      { id: "landuse-dam", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 13, filter: cls("dam"), paint: { "fill-color": t.dam } },
      ...ski.areas,
      { id: "water", type: "fill", source: "omt", "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": t.water } },
      // How deep the sea is (the elevation tiles carry the sea floor too).
      { id: "depth", type: "raster", source: "depth", paint: { "raster-resampling": "linear", "raster-fade-duration": 150 } },
      // Swimming pools; water that comes and goes.
      { id: "water-pool", type: "fill", source: "omt", "source-layer": "water", minzoom: 14, filter: cls("swimming_pool"), paint: { "fill-color": t.pool, "fill-outline-color": t.poolLine } },
      { id: "water-intermittent", type: "line", source: "omt", "source-layer": "water", minzoom: 11, filter: ["==", ["get", "intermittent"], 1],
        paint: { "line-color": t.waterLine === t.water ? t.poolLine : t.waterLine, "line-width": 1, "line-dasharray": [3, 2] } },
      { id: "waterway-intermittent", type: "line", source: "omt", "source-layer": "waterway", minzoom: 11, filter: ["all", notTunnel, ["==", ["get", "intermittent"], 1]],
        paint: { "line-color": t.water, "line-width": z(11, 0.6, 16, 2), "line-dasharray": [2, 2] } },
      { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 9, filter: ["all", notTunnel, ["!=", ["get", "intermittent"], 1]],
        paint: { "line-color": t.waterLine, "line-width": z(9, 0.6, 14, 2, 18, 6) } },
      { id: "aeroway", type: "fill", source: "omt", "source-layer": "aeroway", minzoom: 11, filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["match", ["get", "class"], "runway", t.runway, "taxiway", t.taxiway, "apron", t.apron, t.industrial] } },
      // The sea: a fine coastline, ferry routes, territorial waters.
      { id: "coastline", type: "line", source: "omt", "source-layer": "water", minzoom: 10, filter: cls("ocean", "sea", "bay", "lake"), paint: { "line-color": t.coast, "line-width": z(10, 0.5, 16, 1.2), "line-opacity": 0.8 } },
      { id: "ferry-route", type: "line", source: "omt", "source-layer": "transportation", minzoom: 7, filter: cls("ferry"), layout: { "line-cap": "round" },
        paint: { "line-color": t.ferry, "line-width": z(7, 0.8, 12, 1.6, 16, 2.4), "line-dasharray": [3, 2.5], "line-opacity": 0.85 } },
      { id: "sea-border", type: "line", source: "omt", "source-layer": "boundary", minzoom: 5, filter: ["all", ["==", ["get", "maritime"], 1], ["<=", ["get", "admin_level"], 4]],
        paint: { "line-color": t.seaBorder, "line-width": z(5, 0.6, 12, 1.2), "line-dasharray": [6, 3], "line-opacity": 0.7 } },
      // Sea areas and lines: traffic separation schemes, restricted areas, anchorages, cables, pipelines…
      ...sea.under,
      // Airports: aprons, taxiways and runways (with centre lines).
      { id: "aeroway-apron", type: "fill", source: "omt", "source-layer": "aeroway", minzoom: 13, filter: ["all", ["==", ["geometry-type"], "Polygon"], cls("apron")], paint: { "fill-color": t.apron } },
      ...air.ground,
      // Piers.
      { id: "pier", type: "fill", source: "omt", "source-layer": "transportation", minzoom: 13, filter: ["all", ["==", ["geometry-type"], "Polygon"], cls("pier")], paint: { "fill-color": t.pier } },
      { id: "pier-edge", type: "line", source: "omt", "source-layer": "transportation", minzoom: 14, filter: ["all", ["==", ["geometry-type"], "Polygon"], cls("pier")], paint: { "line-color": t.pierLine, "line-width": z(14, 0.6, 18, 1.4) } },
      { id: "pier-line-casing", type: "line", source: "omt", "source-layer": "transportation", minzoom: 14, filter: ["all", ["==", ["geometry-type"], "LineString"], cls("pier")],
        layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": t.pierLine, "line-width": z(14, 2.6, 18, 10.5) } },
      { id: "pier-line", type: "line", source: "omt", "source-layer": "transportation", minzoom: 14, filter: ["all", ["==", ["geometry-type"], "LineString"], cls("pier")],
        layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": t.pier, "line-width": z(14, 1.5, 18, 8) } },
      // Edges: each kind of area with its own colour and line style.
      { id: "edge-national-park-band", type: "line", source: "omt", "source-layer": "park", minzoom: 6, filter: cls("national_park"),
        paint: { "line-color": t.npLine, "line-opacity": 0.18, "line-width": z(6, 3, 12, 8), "line-offset": z(6, 1.5, 12, 4) } },
      { id: "edge-national-park", type: "line", source: "omt", "source-layer": "park", minzoom: 6, filter: cls("national_park"),
        paint: { "line-color": t.npLine, "line-width": z(6, 0.8, 12, 1.6), "line-dasharray": [4, 2] } },
      { id: "edge-reserve-band", type: "line", source: "omt", "source-layer": "park", minzoom: 9, filter: cls("nature_reserve", "protected_area"),
        paint: { "line-color": t.reserveLine, "line-opacity": 0.14, "line-width": z(9, 2, 14, 6), "line-offset": z(9, 1, 14, 3) } },
      { id: "edge-reserve", type: "line", source: "omt", "source-layer": "park", minzoom: 9, filter: cls("nature_reserve", "protected_area"),
        paint: { "line-color": t.reserveLine, "line-width": z(9, 0.6, 14, 1.2), "line-dasharray": [2, 2] } },
      { id: "edge-military-band", type: "line", source: "omt", "source-layer": "landuse", minzoom: 10, filter: cls("military"),
        paint: { "line-color": t.milLine, "line-opacity": 0.15, "line-width": z(10, 2, 15, 6), "line-offset": z(10, 1, 15, 3) } },
      { id: "edge-military", type: "line", source: "omt", "source-layer": "landuse", minzoom: 10, filter: cls("military"),
        paint: { "line-color": t.milLine, "line-width": 1, "line-dasharray": [5, 3] } },
      { id: "edge-hospital", type: "line", source: "omt", "source-layer": "landuse", minzoom: 13, filter: cls("hospital"), paint: { "line-color": "#E8A39C", "line-width": 1 } },
      { id: "edge-edu", type: "line", source: "omt", "source-layer": "landuse", minzoom: 13, filter: cls("school", "university", "college", "kindergarten"), paint: { "line-color": t.eduLine, "line-width": 0.8 } },
      { id: "edge-cemetery", type: "line", source: "omt", "source-layer": "landuse", minzoom: 13, filter: cls("cemetery"), paint: { "line-color": t.cemLine, "line-width": 0.8 } },
      { id: "edge-zoo", type: "line", source: "omt", "source-layer": "landuse", minzoom: 13, filter: cls("zoo", "theme_park"), paint: { "line-color": t.zooLine, "line-width": 1, "line-dasharray": [3, 1.5] } },
      { id: "edge-pitch", type: "line", source: "omt", "source-layer": "landuse", minzoom: 15, filter: cls("pitch", "track"), paint: { "line-color": t.pitchLine, "line-width": 1.2 } },
      // Beaches (where people swim): a dotted blue edge.
      { id: "edge-beach", type: "line", source: "omt", "source-layer": "landcover", minzoom: 12, filter: ["==", ["get", "subclass"], "beach"],
        paint: { "line-color": t.beachLine, "line-width": z(12, 0.8, 16, 1.6), "line-dasharray": [0.5, 2] }, layout: { "line-cap": "round" } },
      ...streets.tunnels,
      { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14,
        paint: { "fill-color": t.building, "fill-outline-color": t.buildingLine, "fill-opacity": z(14, 0, 15, 1) } },
      { id: "path", type: "line", source: "omt", "source-layer": "transportation", minzoom: 15, filter: ["all", cls("path", "track"), notTunnel, ["!=", ["get", "subclass"], "pedestrian"]],
        paint: { "line-color": t.path, "line-width": z(15, 0.8, 18, 2), "line-dasharray": [2, 1.5] } },
      ...streets.roads,
      { id: "rail-tunnel", type: "line", source: "omt", "source-layer": "transportation", minzoom: 12, filter: ["all", cls("rail", "transit"), ["==", ["get", "brunnel"], "tunnel"], ["!", ["has", "service"]]],
        paint: { "line-color": t.rail, "line-width": z(12, 0.6, 16, 1.4), "line-opacity": 0.6, "line-dasharray": [3, 2] } },
      { id: "rail-base", type: "line", source: "omt", "source-layer": "transportation", minzoom: 10, filter: ["all", cls("rail", "transit"), notTunnel],
        paint: { "line-color": t.rail, "line-width": z(10, 0.6, 16, 1.6) } },
      ...streets.bridges,
      ...ski.lines,
      // Borders: countries as a dash-dot line on a soft halo, regions dotted, disputed borders fainter.
      { id: "border-halo", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
        paint: { "line-color": t.borderHalo, "line-width": z(3, 3, 8, 6, 14, 10), "line-opacity": 0.55 } },
      { id: "border-country", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
        paint: { "line-color": t.border, "line-width": z(3, 0.8, 8, 1.4, 14, 2), "line-dasharray": [5, 2, 1, 2] } },
      { id: "border-disputed", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["==", ["get", "disputed"], 1]],
        paint: { "line-color": t.border, "line-width": z(3, 0.8, 10, 1.4), "line-opacity": 0.6, "line-dasharray": [2, 3] } },
      { id: "border-region", type: "line", source: "omt", "source-layer": "boundary", minzoom: 5, filter: ["all", ["match", ["get", "admin_level"], [3, 4], true, false], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": t.region, "line-width": z(5, 0.6, 12, 1.2), "line-dasharray": [1, 2] }, layout: { "line-cap": "round" } },
      ...streetLabels(t),
      ...net.lines,
      ...net.stations,
      // Names on the water: oceans and seas wide and spaced out, bays and straits smaller, all in italic navy.
      { id: "sea-names", type: "symbol", source: "omt", "source-layer": "water_name", maxzoom: 10, filter: ["all", ["==", ["geometry-type"], "Point"], cls("ocean", "sea")],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": z(2, 11, 8, 16), "text-letter-spacing": 0.25, "text-max-width": 6, "text-transform": "uppercase" },
        paint: { "text-color": t.seaLabel, "text-halo-color": t.water, "text-halo-width": 0.8, "text-opacity": 0.85 } },
      { id: "water-names", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 9, filter: ["all", ["==", ["geometry-type"], "Point"], ["!", cls("ocean", "sea")]],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": z(9, 11, 15, 13), "text-max-width": 8, "text-letter-spacing": 0.05 },
        paint: { "text-color": t.seaLabel, "text-halo-color": t.halo, "text-halo-width": 1.2 } },
      { id: "water-names-line", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 9, filter: ["==", ["geometry-type"], "LineString"],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12, "symbol-placement": "line" },
        paint: { "text-color": t.seaLabel, "text-halo-color": t.halo, "text-halo-width": 1.2 } },
      { id: "ferry-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 11, filter: cls("ferry"),
        layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 11, "symbol-spacing": 400 },
        paint: { "text-color": t.ferry, "text-halo-color": t.halo, "text-halo-width": 1.3 } },
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
        filter: ["all", ["==", ["geometry-type"], "Point"], rank, ["!", ["in", ["get", "class"], ["literal", HIDDEN]]]],
        layout: { "icon-image": placeIcon, "icon-size": ["interpolate", ["linear"], ["zoom"], minzoom, 0.72, 18, 0.92],
          "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.95], "text-max-width": 8,
          "text-optional": true, "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": placeTextColour(theme === "dark"), "text-halo-color": t.halo, "text-halo-width": 1.4 },
      })),
      // Marinas and ferry terminals (base map), Blue Flags, lighthouses, harbours and slipways (OpenStreetMap, live).
      { id: "sea-poi", type: "symbol", source: "omt", "source-layer": "poi", minzoom: 12, filter: ["all", ["==", ["geometry-type"], "Point"], cls("harbor", "ferry_terminal")],
        layout: { "icon-image": ["match", ["get", "class"], "ferry_terminal", "sm-ferry", "sm-marina"], "icon-size": z(12, 0.7, 16, 0.95),
          "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 1.1], "text-max-width": 8, "text-optional": true },
        paint: { "text-color": t.seaLabel, "text-halo-color": t.halo, "text-halo-width": 1.3 } },
      ...air.labels,
      ...ski.labels,
      ...sea.over,
      ...net.labels,
    ],
  };
}
