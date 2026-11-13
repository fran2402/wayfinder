// Live boats (AIS). Around Finland and the northern Baltic straight from Digitraffic (Finnish Transport
// Infrastructure Agency: free, open, no key); everywhere else through the flights relay's /ships,
// which listens to aisstream.io for a few seconds per area (needs the relay secret AISSTREAM_KEY).

import { FLIGHTS_RELAY } from "./aviation.js";
import { ensure } from "./icons.js";
import { debounce } from "./util.js";

const DIGITRAFFIC = "https://meri.digitraffic.fi/api/ais/v1";
const DT_BOX = [9, 53.5, 31.5, 66.5]; // where Digitraffic sees ships

/* ------------------------------ Kinds of ship ------------------------------ */

export const SHIP_KINDS = {
  cargo: ["#2E8B57", "Cargo ship"], tanker: ["#C62828", "Tanker"], passenger: ["#1A73E8", "Passenger ship"], fishing: ["#E67E22", "Fishing boat"],
  pleasure: ["#8E44AD", "Pleasure craft"], sailing: ["#8E44AD", "Sailing boat"], tug: ["#00838F", "Tug"], highspeed: ["#F4B400", "High-speed craft"],
  service: ["#00838F", "Service vessel"], military: ["#455A64", "Military ship"], other: ["#6E7681", "Vessel"],
};
export function kindOf(type) {
  const t = +type || 0;
  if (t >= 70 && t < 80) return "cargo";
  if (t >= 80 && t < 90) return "tanker";
  if (t >= 60 && t < 70) return "passenger";
  if (t >= 40 && t < 50) return "highspeed";
  if (t === 30) return "fishing";
  if (t === 36) return "sailing";
  if (t === 37) return "pleasure";
  if (t === 31 || t === 32 || t === 52) return "tug";
  if (t === 35) return "military";
  if (t >= 50 && t < 60) return "service";
  return "other";
}
const STATUS = ["Under way", "At anchor", "Not under command", "Restricted manoeuvrability", "Constrained by draught", "Moored", "Aground", "Fishing", "Sailing"];
export const statusText = n => STATUS[n] || null;

/* ------------------------------ Icons ------------------------------ */

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// A hull from above, bow up (turned to the ship's heading); a circle when it isn't moving.
const HULL = "M12 2.5c2.6 2.4 4.3 5.6 4.3 9.6v9.4a1.5 1.5 0 0 1-1.5 1.5H9.2a1.5 1.5 0 0 1-1.5-1.5v-9.4c0-4 1.7-7.2 4.3-9.6z";
export function shipIcon(id) {
  const m = /^ship-(\w+)-(m|s)$/.exec(id);
  if (!m || !SHIP_KINDS[m[1]]) return false;
  const c = SHIP_KINDS[m[1]][0];
  ensure(id, () => ({ ratio: 3, w: 24, h: 26, svg: m[2] === "m"
    ? svg(24, 26, `<path d="${HULL}" fill="#fff" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="${HULL}" fill="${c}"/><path d="M12 7.5v9" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".75"/>`)
    : svg(24, 26, `<circle cx="12" cy="13" r="6.2" fill="#fff"/><circle cx="12" cy="13" r="4.6" fill="${c}"/>`) }));
  return true;
}

/* ------------------------------ Data ------------------------------ */

export const shipSources = () => ({ ships: { type: "geojson", data: { type: "FeatureCollection", features: [] } } });
export function shipLayers(t) {
  const zl = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];
  return [{ id: "ships", type: "symbol", source: "ships", minzoom: 6,
    layout: { "icon-image": ["concat", "ship-", ["get", "k"], ["case", ["==", ["get", "mv"], 1], "-m", "-s"]], "icon-rotate": ["get", "hd"], "icon-rotation-alignment": "map",
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": zl(6, 0.6, 10, 0.9, 14, 1.15), "symbol-sort-key": ["get", "mv"],
      "text-field": ["step", ["zoom"], "", 11.5, ["get", "n"]], "text-font": ["Noto Sans Italic"], "text-size": 10.5, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#174EA6", "text-halo-color": t.halo, "text-halo-width": 1.4 } }];
}

const inBox = ([w, s, e, n], b) => !(b[2] < w || b[0] > e || b[3] < s || b[1] > n);

export class Ships {
  constructor(map) {
    this.map = map; this.on = true; this.ships = new Map(); this.meta = new Map(); this.metaAt = 0; this.relayOff = false;
    const run = debounce(() => this.update(), 600);
    map.on("moveend", run);
    setInterval(() => { if (!document.hidden) this.update(); }, 30000);
  }
  view() { const b = this.map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  async update() {
    if (!this.on || this.map.getZoom() < 6) return this.render();
    const v = this.view();
    const jobs = [];
    if (inBox(DT_BOX, v)) jobs.push(this.digitraffic());
    // Elsewhere the relay (aisstream.io) — only when it's set up, and only for a moderate view.
    if (FLIGHTS_RELAY && !this.relayOff && !(v[0] >= DT_BOX[0] && v[2] <= DT_BOX[2] && v[1] >= DT_BOX[1] && v[3] <= DT_BOX[3]) && this.map.getZoom() >= 8) jobs.push(this.relay(v));
    await Promise.allSettled(jobs);
    this.render();
  }
  async digitraffic() {
    const h = { headers: { "Digitraffic-User": "Wayfinder/1.0" } };
    if (Date.now() - this.metaAt > 15 * 60000) {
      this.metaAt = Date.now();
      try { for (const x of await (await fetch(`${DIGITRAFFIC}/vessels`, h)).json()) this.meta.set(x.mmsi, x); } catch { this.metaAt = 0; }
    }
    const d = await (await fetch(`${DIGITRAFFIC}/locations`, h)).json();
    for (const f of d.features || []) {
      const p = f.properties, m = this.meta.get(p.mmsi) || {};
      this.ships.set(p.mmsi, { mmsi: p.mmsi, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], sog: p.sog, cog: p.cog, heading: p.heading, status: p.navStat,
        at: p.timestampExternal, name: m.name, type: m.shipType, dest: m.destination, callsign: m.callSign, imo: m.imo, draught: m.draught ? m.draught / 10 : null,
        length: m.referencePointA != null ? m.referencePointA + m.referencePointB : null, width: m.referencePointC != null ? m.referencePointC + m.referencePointD : null, src: "Digitraffic" });
    }
  }
  async relay([w, s, e, n]) {
    const q = `w=${w.toFixed(3)}&s=${s.toFixed(3)}&e=${e.toFixed(3)}&n=${n.toFixed(3)}`;
    const res = await fetch(`${FLIGHTS_RELAY.replace(/\/$/, "")}/ships?${q}`);
    if (res.status === 501 || res.status === 404) { this.relayOff = true; return; } // no AIS key in the relay (yet)
    const d = await res.json();
    for (const x of d.ships || []) this.ships.set(x.mmsi, { ...this.ships.get(x.mmsi), ...x, src: "aisstream.io" });
  }
  render() {
    const now = Date.now(), feats = [];
    for (const [k, x] of this.ships) {
      if (now - (x.at || now) > 30 * 60000) { this.ships.delete(k); continue; }
      if (!this.on || x.lon == null) continue;
      const moving = (x.sog ?? 0) >= 0.8 && x.status !== 1 && x.status !== 5;
      const hd = x.heading != null && x.heading < 360 ? x.heading : x.cog ?? 0;
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] }, properties: { m: x.mmsi, k: kindOf(x.type), mv: moving ? 1 : 0, hd, n: x.name || "" } });
    }
    this.map.getSource("ships")?.setData({ type: "FeatureCollection", features: feats });
  }
  get(mmsi) { return this.ships.get(+mmsi); }
}
