// The sea: nautical icons, and maritime places from OpenStreetMap that the base map doesn't carry —
// Blue Flag beaches and marinas (the clean-water award flag), lighthouses, harbours and slipways —
// fetched for the area in view from the Overpass API (zoom 11 and closer, per area, cached).

import { debounce } from "./util.js";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const NAVY = "#174EA6", SEA = "#1A73E8";

/** Nautical icons, drawn on demand ("sea-<kind>"). */
export function seaIcon(map, id) {
  const kind = id.slice(4), px = 2, S = 30, c = document.createElement("canvas");
  c.width = c.height = S * px;
  const g = c.getContext("2d");
  g.scale(px, px); g.lineCap = "round"; g.lineJoin = "round";
  const disc = (fill = NAVY) => { g.fillStyle = "#fff"; g.beginPath(); g.arc(15, 15, 13, 0, 7); g.fill(); g.fillStyle = fill; g.beginPath(); g.arc(15, 15, 11.2, 0, 7); g.fill(); };
  if (kind === "marina" || kind === "harbour") {
    disc(kind === "marina" ? SEA : NAVY);
    // Anchor.
    g.strokeStyle = "#fff"; g.lineWidth = 1.8;
    g.beginPath(); g.arc(15, 8.6, 1.8, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(15, 10.4); g.lineTo(15, 22); g.moveTo(11.2, 13.2); g.lineTo(18.8, 13.2); g.stroke();
    g.beginPath(); g.arc(15, 16, 6, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
    g.beginPath(); g.moveTo(8.8, 18.6); g.lineTo(10, 21.6); g.lineTo(12.6, 19.8); g.moveTo(21.2, 18.6); g.lineTo(20, 21.6); g.lineTo(17.4, 19.8); g.stroke();
  } else if (kind === "ferry") {
    disc(NAVY);
    g.fillStyle = "#fff";
    g.beginPath(); g.moveTo(7, 16.5); g.lineTo(23, 16.5); g.lineTo(20.5, 20.5); g.lineTo(9.5, 20.5); g.closePath(); g.fill();
    g.fillRect(10.5, 12.5, 9, 3.2); g.fillRect(13, 9.5, 4, 2.6);
    g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(7, 23); g.quadraticCurveTo(9.5, 21.6, 12, 23); g.quadraticCurveTo(14.5, 24.4, 17, 23); g.quadraticCurveTo(19.5, 21.6, 22, 23); g.stroke();
  } else if (kind === "lighthouse") {
    disc("#C5221F");
    g.fillStyle = "#fff";
    g.beginPath(); g.moveTo(12.5, 23); g.lineTo(13.8, 11.5); g.lineTo(16.2, 11.5); g.lineTo(17.5, 23); g.closePath(); g.fill();
    g.fillRect(13, 8.5, 4, 2.4);
    g.strokeStyle = "#FDD663"; g.lineWidth = 1.4; g.beginPath(); g.moveTo(10, 8); g.lineTo(7.5, 6.5); g.moveTo(20, 8); g.lineTo(22.5, 6.5); g.moveTo(10, 10.5); g.lineTo(7.2, 10.8); g.moveTo(20, 10.5); g.lineTo(22.8, 10.8); g.stroke();
  } else if (kind === "slipway") {
    disc(SEA);
    g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 20); g.lineTo(22, 11); g.stroke();
    g.lineWidth = 1.2; g.beginPath(); g.moveTo(8, 23); g.quadraticCurveTo(11, 21.5, 14, 23); g.quadraticCurveTo(17, 24.5, 20, 23); g.stroke();
  } else if (kind === "blueflag") {
    // The Blue Flag: a blue flag with white waves, on a pole.
    g.fillStyle = "#fff"; g.beginPath(); g.arc(15, 15, 13, 0, 7); g.fill();
    g.strokeStyle = "#5F6368"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(8.5, 5.5); g.lineTo(8.5, 25); g.stroke();
    g.fillStyle = "#0B57D0"; g.beginPath(); g.moveTo(9.3, 6); g.lineTo(23.5, 6); g.lineTo(23.5, 16.5); g.lineTo(9.3, 16.5); g.closePath(); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 1.2;
    for (const y of [10, 13]) { g.beginPath(); g.moveTo(10.5, y); g.quadraticCurveTo(13, y - 1.6, 15.5, y); g.quadraticCurveTo(18, y + 1.6, 22.5, y); g.stroke(); }
  } else return;
  map.addImage(id, { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data }, { pixelRatio: px });
}

/** Maritime places for the area in view, from OpenStreetMap through Overpass. */
export class SeaPlaces {
  constructor(map) {
    this.map = map; this.cells = new Map(); this.features = new Map(); this.on = true;
    map.on("moveend", debounce(() => this.update(), 600));
  }
  update() {
    if (!this.on || this.map.getZoom() < 11) return;
    const b = this.map.getBounds(), step = 0.25;
    for (let x = Math.floor(b.getWest() / step); x <= Math.floor(b.getEast() / step); x++)
      for (let y = Math.floor(b.getSouth() / step); y <= Math.floor(b.getNorth() / step); y++) {
        const k = x + "," + y;
        if (!this.cells.has(k)) { this.cells.set(k, "loading"); this.load(k, [y * step, x * step, (y + 1) * step, (x + 1) * step]); }
      }
  }
  async load(k, [s, w, n, e]) {
    const bb = `(${s},${w},${n},${e})`;
    const q = `[out:json][timeout:25];(nwr["blue_flag"="yes"]${bb};nwr["man_made"="lighthouse"]${bb};nwr["seamark:type"="harbour"]${bb};nwr["leisure"="slipway"]${bb};);out center tags 400;`;
    try {
      const res = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!res.ok) throw new Error(res.status);
      for (const el of (await res.json()).elements) {
        const t = el.tags || {}, lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
        if (lon == null) continue;
        const kind = t.blue_flag === "yes" ? "blueflag" : t.man_made === "lighthouse" ? "lighthouse" : t.leisure === "slipway" ? "slipway" : "harbour";
        this.features.set(el.type + el.id, { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { kind, name: t["name:en"] || t.name || (kind === "blueflag" ? "Blue Flag" : ""), rank: kind === "blueflag" ? 0 : kind === "lighthouse" ? 1 : kind === "harbour" ? 2 : 3 } });
      }
      this.cells.set(k, "done");
      this.apply();
    } catch { this.cells.delete(k); }
  }
  apply() { this.map.getSource("sea-places")?.setData({ type: "FeatureCollection", features: [...this.features.values()] }); }
}
