// Transitous (MOTIS) — a free, community-run public transport API for Europe and beyond.
// Every call here goes straight from the browser; the API allows that (CORS).

import { decodePolyline } from "./util.js";

const BASE = "https://api.transitous.org/api";
const LANG = "en";

async function get(path, params = {}, signal) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  url.searchParams.set("language", LANG);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json();
}

const ll = (lat, lon) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

export const api = {
  /** Every route with its shape in a box. The server leaves out small modes at low zoom. */
  routes: (zoom, [w, s, e, n], signal) => get("/experimental/map/routes", { zoom, min: ll(s, w), max: ll(n, e) }, signal),
  routeDetails: (routeIdx, signal) => get("/experimental/map/route-details", { routeIdx }, signal),
  /** Departures at a stop, or around a point. */
  departures: ({ stopId, center, radius, n = 40, time, pageCursor }, signal) =>
    get("/v6/stoptimes", { stopId, center: center && ll(center[1], center[0]), radius, n, time, pageCursor }, signal),
  trip: (tripId, signal) => get("/v6/trip", { tripId }, signal),
  plan: ({ from, to, time, arriveBy, pageCursor }, signal) => get("/v6/plan", {
    fromPlace: ll(from[1], from[0]), toPlace: ll(to[1], to[0]), time, arriveBy: arriveBy || undefined, pageCursor,
    directModes: ["WALK", "BIKE"], maxDirectTime: 7200, numItineraries: 6,
  }, signal),
  geocode: (text, near, signal) => get("/v1/geocode", { text, place: near && ll(near[1], near[0]), placeBias: near ? 2 : undefined, numResults: 12 }, signal),
  reverse: ([lon, lat], signal) => get("/v1/reverse-geocode", { place: ll(lat, lon) }, signal),
};

export const shape = poly => poly && poly.points ? decodePolyline(poly.points, poly.precision ?? 6) : [];
