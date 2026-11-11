// Small helpers shared by every part of the site.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

export const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Google encoded polyline → [[lon, lat], …]. Transitous uses precision 6 or 7. */
export function decodePolyline(str, precision = 6) {
  const f = 10 ** precision, out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    out.push([lon / f, lat / f]);
  }
  return out;
}

/** Distance in metres between two [lon, lat] points. */
export function metres(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR * Math.cos((a[1] + b[1]) / 2 * toR);
  return R * Math.hypot(dLat, dLon);
}

// Always a 24-hour clock.
const timeFmt = new Map();
export function clock(iso, tz) {
  if (!iso) return "";
  const k = tz || "";
  if (!timeFmt.has(k)) {
    try { timeFmt.set(k, new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz || undefined })); }
    catch { timeFmt.set(k, new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })); }
  }
  return timeFmt.get(k).format(new Date(iso));
}
export const minutesUntil = iso => Math.round((Date.parse(iso) - Date.now()) / 60000);
export function duration(seconds) {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
export const distance = m => m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** localStorage, but never throws (private windows, blocked storage). */
export const store = {
  get(k, d) { try { const v = localStorage.getItem("wf." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("wf." + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
