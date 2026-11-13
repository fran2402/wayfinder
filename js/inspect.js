// Things on the map you can tap that aren't shops or stops: countries, regions, cities, towns,
// neighbourhoods (their outline and size, from OpenStreetMap through Nominatim), streets (their whole
// length, from OpenStreetMap through QLever), peaks and named waters.

const NOMINATIM = "https://nominatim.openstreetmap.org";
const QLEVER = "https://qlever.dev/api/osm-planet";

/* ------------------------------ Outlines ------------------------------ */

// Nominatim's "zoom" for each kind of place: the size of area its reverse lookup answers with.
export const AREA_ZOOM = { continent: 3, country: 3, state: 5, province: 5, region: 5, county: 8, district: 10, city: 10, municipality: 10,
  town: 12, borough: 12, village: 13, hamlet: 14, suburb: 14, quarter: 14, neighbourhood: 14, island: 12, islet: 14 };
export const VIEW_ZOOM = { 3: 4.5, 5: 6.5, 8: 8.5, 10: 10.5, 12: 12, 13: 13, 14: 13.8 };
const KIND_NAMES = { country: "Country", state: "Region", province: "Province", region: "Region", county: "County", city: "City", town: "Town", village: "Village",
  hamlet: "Hamlet", suburb: "District", quarter: "Neighbourhood", neighbourhood: "Neighbourhood", island: "Island", municipality: "Municipality", borough: "Borough" };
export const kindName = k => KIND_NAMES[k] || (k ? k[0].toUpperCase() + k.slice(1).replace(/_/g, " ") : "Area");

const outlines = new Map();
let lastCall = 0;
/** The area around a point at a size (Nominatim zoom): its name, kind, outline and size. Cached; at most one request a second. */
export function areaAt(lon, lat, zoom) {
  const key = `${zoom}/${lon.toFixed(4)}/${lat.toFixed(4)}`;
  if (!outlines.has(key)) outlines.set(key, (async () => {
    const wait = lastCall + 1100 - Date.now(); lastCall = Date.now() + Math.max(0, wait);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const tol = zoom <= 3 ? 0.01 : zoom <= 5 ? 0.003 : zoom <= 10 ? 0.0008 : 0.0002;
    const res = await fetch(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&zoom=${zoom}&format=jsonv2&polygon_geojson=1&polygon_threshold=${tol}&accept-language=en`);
    if (!res.ok) throw new Error("Nominatim " + res.status);
    const d = await res.json();
    if (d.error || !d.geojson || !/Polygon/.test(d.geojson.type)) return null;
    const polys = d.geojson.type === "Polygon" ? [d.geojson.coordinates] : d.geojson.coordinates;
    return { name: d.name || d.display_name?.split(",")[0], kind: d.addresstype || d.type, geojson: d.geojson, area: polys.reduce((a, p) => a + polyArea(p), 0),
      perimeter: polys.reduce((a, p) => a + lineLength(p[0]), 0), bbox: (d.boundingbox || []).map(Number), osm: d.osm_type && { type: d.osm_type, id: d.osm_id },
      within: d.display_name?.split(",").slice(1).map(s => s.trim()).filter(Boolean).slice(-2).join(", ") };
  })().catch(e => { outlines.delete(key); throw e; }));
  return outlines.get(key);
}

const R = 6371008.8, rad = d => d * Math.PI / 180;
/** Area of a polygon (outer ring minus holes), in square metres, on the sphere. */
function polyArea(rings) {
  const ring = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) { const [a, b] = r[i], [c, d] = r[i + 1]; s += rad(c - a) * (2 + Math.sin(rad(b)) + Math.sin(rad(d))); } return Math.abs(s * R * R / 2); };
  return Math.max(0, ring(rings[0]) - rings.slice(1).reduce((a, h) => a + ring(h), 0));
}
const hav = ([a, b], [c, d]) => { const x = Math.sin(rad(d - b) / 2) ** 2 + Math.cos(rad(b)) * Math.cos(rad(d)) * Math.sin(rad(c - a) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function lineLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += hav(pts[i - 1], pts[i]); return s; }

/* ------------------------------ Streets ------------------------------ */

const streets = new Map();
/** Every stretch of road with this name within 6 km of a point: their total length and the lines. */
export function streetNear(name, lon, lat) {
  const key = name + "|" + lon.toFixed(2) + "|" + lat.toFixed(2);
  if (!streets.has(key)) streets.set(key, (async () => {
    const lit = JSON.stringify(name);
    const q = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?w ?h ?wkt WHERE { ?w osmkey:name ${lit} ; osmkey:highway ?h ; geo:hasGeometry/geo:asWKT ?wkt . FILTER(geof:distance(?wkt, "POINT(${lon} ${lat})"^^geo:wktLiteral) < 6) } LIMIT 3000`;
    const res = await fetch(QLEVER, { method: "POST", body: new URLSearchParams({ query: q }), headers: { Accept: "application/sparql-results+json" } });
    if (!res.ok) throw new Error("QLever " + res.status);
    const rows = (await res.json()).results.bindings;
    // Pavements, crossings and cycle tracks often carry the street's name too: when there's a road
    // by that name, only the road counts.
    const SIDE = /^(footway|sidewalk|crossing|cycleway|path|steps|corridor|platform|bridleway|elevator|proposed|construction)$/;
    const val = r => r.h.value.replace(/^"|"$/g, "");
    const roads = rows.filter(r => !SIDE.test(val(r)));
    const use = roads.length ? roads : rows;
    const lines = [], kinds = new Map();
    for (const r of use) {
      const m = /LINESTRING\s*\(([^)]*)\)/.exec(r.wkt.value);
      if (!m) continue;
      const pts = m[1].split(",").map(p => p.trim().split(/\s+/).map(Number));
      lines.push(pts);
      const h = r.h.value.replace(/^"|"$/g, ""), len = lineLength(pts);
      kinds.set(h, (kinds.get(h) || 0) + len);
    }
    if (!lines.length) return null;
    const length = lines.reduce((a, l) => a + lineLength(l), 0);
    const kind = [...kinds].sort((a, b) => b[1] - a[1])[0][0];
    return { name, length, kind, ways: lines.length, geojson: { type: "MultiLineString", coordinates: lines } };
  })().catch(e => { streets.delete(key); throw e; }));
  return streets.get(key);
}
const ROAD_KINDS = { motorway: "Motorway", trunk: "Expressway", primary: "Main road", secondary: "Secondary road", tertiary: "Local road", residential: "Residential street",
  living_street: "Living street", pedestrian: "Pedestrian street", service: "Service road", unclassified: "Minor road", footway: "Footpath", path: "Path", cycleway: "Cycle path",
  track: "Track", steps: "Steps", motorway_link: "Motorway ramp", primary_link: "Slip road", secondary_link: "Slip road", tertiary_link: "Slip road", trunk_link: "Slip road" };
export const roadKind = k => ROAD_KINDS[k] || "Road";

/** The street at a point (a tap on a road with no name label), from Nominatim. */
export async function streetAt(lon, lat) {
  const res = await fetch(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&zoom=17&format=jsonv2&accept-language=en`);
  if (!res.ok) return null;
  const d = await res.json();
  return d.address?.road || d.address?.pedestrian || d.address?.footway || null;
}

/* ------------------------------ Formatting ------------------------------ */

export const fmtLength = m => m >= 10000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
export const fmtArea = a => a >= 1e8 ? `${Math.round(a / 1e6).toLocaleString("en")} km²` : a >= 1e6 ? `${(a / 1e6).toFixed(1)} km²` : `${(a / 1e4).toFixed(1)} ha`;
export function bboxOf(geojson) {
  const b = [180, 90, -180, -90];
  const walk = c => { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  walk(geojson.coordinates);
  return b;
}
