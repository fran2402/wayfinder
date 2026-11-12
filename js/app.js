// Wayfinder: the interface.
//
// A general map with public transport as one of its layers. Layout: a floating search pill with
// categories beside it, a floating panel (a sheet on phones) for whatever you're looking at, map
// controls with a layers sheet, and a small live pill. The interface is black and white; the map
// and the network keep their colours. Features that aren't built yet are already in place, marked "Soon".
//
// Screens, stacked in the panel and in the browser history:
//   explore → stop / line / place → plan → route,  plus "lines here", menu and settings.

import { api, shape } from "./api.js";
import { buildStyle, stopIcon, THEMES } from "./basemap.js";
import { Network } from "./network.js";
import { layoutLine, meetings, lineDiagramHtml, drawLineDiagram, summaryHtml } from "./diagram.js";
import { CLASSES, badge, classLabel, classOf, colourOf, textOn, compareLines, lineOfStopTime, registry } from "./lines.js";
import { $, esc, icon, clock, minutesUntil, duration, distance, metres, debounce, store } from "./util.js";

/* ============================== Settings ============================== */

const settings = Object.assign({ theme: "system", spread: true, liveOnly: true, vehicles: true, transit: true, places: true, modes: CLASSES.map(c => c.id) }, store.get("settings", {}));
const saveSettings = () => store.set("settings", settings);
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const themeNow = () => settings.theme === "system" ? (darkQuery.matches ? "dark" : "light") : settings.theme;
document.documentElement.dataset.theme = themeNow();

/* ============================== Map ============================== */

const wideQuery = matchMedia("(min-width: 900px)");
const wide = () => wideQuery.matches;
const START = store.get("view", { center: [15.977, 45.8131], zoom: 13.4 }); // Zagreb until you move the map
const map = new maplibregl.Map({
  container: "map", style: buildStyle(themeNow()), center: START.center, zoom: START.zoom, hash: "map",
  attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, minZoom: 3, maxZoom: 19, fadeDuration: 120,
});
map.on("error", e => console.warn("Map:", e.error?.message || e));
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '<a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>' }), "bottom-right");
map.on("styleimagemissing", e => { if (e.id.startsWith("stop-")) stopIcon(map, e.id, THEMES[themeNow()]); });

const net = new Network(map);
Object.assign(net, { spread: settings.spread, liveOnly: settings.liveOnly, vehicles: settings.vehicles, enabled: new Set(settings.modes) });

const EMPTY = { type: "FeatureCollection", features: [] };
const overlay = { focus: EMPTY, trip: EMPTY };
function setOverlay(name, fc) { overlay[name] = fc; map.getSource(name)?.setData(fc); }

map.on("load", () => net.update());
map.on("moveend", () => {
  net.update();
  store.set("view", { center: map.getCenter().toArray(), zoom: map.getZoom() });
  onMapMoved();
  statusModes();
});
net.on(() => { $("#busy").hidden = net.loading === 0; });

function applyTheme() {
  const t = themeNow();
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === "dark" ? "#000000" : "#FFFFFF";
  map.setStyle(buildStyle(t));
  map.once("style.load", () => { net.render(true); net.applyFocus(); applyLayers(); for (const k in overlay) map.getSource(k)?.setData(overlay[k]); });
}
darkQuery.addEventListener("change", () => settings.theme === "system" && applyTheme());

const meEl = document.createElement("div"); meEl.className = "me-dot";
const meMarker = new maplibregl.Marker({ element: meEl });
const pinEl = document.createElement("div"); pinEl.className = "pin-mark";
pinEl.innerHTML = `<svg viewBox="0 0 30 40"><path d="M15 39C15 39 2 23.5 2 14.5a13 13 0 0 1 26 0C28 23.5 15 39 15 39Z" fill="#111" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.5" r="5" fill="#fff"/></svg>`;
const pinMarker = new maplibregl.Marker({ element: pinEl, anchor: "bottom" });

$("#zin").addEventListener("click", () => map.zoomIn());
$("#zout").addEventListener("click", () => map.zoomOut());

/* ============================== Location ============================== */

let me = null, watching = false;
function locate(fly) {
  if (!navigator.geolocation) return toast("Location isn't available in this browser.");
  if (me && fly) map.flyTo({ center: me, zoom: Math.max(map.getZoom(), 15), padding: padding() });
  if (watching) return;
  watching = true;
  navigator.geolocation.watchPosition(p => {
    const first = !me;
    me = [p.coords.longitude, p.coords.latitude];
    meMarker.setLngLat(me).addTo(map);
    $("#locate").classList.add("on");
    if (first && fly) map.flyTo({ center: me, zoom: Math.max(map.getZoom(), 15), padding: padding() });
    if (first && screen().t === "explore") loadHere(screen(), true);
  }, err => { watching = false; if (fly) toast(err.code === 1 ? "Location permission was refused." : "Couldn't find your location."); },
  { enableHighAccuracy: true, maximumAge: 15000 });
}
navigator.permissions?.query({ name: "geolocation" }).then(r => { if (r.state === "granted") locate(false); }).catch(() => {});
$("#locate").addEventListener("click", () => locate(true));
const here = () => me || map.getCenter().toArray();

/* ============================== Inspector: docked, or a sheet on phones ============================== */

const insp = $("#insp"), body = $("#body");
let sheet = "half";
const topH = () => wide() ? 0 : ($("#omniwrap").offsetHeight || 52) + ($("#cats").offsetHeight || 40) + 20;
function sheetHeight(state = sheet) {
  const H = innerHeight;
  return state === "peek" ? 150 : state === "full" ? H - 70 : Math.round(H * 0.5);
}
function setSheet(state, animate = true) {
  sheet = state;
  insp.classList.toggle("anim", animate);
  document.body.style.setProperty("--sheet", wide() ? "0px" : sheetHeight() + "px");
  document.body.dataset.sheet = wide() ? "" : state;
}
function padding() {
  if (wide()) return { top: 90, bottom: 60, left: ($("#insp").offsetWidth || 400) + 70, right: 90 };
  return { top: topH() + 10, bottom: sheetHeight() + 24, left: 30, right: 70 };
}
wideQuery.addEventListener("change", () => { map.resize(); setSheet(sheet, false); render(); });
addEventListener("resize", debounce(() => { setSheet(sheet, false); afterRender(); }, 100));
(() => {
  const grip = $("#grip");
  let start = null;
  grip.addEventListener("pointerdown", e => { if (wide()) return; start = { y: e.clientY, h: sheetHeight() }; grip.setPointerCapture(e.pointerId); insp.classList.remove("anim"); });
  grip.addEventListener("pointermove", e => { if (start) document.body.style.setProperty("--sheet", Math.max(120, Math.min(sheetHeight("full"), start.h - (e.clientY - start.y))) + "px"); });
  grip.addEventListener("pointerup", e => {
    if (!start) return;
    const dy = e.clientY - start.y, h = start.h - dy;
    start = null;
    if (Math.abs(dy) < 6) return setSheet(sheet === "full" ? "half" : sheet === "half" ? "full" : "half");
    setSheet(["peek", "half", "full"].reduce((a, b) => Math.abs(sheetHeight(b) - h) < Math.abs(sheetHeight(a) - h) ? b : a));
  });
})();

/* ============================== Navigation: a stack, in the browser history ============================== */

let stack = [{ t: "explore" }];
const screen = () => stack[stack.length - 1];
function screenParam(s) {
  if (s.t === "stop") return `stop:${s.ids[0]}~${s.name || ""}`;
  if (s.t === "place") return `place:${s.lat.toFixed(5)},${s.lon.toFixed(5)}~${s.name || ""}`;
  if (s.t === "line") return `line:${s.key}${s.tripId ? "~" + s.tripId : ""}`;
  return "";
}
function urlFor(s) {
  const params = location.hash.slice(1).split("&").filter(p => p && !p.startsWith("s="));
  const sp = s ? screenParam(s) : "";
  if (sp) params.push("s=" + encodeURIComponent(sp));
  return location.pathname + location.search + (params.length ? "#" + params.join("&") : "");
}
function transition(fn) {
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(fn);
  else fn();
}
function go(s) {
  closeOmni();
  stack.push(s);
  history.pushState({ wf: stack.length }, "", urlFor(s));
  transition(() => render(true));
}
/** Back to breadcrumb i (0 = Here). */
function backTo(i) {
  const steps = stack.length - 1 - i;
  if (steps <= 0) return;
  const depth = history.state?.wf || 1;
  if (depth - steps >= 1) history.go(-steps);
  else { stack.length = i + 1; history.replaceState({ wf: stack.length }, "", urlFor(screen())); transition(() => render(true)); }
}
const back = () => backTo(stack.length - 2);
addEventListener("popstate", e => {
  const depth = e.state?.wf || 1;
  if (depth >= stack.length) return;
  stack.length = Math.max(1, depth);
  transition(() => render(true));
});

const TITLES = {
  explore: () => "Explore", settings: () => "Settings", plan: () => "Directions", pick: () => "Lines here", menu: () => "Menu",
  stop: s => s.name || "Stop", place: s => s.name || "Place", itin: s => `${duration(s.it.duration)} route`,
  line: s => { const l = registry.get(s.key); return l ? `${classLabel(l.cls)} ${l.name}` : "Line"; },
};
/** The panel's header: back, the title, and a way home. Nothing on the start screen (the search is its header). */
function headHtml() {
  const s = screen();
  if (stack.length === 1) return "";
  return `<button class="hbtn" data-act="back" aria-label="Back">${icon("back", "s")}</button><span class="htitle">${esc(TITLES[s.t](s))}</span>
    <button class="hbtn" data-act="home" aria-label="Close">${icon("close", "s")}</button>`;
}

let shown = null;
function render(fresh = false) {
  const s = screen(), V = VIEWS[s.t];
  document.body.dataset.screen = s.t;
  $("#phead").innerHTML = headHtml();
  const keep = shown === s && !fresh ? body.scrollTop : 0;
  body.innerHTML = V.html(s);
  body.scrollTop = keep;
  if (shown !== s) { shown = s; if (!wide()) setSheet(V.sheet || "half"); V.enter?.(s); }
  else setSheet(sheet, false);
  afterRender();
}
function afterRender() { const s = screen(); VIEWS[s.t].after?.(s); }
function refresh(s) {
  if (screen() !== s) return;
  const sc = body.scrollTop;
  $("#phead").innerHTML = headHtml();
  body.innerHTML = VIEWS[s.t].html(s);
  body.scrollTop = sc;
  afterRender();
}
async function load(s, key, fn) {
  if (s[key + "$"]) return;
  s[key + "$"] = true;
  try { s[key] = await fn(); s[key + "Err"] = null; }
  catch (e) { s[key + "Err"] = e.message || "something went wrong"; }
  finally { s[key + "$"] = false; refresh(s); }
}
function mapFor({ focus = null, dim = false, focusFc = EMPTY, tripFc = EMPTY, pin = null } = {}) {
  net.setFocus(focus, dim);
  setOverlay("focus", focusFc);
  setOverlay("trip", tripFc);
  if (pin) pinMarker.setLngLat(pin).addTo(map); else pinMarker.remove();
}
function frame(coords, maxZoom = 16) {
  if (!coords.length) return;
  const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: padding(), maxZoom, duration: 650 });
}

/* ============================== Shared pieces ============================== */

const loading = (n = 4) => `<div class="skels">${Array.from({ length: n }, () => `<i></i>`).join("")}</div>`;
const failed = (msg, retry) => `<div class="note">Couldn't load this (${esc(msg)}).${retry ? ` <button class="tlink" data-act="${retry}">Try again</button>` : ""}</div>`;
const KIND_ICON = { train: "train", metro: "metro", tram: "tram", bus: "bus", ferry: "ferry", other: "cable" };
const head = (kicker, title, meta) => `<header class="title"><h1>${esc(title)}</h1><p>${[kicker, meta].filter(Boolean).join(" · ")}</p></header>`;
const section = (title, extra = "") => `<h2 class="sh"><span>${title}</span>${extra}</h2>`;

/** One departure as a row: minutes (or the clock time), line, destination, where. */
function depRow(x, where) {
  const m = minutesUntil(x.iso), delay = x.sched ? Math.round((Date.parse(x.iso) - Date.parse(x.sched)) / 60000) : 0;
  const when = x.cancelled ? `<s>${clock(x.iso, x.tz)}</s>` : m <= 0 ? `<em>now</em>` : m < 60 ? `${m}<small>min</small>` : clock(x.iso, x.tz);
  const live = x.cancelled ? `<span class="flag">cancelled</span>` : x.rt ? `<span class="flag">${delay >= 1 ? `+${delay}` : "live"}</span>` : "";
  return `<button class="dep" data-line="${esc(x.line.key)}" data-trip="${esc(x.tripId)}" data-at="${esc(x.stop.parentId || x.stop.stopId)}">
    <span class="when">${when}</span>${badge(x.line)}<span class="to"><b>${esc(x.to)}</b><small>${esc(where ?? (x.stop.track ? `Platform ${x.stop.track}` : ""))}</small></span>${live}</button>`;
}
/** Stop times as departures, soonest first. */
function departures(stopTimes) {
  const out = [];
  for (const st of stopTimes) {
    const line = lineOfStopTime(st);
    if (!line || !net.enabled.has(line.cls)) continue;
    out.push({ line, to: st.headsign || st.tripTo?.name || "", iso: st.place.departure || st.place.arrival, sched: st.place.scheduledDeparture,
      rt: st.realTime, cancelled: st.cancelled || st.tripCancelled, tz: st.place.tz, tripId: st.tripId, stop: st.place });
  }
  return out.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
}
function mergeStopTimes(lists) {
  const seen = new Set(), out = [];
  for (const st of lists.flat()) { const k = st.tripId + "|" + (st.place.departure || st.place.arrival); if (!seen.has(k)) { seen.add(k); out.push(st); } }
  return out.sort((a, b) => Date.parse(a.place.departure || a.place.arrival) - Date.parse(b.place.departure || b.place.arrival));
}
/** Stations around a point from departures: stops with one name are one station. */
function stationsFrom(stopTimes, origin) {
  const norm = n => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const by = new Map();
  for (const st of stopTimes) {
    const p = st.place, k = norm(p.name);
    if (!by.has(k)) by.set(k, { name: p.name, lon: p.lon, lat: p.lat, keys: new Set(), lines: new Map(), d: Infinity });
    const g = by.get(k), d = metres(origin, [p.lon, p.lat]), l = lineOfStopTime(st);
    g.keys.add(p.parentId || p.stopId);
    if (l && net.enabled.has(l.cls)) g.lines.set(l.key, l);
    if (d < g.d) { g.d = d; g.lon = p.lon; g.lat = p.lat; }
  }
  return [...by.values()].sort((a, b) => a.d - b.d);
}
const walkMin = d => Math.max(1, Math.round(d / 75));
function stationRow(st, label) {
  const ls = [...st.lines.values()].sort(compareLines);
  return `<button class="srow" data-stop="${esc([...st.keys].join("\n"))}" data-name="${esc(st.name)}" data-lon="${st.lon}" data-lat="${st.lat}">
    <span class="sname"><b>${esc(st.name)}</b><small>${label}</small></span><span class="badges">${ls.slice(0, 8).map(l => badge(l, "sm")).join("")}${ls.length > 8 ? `<small>+${ls.length - 8}</small>` : ""}</span></button>`;
}
function statusModes() { if (!$("#layers").hidden) renderLayers(); }
const soon = label => `<span class="soon">${label || "Soon"}</span>`;
const saved = () => store.get("saved", []);

/* ============================== Explore (the start) ============================== */

let placeName = null, placeAt = null;
function loadHere(s, force) {
  const c = here();
  if (!force && s.at && metres(c, s.at) < 250) return;
  s.at = c; s.data = null; s["data$"] = false;
  if (!settings.transit) return;
  load(s, "data", async () => {
    const d = await api.departures({ center: c, radius: 600, n: 120 });
    return { deps: departures(d.stopTimes), stations: stationsFrom(d.stopTimes, c).slice(0, 5) };
  });
  if (!placeAt || metres(c, placeAt) > 300) {
    placeAt = c;
    api.reverse(c).then(r => { const a = r[0]; placeName = a ? (a.areas || []).find(x => x.default)?.name || a.name : null; if (screen() === s) refresh(s); }).catch(() => {});
  }
}
const onMapMoved = debounce(() => {
  const s = screen();
  if (s.t !== "explore") return;
  if (!me) loadHere(s);
  net.linesInView().then(ls => { s.inview = ls.sort(compareLines); refresh(s); });
}, 450);

/** What you can look for. Searching by category isn't built yet: they say so. */
const CATS = [["food", "Restaurants"], ["cafe", "Cafés"], ["grocery", "Groceries"], ["hotel", "Hotels"], ["shop", "Shopping"], ["park", "Parks"], ["museum", "Museums"],
  ["bar", "Bars"], ["fuel", "Fuel"], ["charge", "EV charging"], ["parking", "Parking"], ["pharmacy", "Pharmacies"], ["hospital", "Hospitals"], ["atm", "ATMs"], ["toilet", "Toilets"]];
$("#cats").innerHTML = `<button class="chip on" data-act="transit-chip">${icon("tram", "s")}Transit</button>` + CATS.map(([ic, label]) => `<button class="chip" data-soon="Searching for ${label.toLowerCase()}">${icon(ic, "s")}${label}</button>`).join("");

const VIEWS = {};
VIEWS.explore = {
  sheet: "half",
  enter(s) { mapFor(); loadHere(s); net.linesInView().then(ls => { s.inview = ls.sort(compareLines); refresh(s); }); },
  html(s) {
    const d = s.data;
    const places = saved(), lines = s.inview || [];
    const quick = `<div class="quick">
      <button data-act="plan"><span>${icon("dir")}</span>Directions</button>
      <button data-act="menu-saved"><span>${icon("save")}</span>Saved</button>
      <button data-soon="Exploring what's around"><span>${icon("compass")}</span>Nearby</button>
      <button data-soon="Offline maps"><span>${icon("offline")}</span>Offline</button></div>`;
    const transit = !settings.transit ? `<div class="card muted">Public transport is hidden. <button class="tlink" data-act="transit-chip">Show it</button></div>`
      : `${section("Public transport nearby", `<button class="tlink" data-act="reload-here">Refresh</button>`)}
      <p class="sub">${me ? "Near you" : "Near the map centre"}${placeName ? ` · ${esc(placeName)}` : ""}</p>
      ${s.dataErr ? failed(s.dataErr, "reload-here") : !d ? loading(4)
        : !d.deps.length ? `<div class="card muted">Nothing leaves within 600 m in the next hours. Move the map to a town or city.</div>`
        : `<div class="card list">${d.deps.slice(0, s.more ? 30 : 5).map(x => depRow(x, `${x.stop.name}${me ? ` · ${walkMin(metres(me, [x.stop.lon, x.stop.lat]))} min walk` : ""}`)).join("")}
           ${d.deps.length > 5 && !s.more ? `<button class="cardmore" data-act="more">More departures</button>` : ""}</div>`}
      ${d?.stations?.length ? `${section("Stops")}<div class="card list">${d.stations.map(st => stationRow(st, `${distance(st.d)}${me ? ` · ${walkMin(st.d)} min walk` : ""}`)).join("")}</div>` : ""}
      ${lines.length ? `${section(`Lines in view`, `<span class="count">${lines.length}</span>`)}<div class="linegrid">${lines.slice(0, 60).map(l => `<button data-line="${esc(l.key)}" title="${esc(l.longName || classLabel(l.cls) + " " + l.name)}">${badge(l)}</button>`).join("")}</div>` : ""}`;
    const explore = `${section("Explore nearby", soon())}<div class="tiles">${CATS.slice(0, 8).map(([ic, label]) => `<button data-soon="Searching for ${label.toLowerCase()}"><span>${icon(ic)}</span>${label}</button>`).join("")}</div>`;
    const savedHtml = places.length ? `${section("Saved")}<div class="card list">${places.map((p, i) => `<button class="lrow2" data-saved="${i}"><span class="ico">${icon("save", "s")}</span><span><b>${esc(p.name)}</b><small>${esc(p.sub || "")}</small></span><small>Directions</small></button>`).join("")}</div>` : "";
    return quick + transit + explore + savedHtml;
  },
};

/* ============================== Stop (a station: one or more stops with one name) ============================== */

VIEWS.stop = {
  sheet: "half",
  enter(s) {
    mapFor({ pin: s.lon != null ? [s.lon, s.lat] : null });
    if (s.lon != null) map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 16), padding: padding(), duration: 650 });
    if (s.ids.length === 1) net.group(s.ids[0]).then(g => { if (g && g.keys.length > 1 && screen() === s) { s.ids = g.keys; s.name = s.name || g.name; s.deps = null; s["deps$"] = false; loadStop(s); } });
    loadStop(s);
    clearInterval(s.timer);
    s.timer = setInterval(() => { if (screen() !== s) return clearInterval(s.timer); loadStop(s, true); }, 30000);
  },
  html(s) {
    const all = s.deps ? departures(s.deps) : [];
    const lines = [...new Map(all.map(x => [x.line.key, x.line])).values()].sort(compareLines);
    const kinds = CLASSES.filter(c => lines.some(l => l.cls === c.id)).map(c => classLabel(c.id).toLowerCase());
    const list = s.only ? all.filter(x => x.line.key === s.only) : all;
    const d = me && s.lon != null ? metres(me, [s.lon, s.lat]) : null;
    const isSaved = saved().some(p => p.name === s.name && s.lon != null && Math.abs(p.lon - s.lon) < 1e-4);
    return head(kinds.length ? kinds.join(" · ") + " stop" : "Stop", s.name || "Stop",
        [d != null ? `${distance(d)} · ${walkMin(d)} min walk` : null, lines.length ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}` : null, s.ids.length > 1 ? `${s.ids.length} platforms and stops` : null].filter(Boolean).join(" · "))
      + `<div class="circs"><button class="circ primary" data-act="dir-stop"><span>${icon("dir")}</span>Directions</button><button class="circ" data-act="save-stop" aria-pressed="${isSaved}"><span>${icon(isSaved ? "heart" : "save")}</span>${isSaved ? "Saved" : "Save"}</button><button class="circ" data-act="share"><span>${icon("share")}</span>Share</button><button class="circ" data-soon="Alerts for this stop"><span>${icon("warn")}</span>Alerts</button></div>`
      + (lines.length > 1 ? `<div class="filter">${lines.map(l => `<button data-only="${esc(l.key)}" aria-pressed="${s.only === l.key}">${badge(l, "sm")}</button>`).join("")}${s.only ? `<button class="tlink" data-only="${esc(s.only)}">Show all</button>` : ""}</div>` : "")
      + section("Departures", `<span class="sh-note">live · +late · minutes</span>`)
      + (s.depsErr ? failed(s.depsErr, "reload-stop") : !s.deps ? loading(7) : list.length ? `<div class="deps">${list.slice(0, 60).map(x => depRow(x)).join("")}</div>` : `<div class="note">No departures in the next hours.</div>`)
      + (s.deps && s.cursors?.length ? `<button class="more-btn" data-act="more-deps">Later departures</button>` : "");
  },
};
function loadStop(s, quiet) {
  if (!quiet) s.deps = null;
  load(s, "deps", async () => {
    const res = await Promise.all(s.ids.slice(0, 6).map(id => api.departures({ stopId: id, n: 40 }).catch(() => null)));
    const ok = res.filter(Boolean);
    if (!ok.length) throw new Error("no answer");
    s.cursors = ok.map((r, i) => ({ id: s.ids[i], c: r.nextPageCursor })).filter(x => x.c);
    const p = ok[0].place;
    if (p && s.lon == null) { s.lon = p.lon; s.lat = p.lat; pinMarker.setLngLat([p.lon, p.lat]).addTo(map); map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16), padding: padding() }); }
    if (!s.name && p) s.name = p.name;
    return mergeStopTimes(ok.map(r => r.stopTimes));
  });
}

/* ============================== Line ============================== */

const stopOf = p => ({ name: p.name, key: p.parentId || p.stopId, id: p.stopId, lon: p.lon, lat: p.lat, tz: p.tz,
  time: p.departure || p.arrival, arr: p.arrival, dep: p.departure, sched: p.scheduledDeparture || p.scheduledArrival, track: p.track });

VIEWS.line = {
  sheet: "half",
  enter(s) { mapFor({ focus: s.key }); loadLine(s); },
  html(s) {
    const l = registry.get(s.key);
    if (!l) return failed("unknown line");
    const d = s.data;
    const ends = d?.lay ? [...new Set(d.lay.ends.map(e => d.lay.rows[e.row].name))] : [];
    const title = l.longName || (ends.length ? ends.slice(0, 2).join(" – ") : `${classLabel(l.cls)} ${l.name}`);
    const top = `<header class="title line">${badge(l, "big")}<div><h1>${esc(title)}</h1><p>${esc([classLabel(l.cls), l.agency, d?.lay && `${d.lay.rows.length} stations`].filter(Boolean).join(" · "))}</p></div></header>`;
    if (s.dataErr) return top + failed(s.dataErr, "reload-line");
    if (!d) return top + loading(10);
    if (!d.lay) return top + `<div class="note">Nothing of this line is running right now.</div>`;
    const t = d.trip;
    return top + (t ? `<div class="tripline"><span>${t.live ? "Live trip" : "Next trip"}</span><b>${clock(t.stops[0].time, t.stops[0].tz)}</b> ${esc(t.stops[0].name)} → <b>${clock(t.stops[t.stops.length - 1].time, t.stops[0].tz)}</b> ${esc(t.stops[t.stops.length - 1].name)}</div>` : "")
      + lineDiagramHtml(l, d.lay, d.meet, { expanded: s.expanded, here: s.at, onTrip: t ? new Set(t.stops.map(x => x.key)) : null })
      + (t ? summaryHtml(t.stops, s.back) : "");
  },
  after(s) { if (s.data?.lay) requestAnimationFrame(() => drawLineDiagram(registry.get(s.key), s.data.lay, s.data.meet)); },
};

async function tripData(tripId) {
  const t = await api.trip(tripId);
  const leg = t.legs.find(l => l.tripId) || t.legs[0];
  const stops = [leg.from, ...(leg.intermediateStops || []), leg.to].map(stopOf);
  const now = Date.now();
  stops.forEach(x => { x.past = x.time && Date.parse(x.time) < now - 30000; x.rt = leg.realTime; x.late = x.sched && x.time && Date.parse(x.time) - Date.parse(x.sched) >= 60000; });
  return { stops, shape: shape(leg.legGeometry), timed: true, live: leg.realTime, tripId };
}
const routeDetails = new Map();
const routeDetail = idx => { if (!routeDetails.has(idx)) routeDetails.set(idx, api.routeDetails(idx).catch(e => { routeDetails.delete(idx); throw e; })); return routeDetails.get(idx); };
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } } }));
  return out;
}
/** A shape without its broken bits: a straight jump of over `max` metres between two points is not a road. */
function splitJumps(coords, max) {
  const out = [[]];
  for (const c of coords) { const cur = out[out.length - 1], p = cur[cur.length - 1]; if (p && metres(p, c) > max) out.push([c]); else cur.push(c); }
  return out.filter(x => x.length > 1);
}
function loadLine(s) {
  s.expanded = s.expanded || new Set();
  load(s, "data", async () => {
    const l = registry.get(s.key);
    // The whole line: every variant the map has met, the running ones when anything runs, each fetched whole.
    const all = await net.variants(l.key);
    let cand = all.filter(v => v.run);
    if (!cand.length) cand = all;
    const distinct = new Map();
    for (const v of cand) { const k = v.n + "|" + v.sig; if (!distinct.has(k)) distinct.set(k, v.idx); }
    const seqs = (await pool([...distinct.values()].slice(0, 40), 6, async idx => {
      const rd = await routeDetail(idx), r = rd.routes[0];
      return r?.segments.length ? [r.segments[0].from, ...r.segments.map(x => x.to)].map(i => rd.stops[i]) : null;
    })).filter(Boolean);
    let vs = [];
    if (seqs.length) {
      const keys = [...new Set(seqs.flat().map(p => p.parentId || p.stopId))];
      const g = await net.gids(keys), gm = new Map(keys.map((k, i) => [k, g[i]]));
      vs = seqs.map(sq => ({ stops: sq.map(p => { const k = p.parentId || p.stopId, x = gm.get(k); return { key: x?.gid || k, sk: k, name: x?.name || p.name, lon: p.lon, lat: p.lat }; }) }));
    }
    let trip = null;
    if (s.tripId) trip = await tripData(s.tripId).catch(() => null);
    if (!vs.length && trip) vs = [{ stops: trip.stops.map(x => ({ key: x.key, sk: x.key, name: x.name, lon: x.lon, lat: x.lat })) }];
    const lay = vs.length ? layoutLine(vs) : null;
    const meet = lay ? await meetings(l, lay, net) : [];
    if (!trip && lay) {
      try {
        const dep = await api.departures({ stopId: lay.rows[0].sk, n: 80 });
        const st = dep.stopTimes.find(x => lineOfStopTime(x) === l);
        if (st) trip = await tripData(st.tripId);
      } catch { /* no times */ }
    }
    const d = { lay, meet, trip };
    s.back = null;
    if (trip) findBack(l, trip).then(async st => {
      if (!st || s.data !== d) return;
      const bs = (await tripData(st.tripId)).stops;
      const journey = (Date.parse(bs[bs.length - 1].arr || bs[bs.length - 1].time) - Date.parse(bs[0].dep || bs[0].time)) / 1000;
      const turn = Math.max(0, Math.min(3600, (Date.parse(bs[0].dep || bs[0].time) - Date.parse(trip.stops[trip.stops.length - 1].arr || trip.stops[trip.stops.length - 1].time)) / 1000));
      if (journey > 0) { s.back = { journey, turn }; refresh(s); }
    }).catch(() => {});
    const pairs = await net.shape(l.key);
    const lines = pairs.length ? pairs : trip ? splitJumps(trip.shape, l.cls === "train" ? 8000 : 1200) : [];
    setOverlay("focus", { type: "FeatureCollection", features: [{ type: "Feature", properties: { c: colourOf(l) }, geometry: { type: "MultiLineString", coordinates: lines } }] });
    const pts = lay ? lay.rows.map(x => [x.lon, x.lat]) : lines.flat();
    if (pts.length) frame(pts, 15.5);
    return d;
  });
}
async function findBack(l, d) {
  const last = d.stops[d.stops.length - 1], firstName = d.stops[0].name;
  const dep = await api.departures({ stopId: last.key, n: 100, time: last.arr || last.time });
  return dep.stopTimes.find(x => lineOfStopTime(x) === l && (x.tripTo?.name === firstName || x.headsign === firstName))
    || dep.stopTimes.find(x => lineOfStopTime(x) === l && x.tripTo?.name !== last.name);
}

/* ============================== Lines under a tap ============================== */

VIEWS.pick = {
  sheet: "half",
  enter() { mapFor(); },
  html(s) {
    const ls = s.keys.map(k => registry.get(k)).filter(Boolean).sort(compareLines);
    return head("Choose a line", `${ls.length} lines here`) + `<div class="list">${ls.map(l => `<button class="lrow2 withbadge" data-line="${esc(l.key)}">${badge(l)}<span><b>${esc(l.longName || `${classLabel(l.cls)} ${l.name}`)}</b><small>${esc(classLabel(l.cls))}</small></span></button>`).join("")}</div>`;
  },
};

/* ============================== Place ============================== */

VIEWS.place = {
  sheet: "half",
  enter(s) {
    s.tab = s.tab || "overview";
    mapFor({ pin: [s.lon, s.lat] });
    map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), padding: padding(), duration: 650 });
    load(s, "near", async () => {
      const d = await api.departures({ center: [s.lon, s.lat], radius: 500, n: 60 });
      return { deps: departures(d.stopTimes), stations: stationsFrom(d.stopTimes, [s.lon, s.lat]).slice(0, 4) };
    });
    if (s.needsName) load(s, "rev", async () => { const a = (await api.reverse([s.lon, s.lat]))[0]; if (a) { s.name = a.name; s.sub = subOf(a); } return true; });
  },
  html(s) {
    const isSaved = saved().some(p => p.name === s.name && Math.abs(p.lon - s.lon) < 1e-5);
    const d = me ? metres(me, [s.lon, s.lat]) : null;
    const n = s.near;
    const tabs = [["overview", "Overview"], ["transit", "Transit"], ["photos", "Photos"], ["reviews", "Reviews"]];
    let body = "";
    if (s.tab === "overview") {
      body = `<div class="card list info">
          <div class="irow">${icon("pin", "s")}<span><b>${esc(s.name)}</b><small>${esc(s.sub || "")}</small></span></div>
          <div class="irow">${icon("compass", "s")}<span class="mono">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</span></div>
          <div class="irow">${icon("clock", "s")}<span>Opening hours</span>${soon()}</div>
          <div class="irow">${icon("globe", "s")}<span>Website</span>${soon()}</div>
          <div class="irow">${icon("phone", "s")}<span>Phone</span>${soon()}</div>
          <div class="irow">${icon("wheel", "s")}<span>Accessibility</span>${soon()}</div></div>`
        + (n?.stations?.length ? `${section("Getting there by public transport")}<div class="card list">${n.stations.slice(0, 2).map(st => stationRow(st, `${distance(st.d)} · ${walkMin(st.d)} min walk`)).join("")}</div>` : "");
    } else if (s.tab === "transit") {
      body = s.nearErr ? failed(s.nearErr) : !n ? loading(3) : !n.stations.length ? `<div class="card muted">No public transport within 500 m.</div>`
        : `${section("Stops within 500 m")}<div class="card list">${n.stations.map(st => stationRow(st, `${distance(st.d)} · ${walkMin(st.d)} min walk`)).join("")}</div>`
          + (n.deps.length ? `${section("Leaving soon")}<div class="card list">${n.deps.slice(0, 8).map(x => depRow(x, x.stop.name)).join("")}</div>` : "");
    } else {
      body = `<div class="card muted soonbox">${icon(s.tab === "photos" ? "camera" : "star")}<b>${s.tab === "photos" ? "Photos" : "Reviews"} are coming</b><span>Open data sources for them are being looked at.</span></div>`;
    }
    return `<header class="title"><h1>${esc(s.name)}</h1><p>${esc([s.sub, d != null ? `${distance(d)} away` : null].filter(Boolean).join(" · "))}</p></header>
      <div class="circs">
        <button class="circ primary" data-act="dir-place"><span>${icon("dir")}</span>Directions</button>
        <button class="circ" data-act="save-place" aria-pressed="${isSaved}"><span>${icon(isSaved ? "heart" : "save")}</span>${isSaved ? "Saved" : "Save"}</button>
        <button class="circ" data-act="share"><span>${icon("share")}</span>Share</button>
        <button class="circ" data-soon="What's nearby"><span>${icon("compass")}</span>Nearby</button>
        <button class="circ" data-soon="Calling places"><span>${icon("phone")}</span>Call</button></div>
      <div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button role="tab" data-ptab="${k}" aria-selected="${s.tab === k}">${label}</button>`).join("")}</div>
      ${body}`;
  },
};

/* ============================== Menu ============================== */

VIEWS.menu = {
  sheet: "full",
  enter() { mapFor(); },
  html() {
    const item = (ic, label, attr, extra = "") => `<button class="mrow" ${attr}><span class="ico">${icon(ic, "s")}</span><span>${label}</span>${extra}</button>`;
    const places = saved(), rec = store.get("recent", []);
    return `<header class="title"><h1>Wayfinder</h1><p>A map of everything, open data first</p></header>
      <div class="card list">${item("save", "Saved places", 'data-act="menu-saved"', `<small>${places.length}</small>`)}${item("recent", "Recent", 'data-act="search-go"', `<small>${rec.length}</small>`)}
        ${item("timeline", "Your timeline", 'data-soon="Your timeline"', soon())}${item("offline", "Offline maps", 'data-soon="Offline maps"', soon())}
        ${item("person", "Share your location", 'data-soon="Sharing your location"', soon())}${item("map", "Your maps and lists", 'data-soon="Lists"', soon())}</div>
      <div class="card list">${item("layers", "Map layers", 'data-act="layers"')}${item("gear", "Settings", 'data-act="settings"')}</div>
      ${places.length ? `${section("Saved places")}<div class="card list" id="savedlist">${places.map((p, i) => `<button class="lrow2" data-saved="${i}"><span class="ico">${icon("save", "s")}</span><span><b>${esc(p.name)}</b><small>${esc(p.sub || "")}</small></span><small>Directions</small></button>`).join("")}</div>` : ""}
      <p class="about">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>; public transport from <a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>; drawn with <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>.</p>`;
  },
};

/* ============================== Layers ============================== */

const NET_LAYERS = ["net-casing", "net-lines", "net-rail-dash", "stations", "stations-far", "station-links", "station-links-casing", "station-labels", "vehicles", "vehicle-labels"];
/** Show or hide what the layers sheet controls. */
function applyLayers() {
  const vis = on => on ? "visible" : "none";
  for (const id of NET_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(settings.transit));
  for (const id of ["poi-major", "poi-minor"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(settings.places));
  $('[data-act="transit-chip"]')?.classList.toggle("on", settings.transit);
}
map.on("style.load", applyLayers);
function renderLayers() {
  const sw = (on, attr, title, sub, ic) => `<div class="lrow3"><span class="ico">${icon(ic, "s")}</span><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span><button class="switch" role="switch" aria-checked="${on}" ${attr} aria-label="${title}"></button></div>`;
  const soonRow = (ic, title, sub) => `<div class="lrow3 off" data-soon="${title}"><span class="ico">${icon(ic, "s")}</span><span><b>${title}</b><small>${sub}</small></span>${soon()}</div>`;
  const types = [["map", "Default", true, null], ["satellite", "Satellite", false, "Satellite imagery"], ["terrain", "Terrain", false, "Terrain"]];
  $("#layers").innerHTML = `<div class="lhead"><b>Map</b><button class="hbtn" data-act="layers" aria-label="Close">${icon("close", "s")}</button></div>
    <div class="types">${types.map(([ic, label, ok, s2]) => `<button class="type${ok ? " on" : ""}" ${ok ? "" : `data-soon="${s2}"`}><span>${icon(ic)}</span>${label}${ok ? "" : soon()}</button>`).join("")}</div>
    <div class="types two">${["light", "dark"].map(t => `<button class="type${themeNow() === t ? " on" : ""}" data-theme-set="${t}"><span>${icon(t === "light" ? "sun" : "moon")}</span>${t === "light" ? "Light" : "Dark"}</button>`).join("")}</div>
    <p class="lsec">On the map</p>
    ${sw(settings.transit, 'data-layer="transit"', "Public transport", "Lines running now, stops and stations", "tram")}
    ${settings.transit ? `<div class="kinds">${CLASSES.filter(c => net.seen.has(c.id) || !net.enabled.has(c.id)).map(c => `<button data-mode="${c.id}" aria-pressed="${net.enabled.has(c.id)}">${icon(c.icon, "xs")}${c.label}</button>`).join("")}</div>` : ""}
    ${sw(settings.vehicles, 'data-set="vehicles"', "Moving vehicles", "Every bus, tram and train, live", "bus")}
    ${sw(settings.places, 'data-layer="places"', "Places", "Shops, food, culture, services", "pin")}
    ${soonRow("bike-route", "Bike routes", "Cycle networks and lanes")}
    ${soonRow("traffic", "Traffic", "Road speeds and closures")}
    ${soonRow("cloud", "Weather", "Rain radar and forecasts")}
    ${soonRow("wind", "Air quality", "Sensor readings")}
    ${soonRow("quake", "Earthquakes", "Live from seismic networks")}
    ${soonRow("book", "Wikipedia", "Articles about places")}
    ${soonRow("webcam", "Webcams", "Live views")}`;
}
function toggleLayers(force) {
  const el = $("#layers"), open = force ?? el.hidden;
  if (open) renderLayers();
  el.hidden = !open;
  $("#layersbtn").classList.toggle("on", open);
}
document.addEventListener("pointerdown", e => { if (!$("#layers").hidden && !e.target.closest("#layers, #layersbtn")) toggleLayers(false); });

/* ============================== Plan ============================== */

const T = { from: { me: true }, to: null, time: null, arriveBy: false, mode: "transit" };
const endName = e => e?.me ? (me ? "Your location" : "Map centre") : e?.name || "";
const endPos = e => e?.me ? here() : [e.lon, e.lat];
function planKey() { return JSON.stringify([endPos(T.from).map(v => v.toFixed(4)), T.to && endPos(T.to).map(v => v.toFixed(4)), T.time, T.arriveBy]); }
function loadPlan(s) {
  if (!T.to) return;
  const k = planKey();
  if (s.planKey === k && (s.plan || s["plan$"])) return;
  Object.assign(s, { planKey: k, plan: null, planErr: null, "plan$": false });
  load(s, "plan", () => api.plan({ from: endPos(T.from), to: endPos(T.to), time: T.time, arriveBy: T.arriveBy }));
  const pts = [endPos(T.from), endPos(T.to)];
  mapFor({ dim: true, pin: endPos(T.to) });
  frame(pts, 15);
}
const isDirect = (it, mode) => it.legs.every(l => l.mode === mode);
function options(s) {
  const p = s.plan; if (!p) return { transit: [], walk: [], bike: [] };
  return { transit: p.itineraries.filter(it => it.legs.some(l => l.mode !== "WALK" && l.mode !== "BIKE")),
    walk: (p.direct || []).filter(it => isDirect(it, "WALK")), bike: (p.direct || []).filter(it => isDirect(it, "BIKE")) };
}
function toLocalInput(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
/** Legs of a journey placed on a shared time axis (t0..t1): how each option fits into the hour. */
function legBars(it, t0, span) {
  return it.legs.filter(l => !(l.mode === "WALK" && l.duration < 60 && it.legs.length > 1)).map(l => {
    const left = (Date.parse(l.startTime) - t0) / span * 100, width = Math.max(0.8, (Date.parse(l.endTime) - Date.parse(l.startTime)) / span * 100);
    const pos = `left:${left.toFixed(2)}%;width:${width.toFixed(2)}%`;
    if (l.mode === "WALK") return `<i class="lw" style="${pos}" title="Walk ${duration(l.duration)}"></i>`;
    if (l.mode === "BIKE") return `<i class="lb" style="${pos}" title="Cycle ${duration(l.duration)}"></i>`;
    const line = lineOfStopTime(l);
    return `<i class="lr" style="${pos};--c:${colourOf(line)};--t:${textOn(line)}" title="${esc(classLabel(line.cls) + " " + line.name)}">${esc(line.name)}</i>`;
  }).join("");
}

VIEWS.plan = {
  sheet: "full",
  enter(s) { s.planKey = null; loadPlan(s); if (!T.to) { mapFor(); setTimeout(() => openOmni("to"), 60); } },
  html(s) {
    loadPlan(s);
    const o = options(s);
    const best = m => o[m].length ? duration(Math.min(...o[m].map(it => it.duration))) : s["plan$"] ? "…" : "–";
    const when = T.time ? `${T.arriveBy ? "Arrive by" : "Leave at"} ${new Date(T.time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "Leave now";
    const form = `<div class="form">
        <button class="fld" data-act="pick-from"><span class="lbl">From</span><span class="val">${esc(endName(T.from))}</span></button>
        <button class="fld" data-act="pick-to"><span class="lbl">To</span><span class="val${T.to ? "" : " ph"}">${esc(endName(T.to) || "Choose a destination")}</span></button>
        <button class="swap" data-act="swap" aria-label="Swap start and destination">${icon("swap", "s")}</button>
      </div>
      <div class="modes4" role="group" aria-label="How to travel"><button data-soon="Driving directions" class="off">${icon("car", "s")}<span>Drive</span><small>soon</small></button>${[["transit", "Transit", "tram"], ["walk", "Walk", "walk"], ["bike", "Cycle", "bike"]].map(([m, label, ic]) =>
        `<button data-trip-mode="${m}" aria-pressed="${T.mode === m}">${icon(ic, "s")}<span>${label}</span><small>${best(m)}</small></button>`).join("")}</div>
      <button class="whenbtn" data-act="when" aria-expanded="${!!s.whenOpen}">${icon("clock", "s")}${esc(when)}</button>
      ${s.whenOpen ? `<div class="whenbox"><div class="modes3 small" role="group">${[["now", "Now", !T.time], ["dep", "Leave at", !!T.time && !T.arriveBy], ["arr", "Arrive by", !!T.time && T.arriveBy]].map(([k, label, on]) => `<button data-when="${k}" aria-pressed="${on}"><span>${label}</span></button>`).join("")}</div>
        <input type="datetime-local" id="whenat" value="${toLocalInput(T.time ? new Date(T.time) : new Date())}" aria-label="Date and time"></div>` : ""}`;
    let list = "";
    if (!T.to) list = `<div class="note">Where to? Type a place, an address or a stop in the search at the top.</div>`;
    else if (s.planErr) list = failed(s.planErr, "reload-plan");
    else if (!s.plan) list = loading(4);
    else {
      const its = o[T.mode];
      if (!its.length) list = `<div class="note">${T.mode === "transit" ? "No public transport connection found for this time." : `Too far to ${T.mode === "walk" ? "walk" : "cycle"}.`}</div>`;
      else {
        // One time axis for all options, so leaving later or arriving earlier shows at a glance.
        const t0 = Math.min(...its.map(it => Date.parse(it.startTime))), t1 = Math.max(...its.map(it => Date.parse(it.endTime))), span = Math.max(60000, t1 - t0);
        const step = span > 3 * 3600e3 ? 3600e3 : span > 90 * 60e3 ? 30 * 60e3 : span > 40 * 60e3 ? 15 * 60e3 : 5 * 60e3;
        const ticks = [];
        for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);
        const tz = its[0].legs[0].from.tz;
        const fastest = Math.min(...its.map(it => it.duration));
        list = section(`${its.length} ${its.length === 1 ? "option" : "options"}`) + `<div class="chart">
          <div class="axis">${ticks.map(t => `<span style="left:${((t - t0) / span * 100).toFixed(2)}%">${clock(new Date(t).toISOString(), tz)}</span>`).join("")}</div>
          ${its.map(it => {
            const id = s.plan.itineraries.includes(it) ? `i${s.plan.itineraries.indexOf(it)}` : `d${s.plan.direct.indexOf(it)}`;
            const ride = it.legs.find(l => l.mode !== "WALK" && l.mode !== "BIKE");
            return `<button class="opt" data-itin="${id}">
              <span class="ot"><b>${clock(it.startTime, tz)} → ${clock(it.endTime, tz)}</b><span class="od">${duration(it.duration)}${it.duration === fastest ? " · fastest" : ""}</span></span>
              <span class="bars">${ticks.map(t => `<u style="left:${((t - t0) / span * 100).toFixed(2)}%"></u>`).join("")}${legBars(it, t0, span)}</span>
              <span class="os">${ride ? `${ride.realTime ? "live · " : ""}from ${esc(ride.from.name)} ${clock(ride.startTime, ride.from.tz)}${it.transfers ? ` · ${it.transfers} ${it.transfers === 1 ? "change" : "changes"}` : " · direct"}` : distance(it.legs.reduce((a, l) => a + (l.distance || 0), 0))}</span></button>`;
          }).join("")}</div>`
          + (T.mode === "transit" && s.plan.nextPageCursor ? `<button class="more-btn" data-act="later"${s["later$"] ? " disabled" : ""}>${s["later$"] ? "Loading…" : "Later options"}</button>` : "");
      }
    }
    return form + list + `<div class="card list opts"><div class="irow">${icon("wheel", "s")}<span>Step-free routes</span>${soon()}</div><div class="irow">${icon("ticket", "s")}<span>Fares and tickets</span>${soon()}</div></div>`;
  },
};
function itinOf(s, id) { return id[0] === "i" ? s.plan.itineraries[+id.slice(1)] : s.plan.direct[+id.slice(1)]; }
function itinFeatures(it) {
  const f = [];
  for (const l of it.legs) {
    const coords = shape(l.legGeometry);
    if (coords.length < 2) continue;
    if (l.mode === "WALK" || l.mode === "BIKE") { f.push({ type: "Feature", properties: { k: l.mode === "WALK" ? "walk" : "bike" }, geometry: { type: "LineString", coordinates: coords } }); continue; }
    const c = colourOf(lineOfStopTime(l));
    f.push({ type: "Feature", properties: { k: "ride", c }, geometry: { type: "MultiLineString", coordinates: splitJumps(coords, classOf(l.mode) === "train" ? 8000 : 1200) } });
    for (const p of l.intermediateStops || []) f.push({ type: "Feature", properties: { k: "stop", end: 0, c }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    for (const p of [l.from, l.to]) f.push({ type: "Feature", properties: { k: "stop", end: 1, c, name: p.name }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
  }
  return { type: "FeatureCollection", features: f };
}

/* ============================== Route (one option, step by step) ============================== */

VIEWS.itin = {
  sheet: "half",
  enter(s) {
    mapFor({ dim: true, tripFc: itinFeatures(s.it), pin: T.to ? endPos(T.to) : null });
    frame(s.it.legs.flatMap(l => shape(l.legGeometry)), 16);
  },
  html(s) {
    const it = s.it, tz = it.legs[0].from.tz, t0 = Date.parse(it.startTime), span = Math.max(60000, Date.parse(it.endTime) - t0);
    let rows = `<li class="st"><span class="t">${clock(it.startTime, tz)}</span><span class="n"><b>${esc(endName(T.from))}</b></span></li>`;
    it.legs.forEach((l, li) => {
      if (l.mode === "WALK" || l.mode === "BIKE") {
        if (l.duration < 30 && it.legs.length > 1) return;
        rows += `<li class="mv walk"><span class="t"></span><span class="n">${icon(l.mode === "WALK" ? "walk" : "bike", "s")}${l.mode === "WALK" ? "Walk" : "Cycle"} ${duration(l.duration)} · ${distance(l.distance || 0)}</span></li>`;
        return;
      }
      const line = lineOfStopTime(l), c = colourOf(line), mids = l.intermediateStops || [], open = s.open.has(li);
      const delay = l.realTime ? Math.round((Date.parse(l.startTime) - Date.parse(l.scheduledStartTime)) / 60000) : 0;
      rows += `<li class="st board" style="--c:${c}"><span class="t">${clock(l.startTime, l.from.tz)}${l.realTime ? `<small>${delay >= 1 ? `+${delay}` : "live"}</small>` : ""}</span><span class="n"><b>${esc(l.from.name)}</b>${l.from.track ? `<small>Platform ${esc(l.from.track)}</small>` : ""}</span></li>
        <li class="mv ride" style="--c:${c}"><span class="t"></span><span class="n">
          <button class="ridebtn" data-line="${esc(line.key)}" data-trip="${esc(l.tripId)}" data-at="${esc(l.from.parentId || l.from.stopId)}">${badge(line)}<span>to ${esc(l.headsign || l.tripTo?.name || "")}</span></button>
          <button class="tlink" data-open="${li}">${open ? "Hide stops" : `${mids.length + 1} ${mids.length ? "stops" : "stop"} · ${duration(l.duration)}`}</button></span></li>`;
      if (open) for (const p of mids) rows += `<li class="mid" style="--c:${c}"><span class="t">${clock(p.departure || p.arrival, p.tz)}</span><span class="n">${esc(p.name)}</span></li>`;
      rows += `<li class="st alight" style="--c:${c}"><span class="t">${clock(l.endTime, l.to.tz)}</span><span class="n"><b>${esc(l.to.name)}</b><small>Get off${l.to.track ? ` · platform ${esc(l.to.track)}` : ""}</small></span></li>`;
    });
    rows += `<li class="st end"><span class="t">${clock(it.endTime, tz)}</span><span class="n"><b>${esc(endName(T.to))}</b></span></li>`;
    return head(`${clock(it.startTime, tz)} → ${clock(it.endTime, tz)}`, `${duration(it.duration)} to ${endName(T.to)}`, it.transfers ? `${it.transfers} ${it.transfers === 1 ? "change" : "changes"}` : "No changes")
      + `<div class="bars solo">${legBars(it, t0, span)}</div><ol class="steps">${rows}</ol>`;
  },
};

/* ============================== Settings ============================== */

VIEWS.settings = {
  sheet: "full",
  enter() { mapFor(); },
  html() {
    const sw = (on, attr, title, sub, ic) => `<div class="set"><span class="sl">${ic ? icon(ic, "s") : ""}<span><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span></span><button class="switch" role="switch" aria-checked="${on}" ${attr} aria-label="${title}"></button></div>`;
    return head("Wayfinder", "Settings")
      + section("Appearance") + `<div class="modes3 small" role="group" aria-label="Theme">${["system", "light", "dark"].map(t => `<button data-theme-set="${t}" aria-pressed="${settings.theme === t}"><span>${cap(t)}</span></button>`).join("")}</div>`
      + section("Map") + `<div class="sets">${sw(settings.vehicles, 'data-set="vehicles"', "Moving vehicles", "Every bus, tram and train on its way, as it moves")}
        ${sw(settings.liveOnly, 'data-set="live"', "Only lines running now", "Lines with nothing on the move in the next half hour are left out")}
        ${sw(settings.spread, 'data-set="spread"', "Lines side by side", "Lines sharing a street or track are drawn next to each other")}</div>`
      + section("Show") + `<div class="sets">${CLASSES.map(c => sw(net.enabled.has(c.id), `data-mode="${c.id}"`, c.label, "", c.icon)).join("")}</div>`
      + section("Your data") + `<div class="sets"><button class="set" data-act="clear-recent"><span><b>Clear recent searches</b><small>Kept in this browser only</small></span></button></div>`
      + section("About") + `<p class="about">Timetables, live times and routing from <a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, drawn with <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>. Keys: <kbd>/</kbd> search, <kbd>Esc</kbd> back.</p>`;
  },
};

/* ============================== Search: in the bar, results drop down ============================== */

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const subOf = r => {
  const areas = r.areas || [];
  const town = areas.find(a => a.default)?.name, country = areas.find(a => a.adminLevel === 2)?.name;
  const kind = r.type === "STOP" ? "Stop" : r.type === "ADDRESS" ? [r.street, r.houseNumber].filter(Boolean).join(" ") || "Address" : r.category ? cap(r.category.replace(/_\d+$/, "").replace(/_/g, " ")) : "Place";
  return [kind, town !== r.name ? town : null, country].filter(Boolean).join(" · ");
};
const Q = { q: "", results: null, err: null, target: null, seq: 0 };
const qEl = $("#q"), omni = $("#omni");
function openOmni(target = null) {
  Q.target = target;
  qEl.placeholder = target === "from" ? "Start from…" : target === "to" ? "Going to…" : "Search Wayfinder";
  qEl.value = Q.q = ""; Q.results = null;
  qEl.focus();
  showOmni();
}
function showOmni() { omni.innerHTML = omniHtml(); omni.hidden = false; qEl.setAttribute("aria-expanded", "true"); document.body.classList.add("searching"); }
function closeOmni() {
  omni.hidden = true; qEl.setAttribute("aria-expanded", "false"); document.body.classList.remove("searching");
  if (document.activeElement === qEl) qEl.blur();
  Q.target = null; qEl.placeholder = "Search Wayfinder";
}
function resultRow(r, i, kind) {
  const ic = kind === "recent" ? "recent" : kind === "saved" ? "save" : r.type === "STOP" ? (r.modes?.some(m => classOf(m) === "train") ? "train" : r.modes?.includes("TRAM") ? "tram" : "bus") : r.type === "ADDRESS" ? "home" : "pin";
  return `<button class="res" data-result="${i}" data-kind="${kind}" role="option"><span class="rk">${icon(ic, "s")}</span><span class="rn"><b>${esc(r.name)}</b><small>${esc(r.sub ?? subOf(r))}</small></span><span class="rd">${distance(metres(here(), [r.lon, r.lat]))}</span></button>`;
}
function omniHtml() {
  const head2 = Q.target ? `<p class="oh">${Q.target === "from" ? "Choose where you start" : "Choose where you're going"}</p>` : "";
  if (!Q.q.trim()) {
    const rec = store.get("recent", []);
    return head2 + (Q.target ? `<button class="res" data-act="use-me"><span class="rk">${icon("loc-fix", "s")}</span><span class="rn"><b>Your location</b><small>${me ? "Found" : "Or the map centre until it's found"}</small></span><span></span></button>` : "")
      + (saved().length ? `<p class="oh">Saved</p>${saved().map((p, i) => resultRow({ ...p, type: "PLACE" }, i, "saved")).join("")}` : "")
      + (rec.length ? `<p class="oh">Recent</p>${rec.map((r, i) => resultRow(r, i, "recent")).join("")}` : `<p class="oh">Type a street, a place or a stop.</p>`);
  }
  if (Q.err) return head2 + `<p class="oh">Couldn't search (${esc(Q.err)}).</p>`;
  if (!Q.results) return head2 + `<p class="oh">Searching…</p>`;
  if (!Q.results.length) return head2 + `<p class="oh">Nothing found for “${esc(Q.q)}”.</p>`;
  return head2 + Q.results.map((r, i) => resultRow(r, i, "result")).join("");
}
const runSearch = debounce(async () => {
  const q = Q.q.trim(); if (!q) return;
  const mine = ++Q.seq;
  try {
    const r = await api.geocode(q, here());
    if (mine !== Q.seq) return;
    const h = here(); // nearby first (within 80 km), otherwise in the order the search ranked them
    Q.results = r.map((x, i) => ({ x, i, far: metres(h, [x.lon, x.lat]) > 80000 })).sort((a, b) => a.far - b.far || a.i - b.i).map(o => o.x);
    Q.err = null;
  } catch (e) { if (mine !== Q.seq) return; Q.err = e.message; }
  if (!omni.hidden) omni.innerHTML = omniHtml();
}, 180);
function choose(r) {
  const rec = store.get("recent", []).filter(x => !(x.name === r.name && Math.abs(x.lat - r.lat) < 1e-5));
  rec.unshift({ type: r.type, name: r.name, id: r.id, lat: r.lat, lon: r.lon, sub: r.sub ?? subOf(r), modes: r.modes });
  store.set("recent", rec.slice(0, 8));
  const place = { name: r.name, sub: r.sub ?? subOf(r), lon: r.lon, lat: r.lat };
  const target = Q.target;
  closeOmni(); qEl.value = "";
  if (target) { T[target] = place; if (screen().t === "plan") { screen().planKey = null; refresh(screen()); } else go({ t: "plan" }); return; }
  if (r.type === "STOP" && r.id) go({ t: "stop", ids: [r.id], name: r.name, lon: r.lon, lat: r.lat });
  else go({ t: "place", ...place });
}
qEl.addEventListener("focus", () => { if (omni.hidden) showOmni(); });
qEl.addEventListener("input", () => { Q.q = qEl.value; Q.results = null; Q.err = null; omni.innerHTML = omniHtml(); runSearch(); });
qEl.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const rows = [...omni.querySelectorAll(".res")];
    if (!rows.length) return;
    const i = rows.findIndex(r => r.classList.contains("sel")), j = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    rows.forEach(r => r.classList.remove("sel")); rows[j].classList.add("sel"); rows[j].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    (omni.querySelector(".res.sel") || omni.querySelector(".res[data-result]"))?.click();
  } else if (e.key === "Escape") { e.preventDefault(); closeOmni(); }
});
document.addEventListener("pointerdown", e => { if (!omni.hidden && !e.target.closest("#omniwrap")) closeOmni(); });

/* ============================== Events ============================== */

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3800);
}
function toggleSaved(s, sub) {
  let list = saved(); const i = list.findIndex(p => p.name === s.name && Math.abs(p.lon - s.lon) < 1e-4);
  if (i >= 0) list.splice(i, 1); else list = [...list, { name: s.name, sub, lon: s.lon, lat: s.lat }];
  store.set("saved", list); toast(i >= 0 ? "Removed from saved." : "Saved. It's on Here now."); refresh(s);
}
function rerenderSettings() { if (screen().t === "settings") refresh(screen()); }

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act],[data-line],[data-stop],[data-mode],[data-trip-mode],[data-itin],[data-open],[data-more],[data-result],[data-saved],[data-when],[data-set],[data-theme-set],[data-only],[data-soon],[data-ptab],[data-layer]");
  if (!el || el.disabled) return;
  const d = el.dataset, s = screen();
  if (d.soon) return toast(`${d.soon}: coming soon.`);
  if (d.ptab) { s.tab = d.ptab; return refresh(s); }
  if (d.layer === "transit") { settings.transit = !settings.transit; saveSettings(); applyLayers(); renderLayers(); $("#live").hidden = true; if (s.t === "explore") { if (settings.transit) loadHere(s, true); refresh(s); } return; }
  if (d.layer === "places") { settings.places = !settings.places; saveSettings(); applyLayers(); return renderLayers(); }
  if (d.more) { s.expanded.add(d.more); return refresh(s); }
  switch (d.act) {
    case "home": return backTo(0);
    case "menu": return s.t === "menu" ? back() : go({ t: "menu" });
    case "menu-saved": if (!saved().length) return toast("Nothing saved yet: open a place or stop and press Save."); if (s.t !== "menu") go({ t: "menu" }); return setTimeout(() => $("#savedlist")?.scrollIntoView({ behavior: "smooth" }), 80);
    case "search-go": return openOmni();
    case "layers": return toggleLayers();
    case "transit-chip": settings.transit = !settings.transit; saveSettings(); applyLayers(); if (!$("#layers").hidden) renderLayers(); if (s.t === "explore") { if (settings.transit) loadHere(s, true); refresh(s); } return;
    case "settings": return s.t === "settings" ? back() : go({ t: "settings" });
    case "plan": return s.t === "plan" ? openOmni("to") : go({ t: "plan" });
    case "theme": settings.theme = themeNow() === "dark" ? "light" : "dark"; saveSettings(); applyTheme(); return rerenderSettings();
    case "more": s.more = true; return refresh(s);
    case "reload-here": return loadHere(s, true);
    case "reload-stop": return loadStop(s);
    case "reload-line": s.dataErr = null; return loadLine(s);
    case "reload-plan": s.planKey = null; return refresh(s);
    case "more-deps": {
      try {
        const more = await Promise.all(s.cursors.map(x => api.departures({ stopId: x.id, n: 40, pageCursor: x.c })));
        s.cursors = more.map((r, i) => ({ id: s.cursors[i].id, c: r.nextPageCursor })).filter(x => x.c);
        s.deps = mergeStopTimes([s.deps, ...more.map(r => r.stopTimes)]); refresh(s);
      } catch (err) { toast(err.message); }
      return;
    }
    case "dir-stop": T.to = { name: s.name, sub: "Stop", lon: s.lon, lat: s.lat }; T.mode = "transit"; return go({ t: "plan" });
    case "dir-place": T.to = { name: s.name, sub: s.sub, lon: s.lon, lat: s.lat }; T.mode = "transit"; return go({ t: "plan" });
    case "save-stop": return toggleSaved(s, "Stop");
    case "save-place": return toggleSaved(s, s.sub);
    case "share": {
      try { if (navigator.share) await navigator.share({ title: s.name, url: location.href }); else { await navigator.clipboard.writeText(location.href); toast("Link copied."); } } catch { /* cancelled */ }
      return;
    }
    case "pick-from": return openOmni("from");
    case "pick-to": return openOmni("to");
    case "swap": if (T.to) [T.from, T.to] = [T.to, T.from]; s.planKey = null; return refresh(s);
    case "use-me": { const target = Q.target; closeOmni(); T[target] = { me: true }; if (screen().t === "plan") { screen().planKey = null; refresh(screen()); } else go({ t: "plan" }); return; }
    case "when": s.whenOpen = !s.whenOpen; return refresh(s);
    case "later": {
      if (!s.plan?.nextPageCursor) return;
      s["later$"] = true; refresh(s);
      try { const more = await api.plan({ from: endPos(T.from), to: endPos(T.to), time: T.time, arriveBy: T.arriveBy, pageCursor: s.plan.nextPageCursor }); s.plan = { ...s.plan, itineraries: [...s.plan.itineraries, ...more.itineraries], nextPageCursor: more.nextPageCursor }; }
      catch (err) { toast(err.message); }
      s["later$"] = false; return refresh(s);
    }
    case "clear-recent": store.set("recent", []); return toast("Recent searches cleared.");
  }
  if (d.mode) {
    net.enabled.has(d.mode) ? net.enabled.delete(d.mode) : net.enabled.add(d.mode);
    if (!net.enabled.size) net.enabled.add(d.mode);
    settings.modes = [...net.enabled]; saveSettings(); net.render(); statusModes();
    return refresh(s);
  }
  if (d.only) { s.only = s.only === d.only ? null : d.only; return refresh(s); }
  if (d.set && !$("#layers").hidden) setTimeout(renderLayers, 0);
  if (d.set === "vehicles") { settings.vehicles = net.vehicles = !settings.vehicles; saveSettings(); net.render(true); if (!settings.vehicles) map.getSource("vehicles")?.setData(EMPTY); return rerenderSettings(); }
  if (d.set === "live") { settings.liveOnly = net.liveOnly = !settings.liveOnly; saveSettings(); net.render(true); return rerenderSettings(); }
  if (d.set === "spread") { settings.spread = net.spread = !settings.spread; saveSettings(); net.render(true); return rerenderSettings(); }
  if (d.themeSet) { settings.theme = d.themeSet; saveSettings(); applyTheme(); if (!$("#layers").hidden) renderLayers(); return rerenderSettings(); }
  if (d.tripMode) { T.mode = d.tripMode; return refresh(s); }
  if (d.when) {
    if (d.when === "now") { T.time = null; T.arriveBy = false; s.whenOpen = false; }
    else { const v = $("#whenat").value; T.time = v ? new Date(v).toISOString() : new Date().toISOString(); T.arriveBy = d.when === "arr"; }
    s.planKey = null; return refresh(s);
  }
  if (d.itin) return go({ t: "itin", it: itinOf(s, d.itin), open: new Set() });
  if (d.open !== undefined) { const k = +d.open; s.open.has(k) ? s.open.delete(k) : s.open.add(k); return refresh(s); }
  if (d.result !== undefined) {
    const r = d.kind === "recent" ? store.get("recent", [])[+d.result] : d.kind === "saved" ? { type: "PLACE", ...saved()[+d.result] } : Q.results?.[+d.result];
    return r && choose(r);
  }
  if (d.saved !== undefined) { T.to = { ...saved()[+d.saved] }; T.mode = "transit"; return go({ t: "plan" }); }
  if (d.line) {
    if (!registry.get(d.line) || (s.t === "line" && s.key === d.line && !d.trip)) return;
    return go({ t: "line", key: d.line, tripId: d.trip || null, at: d.at || null });
  }
  if (d.stop) return go({ t: "stop", ids: d.stop.split("\n"), name: d.name, lon: d.lon ? +d.lon : null, lat: d.lat ? +d.lat : null });
});
document.addEventListener("change", e => { if (e.target.id === "whenat" && T.time) { T.time = new Date(e.target.value).toISOString(); screen().planKey = null; refresh(screen()); } });
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
  if (!typing && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))) { e.preventDefault(); openOmni(); return; }
  if (!typing && e.key === "Escape" && stack.length > 1) { e.preventDefault(); back(); }
  const row = e.target.closest?.(".lrow");
  if (row && (e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); }
});

// New lines arrived: connections in a line diagram and the mode switches can change.
net.on(debounce(() => {
  const s = screen();
  statusModes();
  if (s.t === "line" && s.data?.lay) meetings(registry.get(s.key), s.data.lay, net).then(m => { s.data.meet = m; refresh(s); });
  else if (s.t === "explore" && net.seen.size !== s.seenCount) { s.seenCount = net.seen.size; refresh(s); }
}, 900));

// Map taps: a vehicle opens its trip, a station its departures, a line the line (or a choice of lines).
const tapBox = (p, r = 8) => [[p.x - r, p.y - r], [p.x + r, p.y + r]];
map.on("click", e => {
  closeOmni();
  const veh = map.getLayer("vehicles") && map.queryRenderedFeatures(tapBox(e.point, 10), { layers: ["vehicles"] })[0];
  if (veh?.properties.key && registry.get(veh.properties.key)) return go({ t: "line", key: veh.properties.key, tripId: veh.properties.trip });
  const st = map.queryRenderedFeatures(tapBox(e.point), { layers: ["stations"] });
  if (st.length) { const f = st[0].properties; return go({ t: "stop", ids: String(f.keys).split("\n"), name: f.name, lon: st[0].geometry.coordinates[0], lat: st[0].geometry.coordinates[1] }); }
  const keys = [...new Set(map.queryRenderedFeatures(tapBox(e.point, 11), { layers: ["net-lines"] }).flatMap(f => net.keysOf(f.properties.lines)))];
  if (keys.length === 1) return go({ t: "line", key: keys[0] });
  if (keys.length > 1) return go({ t: "pick", keys });
});
map.on("contextmenu", e => go({ t: "place", name: "Dropped pin", sub: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`, lon: e.lngLat.lng, lat: e.lngLat.lat, needsName: true }));
let hoverRaf = 0;
map.on("mousemove", e => {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (!map.getLayer("stations")) return;
    map.getCanvas().style.cursor = map.queryRenderedFeatures(tapBox(e.point), { layers: ["stations", "net-lines", "vehicles"] }).length ? "pointer" : "";
  });
});

// The status line: how many vehicles move in view, and when they last moved.
net.onTick(() => {
  const n = net.vehicleCount || 0;
  $("#vcount").textContent = n;
  $("#live").hidden = !n || !settings.vehicles || !settings.transit;
});

// Start: read a link to a stop, a place or a line before drawing.
const deepLink = location.hash.slice(1).split("&").find(p => p.startsWith("s="));
history.replaceState({ wf: 1 }, "", urlFor(null));
render(true);
statusModes();
if (deepLink) {
  const v = decodeURIComponent(deepLink.slice(2)), kind = v.slice(0, v.indexOf(":")), [id, name] = v.slice(v.indexOf(":") + 1).split("~");
  if (kind === "stop") go({ t: "stop", ids: [id], name: name || null, lon: null, lat: null });
  else if (kind === "place") { const [lat, lon] = id.split(",").map(Number); go({ t: "place", name: name || "Place", sub: "", lon, lat }); }
  else if (kind === "line") {
    const tryOpen = () => { if (registry.get(id)) { go({ t: "line", key: id, tripId: name || null }); return true; } return false; };
    if (!tryOpen()) { const t = setInterval(() => { if (tryOpen()) clearInterval(t); }, 800); setTimeout(() => clearInterval(t), 30000); }
  }
}

// Works offline and installs like an app.
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

// For poking around in the browser console: wayfinder.map, wayfinder.net, wayfinder.stack …
window.wayfinder = { map, net, registry, get stack() { return stack; }, T, settings };
