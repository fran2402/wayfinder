// Live flights: aircraft in view on the map (from the flights relay — aircraft signals via adsb.lol),
// and tracking one: its panel updates every few seconds, the map can follow it, and its path is drawn.

import { FLIGHTS_RELAY } from "./aviation.js";
import { ensure } from "./icons.js";
import { debounce } from "./util.js";

const relay = path => FLIGHTS_RELAY.replace(/\/$/, "") + path;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// An airliner from above, nose up (the map turns it to the aircraft's track).
const PLANE = "M16 2.5c1 0 1.7 1.2 1.7 2.8v6.6l10.3 6v2.6l-10.3-3.1v6.2l3 2.3v2l-4.7-1.3-4.7 1.3v-2l3-2.3v-6.2L4 20.5v-2.6l10.3-6V5.3c0-1.6.7-2.8 1.7-2.8z";
const planeSvg = (fill, ring) => svg(32, 32, `<path d="${PLANE}" fill="${ring}" stroke="${ring}" stroke-width="3" stroke-linejoin="round"/><path d="${PLANE}" fill="${fill}"/>`);

export function preloadPlaneIcons() {
  ensure("plane", () => ({ svg: planeSvg("#1F3A5F", "#FFFFFF"), w: 32, h: 32, ratio: 3 }));
  ensure("plane-low", () => ({ svg: planeSvg("#5F7A99", "#FFFFFF"), w: 32, h: 32, ratio: 3 }));
  ensure("plane-tracked", () => ({ svg: planeSvg("#F28C28", "#FFFFFF"), w: 32, h: 32, ratio: 3 }));
}

export const planeSources = () => ({
  planes: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  "plane-trail": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
});
export function planeLayers(t) {
  const zl = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];
  return [
    { id: "plane-trail", type: "line", source: "plane-trail", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#F28C28", "line-width": zl(4, 1.5, 12, 3), "line-opacity": 0.85, "line-dasharray": [1, 1.6] } },
    { id: "planes", type: "symbol", source: "planes", minzoom: 5,
      layout: { "icon-image": ["case", ["==", ["get", "tracked"], 1], "plane-tracked", ["<", ["get", "alt"], 10000], "plane-low", "plane"],
        "icon-rotate": ["coalesce", ["get", "track"], 0], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-size": zl(5, 0.55, 10, 0.8, 14, 1), "symbol-sort-key": ["get", "tracked"],
        "text-field": ["step", ["zoom"], "", 8.5, ["get", "flight"]], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": ["case", ["==", ["get", "tracked"], 1], "#C25E00", "#1F3A5F"], "text-halo-color": t.halo, "text-halo-width": 1.4 } },
  ];
}

/** The aircraft in view, refreshed every 15 s while the layer is on; and the one being tracked. */
export class Planes {
  constructor(map) {
    this.map = map; this.on = true; this.list = []; this.tracked = null; this.trail = []; this.listeners = new Set();
    const run = debounce(() => this.update(), 500);
    map.on("moveend", run);
    setInterval(() => { if (!document.hidden) this.update(); }, 15000);
    setInterval(() => { if (!document.hidden && this.tracked) this.follow(); }, 5000);
  }
  async update() {
    if (!FLIGHTS_RELAY || !this.on || this.map.getZoom() < 5) { this.list = []; return this.render(); }
    const c = this.map.getCenter(), b = this.map.getBounds();
    const nm = Math.min(100, Math.max(5, c.distanceTo(b.getNorthEast()) / 1852));
    try {
      const d = await (await fetch(relay(`/near?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&dist=${Math.round(nm)}`))).json();
      this.list = (d.aircraft || []).filter(a => a.lat != null);
      this.render();
    } catch { /* keep the last ones */ }
  }
  render() {
    const feats = this.list.filter(a => !this.tracked || a.hex !== this.tracked.hex).map(a => this.feature(a, 0));
    if (this.tracked?.aircraft) feats.push(this.feature(this.tracked.aircraft, 1));
    this.map.getSource("planes")?.setData({ type: "FeatureCollection", features: feats });
    this.map.getSource("plane-trail")?.setData({ type: "FeatureCollection", features: this.trail.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.trail } }] : [] });
  }
  feature(a, tracked) {
    return { type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: { hex: a.hex, flight: a.flight || a.reg || a.hex, track: a.track ?? 0, alt: a.alt === "ground" ? 0 : a.alt ?? 0, tracked } };
  }
  /** Start tracking an aircraft (by its transponder address, or by flight number). */
  track({ hex, cs }, { follow = true } = {}) {
    this.tracked = { hex, cs, aircraft: this.list.find(a => a.hex === hex) || null, route: null, follow, lost: 0 };
    this.trail = this.tracked.aircraft ? [[this.tracked.aircraft.lon, this.tracked.aircraft.lat]] : [];
    this.render(); this.follow(true); this.emit();
  }
  stop() { this.tracked = null; this.trail = []; this.render(); this.emit(); }
  setFollow(on) { if (this.tracked) { this.tracked.follow = on; if (on) this.centre(); this.emit(); } }
  centre() { const a = this.tracked?.aircraft; if (a) this.map.easeTo({ center: [a.lon, a.lat], duration: 900 }); }
  async follow(first = false) {
    const t = this.tracked;
    if (!t || !FLIGHTS_RELAY) return;
    let a = null, route = t.route;
    try {
      const d = await (await fetch(relay(t.hex ? `/track?hex=${t.hex}` : `/track?cs=${encodeURIComponent(t.cs)}`))).json();
      a = d.aircraft; route = d.route || route;
    } catch { /* older relay without /track: look around the last position */ }
    if (!a && t.aircraft) {
      try {
        const d = await (await fetch(relay(`/near?lat=${t.aircraft.lat.toFixed(3)}&lon=${t.aircraft.lon.toFixed(3)}&dist=40`))).json();
        a = (d.aircraft || []).find(x => x.hex === t.hex) || null;
      } catch { /* offline */ }
    }
    if (this.tracked !== t) return;
    if (a) {
      t.aircraft = a; t.hex = a.hex; t.route = route; t.lost = 0; t.at = Date.now();
      const last = this.trail.at(-1);
      if (!last || last[0] !== a.lon || last[1] !== a.lat) this.trail.push([a.lon, a.lat]);
      if (this.trail.length > 720) this.trail.shift();
      if (t.follow) first ? this.map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(this.map.getZoom(), 8), duration: 900 }) : this.centre();
    } else t.lost++;
    this.render(); this.emit();
  }
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.tracked); }
}

/* ============================== Formatting ============================== */

export const fmt = {
  alt: a => a.alt === "ground" ? "On the ground" : a.alt != null ? `${Math.round(a.alt).toLocaleString("en")} ft · ${Math.round(a.alt * 0.3048).toLocaleString("en")} m` : "—",
  speed: a => a.gs != null ? `${Math.round(a.gs * 1.852)} km/h · ${Math.round(a.gs)} kt` : "—",
  heading: a => a.track != null ? `${String(Math.round(a.track)).padStart(3, "0")}° ${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(a.track / 45) % 8]}` : "—",
  vs: a => a.vs == null || a.alt === "ground" ? "—" : Math.abs(a.vs) < 200 ? "Level" : `${a.vs > 0 ? "Climbing" : "Descending"} ${Math.abs(Math.round(a.vs)).toLocaleString("en")} ft/min`,
};
