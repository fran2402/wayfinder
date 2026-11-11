// Wayfinder: the interface. One map, one surface beside it (a sheet on phones, a docked panel on
// wide screens) and a stack of screens: explore → stop / line / place → directions → route.

import { api, shape } from "./api.js";
import { buildStyle, stopIcon, THEMES } from "./basemap.js";
import { Network } from "./network.js";
import { diagramModel, diagramHtml, drawDiagram, summaryHtml } from "./diagram.js";
import { CLASSES, badge, classLabel, classOf, colourOf, textOn, compareLines, lineOfStopTime, registry } from "./lines.js";
import { $, esc, icon, clock, minutesUntil, duration, distance, metres, debounce, store } from "./util.js";

/* ============================== Settings ============================== */

const settings = Object.assign({ theme: "system", spread: true, liveOnly: true, modes: CLASSES.map(c => c.id) }, store.get("settings", {}));
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
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '<a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>' }), "bottom-right");
map.on("styleimagemissing", e => { if (e.id.startsWith("stop-")) stopIcon(map, e.id, THEMES[themeNow()]); });

const net = new Network(map);
net.spread = settings.spread;
net.liveOnly = settings.liveOnly;
net.enabled = new Set(settings.modes);

const EMPTY = { type: "FeatureCollection", features: [] };
const overlay = { focus: EMPTY, trip: EMPTY };
function setOverlay(name, fc) { overlay[name] = fc; map.getSource(name)?.setData(fc); }

map.on("load", () => net.update());
map.on("moveend", () => {
  net.update();
  store.set("view", { center: map.getCenter().toArray(), zoom: map.getZoom() });
  onMapMoved();
});
net.on(() => { $("#busy").hidden = net.loading === 0; });

function applyTheme() {
  const t = themeNow();
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === "dark" ? "#141619" : "#FBFAF6";
  map.setStyle(buildStyle(t));
  map.once("style.load", () => { net.render(true); net.applyFocus(); for (const k in overlay) map.getSource(k)?.setData(overlay[k]); });
}
darkQuery.addEventListener("change", () => settings.theme === "system" && applyTheme());

const meEl = document.createElement("div"); meEl.className = "me-dot";
const meMarker = new maplibregl.Marker({ element: meEl });
const pinEl = document.createElement("div"); pinEl.className = "pin-mark";
pinEl.innerHTML = `<svg viewBox="0 0 30 40"><path d="M15 39C15 39 2 23.5 2 14.5a13 13 0 0 1 26 0C28 23.5 15 39 15 39Z" fill="#141518" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.5" r="5.5" fill="#FFC21A"/></svg>`;
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
    if (first && screen().t === "explore") loadNearby(screen(), true);
  }, err => { watching = false; if (fly) toast(err.code === 1 ? "Location permission was refused." : "Couldn't find your location."); },
  { enableHighAccuracy: true, maximumAge: 15000 });
}
navigator.permissions?.query({ name: "geolocation" }).then(r => { if (r.state === "granted") locate(false); }).catch(() => {});
$("#locate").addEventListener("click", () => locate(true));

/* ============================== Sheet (phones) ============================== */

const panel = $("#panel"), body = $("#body");
let sheet = "half";
function sheetHeight(state = sheet) {
  const H = innerHeight, topH = ($("#top").offsetHeight || 54) + 22;
  return state === "peek" ? 128 : state === "full" ? H - topH - 6 : Math.round(H * 0.46);
}
function setSheet(state, animate = true) {
  sheet = state;
  panel.classList.toggle("anim", animate);
  document.body.style.setProperty("--sheet", wide() ? "0px" : sheetHeight() + "px");
  document.body.dataset.sheet = wide() ? "" : state;
}
function padding() {
  if (wide()) return { top: 70, bottom: 70, left: 70, right: 90 };
  return { top: ($("#top").offsetHeight || 54) + 50, bottom: sheetHeight() + 24, left: 36, right: 36 };
}
wideQuery.addEventListener("change", () => { map.resize(); render(); });
addEventListener("resize", debounce(() => { setSheet(sheet, false); afterRender(); }, 100));
(() => {
  const grip = $("#grip");
  let start = null;
  grip.addEventListener("pointerdown", e => { if (wide()) return; start = { y: e.clientY, h: sheetHeight() }; grip.setPointerCapture(e.pointerId); panel.classList.remove("anim"); });
  grip.addEventListener("pointermove", e => {
    if (!start) return;
    document.body.style.setProperty("--sheet", Math.max(108, Math.min(sheetHeight("full"), start.h - (e.clientY - start.y))) + "px");
  });
  grip.addEventListener("pointerup", e => {
    if (!start) return;
    const dy = e.clientY - start.y, h = start.h - dy;
    start = null;
    if (Math.abs(dy) < 6) return setSheet(sheet === "full" ? "half" : sheet === "half" ? "full" : "half");
    setSheet(["peek", "half", "full"].reduce((a, b) => Math.abs(sheetHeight(b) - h) < Math.abs(sheetHeight(a) - h) ? b : a));
  });
})();

/* ============================== Navigation ============================== */

const PAGES = new Set(["search", "settings"]);
let stack = [{ t: "explore", tab: "near" }];
const cur = () => stack[stack.length - 1];
function screen() { for (let i = stack.length - 1; i >= 0; i--) if (!PAGES.has(stack[i].t)) return stack[i]; return stack[0]; }
function go(s) { stack.push(s); render(true); }
function back() { if (stack.length > 1) { stack.pop(); render(true); } }
function home() { stack = [stack[0]]; render(true); }

let shown = null;
function render(fresh = false) {
  const c = cur(), s = screen(), V = VIEWS[s.t];
  const page = $("#page");
  page.hidden = !PAGES.has(c.t);
  if (PAGES.has(c.t) && (fresh || page.dataset.t !== c.t)) {
    page.innerHTML = c.t === "search" ? searchPage(c) : settingsPage();
    page.dataset.t = c.t;
    if (c.t === "search") setTimeout(() => $("#q")?.focus(), 40);
  }
  if (!PAGES.has(c.t)) page.dataset.t = "";
  const topHtml = s.t === "trip" || s.t === "itin" ? tripCard() : searchBar();
  $("#top").innerHTML = wide() ? "" : topHtml;
  $("#ptop").innerHTML = wide() ? topHtml : "";
  document.body.dataset.screen = s.t;
  const keep = shown === s && !fresh ? body.scrollTop : 0;
  body.innerHTML = V.html(s);
  body.scrollTop = keep;
  if (shown !== s) { shown = s; if (!wide()) setSheet(V.sheet || "half"); V.enter?.(s); }
  else setSheet(sheet, false);
  afterRender();
}
function afterRender() { const s = screen(); VIEWS[s.t].after?.(s); }
/** Re-draw a screen's content (data arrived), keeping the scroll position. */
function refresh(s) {
  if (screen() !== s) return;
  const sc = body.scrollTop;
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
const here = () => me || map.getCenter().toArray();

/* ============================== Shared pieces ============================== */

const loading = (n = 3) => Array.from({ length: n }, () => `<div class="skel"></div>`).join("");
const failed = (msg, retry) => `<div class="empty">${icon("warn")}<p>Couldn't load this (${esc(msg)}).</p>${retry ? `<button class="btn" data-act="${retry}">Try again</button>` : ""}</div>`;
const KIND_ICON = { train: "train", metro: "metro", tram: "tram", bus: "bus", ferry: "ferry", other: "cable" };

function countdown(times) {
  const label = x => { const m = minutesUntil(x.iso); return m <= 0 ? null : m < 60 ? `${m}` : clock(x.iso, x.tz); };
  const f = times[0], late = f.sched && Date.parse(f.iso) - Date.parse(f.sched) >= 60000, fl = label(f);
  const cls = f.cancelled ? "cx" : late ? "late" : f.rt ? "rt" : "";
  const first = fl == null ? `<span class="first now">NOW</span>` : `<span class="first ${cls}">${fl}${/:/.test(fl) ? "" : "<small>min</small>"}</span>`;
  const rest = times.slice(1, 3).map(x => label(x) ?? "now").join(", ");
  return `<span class="cd" title="${f.cancelled ? "Cancelled" : clock(f.iso, f.tz) + (f.rt ? " · live" : " · timetable")}">${rest ? `<span class="rest">${rest}</span>` : ""}${first}</span>`;
}
/** Departures grouped by line and direction, soonest first. */
function groupDepartures(stopTimes) {
  const groups = new Map();
  for (const st of stopTimes) {
    const line = lineOfStopTime(st);
    if (!line || !net.enabled.has(line.cls)) continue;
    const to = st.headsign || st.tripTo?.name || "";
    const k = line.key + "|" + to;
    if (!groups.has(k)) groups.set(k, { line, to, times: [] });
    groups.get(k).times.push({ iso: st.place.departure || st.place.arrival, sched: st.place.scheduledDeparture, rt: st.realTime, cancelled: st.cancelled || st.tripCancelled, tz: st.place.tz, tripId: st.tripId, stop: st.place });
  }
  return [...groups.values()].sort((a, b) => Date.parse(a.times[0].iso) - Date.parse(b.times[0].iso));
}
function deps(groups, max = 99) {
  if (!groups.length) return `<p class="pad">No departures in the next hours.</p>`;
  return groups.slice(0, max).map(g => {
    const t = g.times[0];
    return `<button class="dep" data-line="${esc(g.line.key)}" data-trip="${esc(t.tripId)}" data-at="${esc(t.stop.parentId || t.stop.stopId)}">
      ${badge(g.line)}<span class="to"><b>${esc(g.to)}</b>${t.stop.track ? `<small>Platform ${esc(t.stop.track)}</small>` : ""}</span>${countdown(g.times)}</button>`;
  }).join("");
}
/** Merge stop times from several stops (one station), without duplicates. */
function mergeStopTimes(lists) {
  const seen = new Set(), out = [];
  for (const st of lists.flat()) { const k = st.tripId + "|" + (st.place.departure || st.place.arrival); if (!seen.has(k)) { seen.add(k); out.push(st); } }
  return out.sort((a, b) => Date.parse(a.place.departure || a.place.arrival) - Date.parse(b.place.departure || b.place.arrival));
}
/** Stations from departures around a point: stops with the same name are one station. */
function stationsFrom(stopTimes, origin, max) {
  const norm = n => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const by = new Map();
  for (const st of stopTimes) {
    const p = st.place, k = norm(p.name);
    if (!by.has(k)) by.set(k, { name: p.name, lon: p.lon, lat: p.lat, keys: new Set(), sts: [], kinds: new Set(), d: Infinity });
    const g = by.get(k), d = metres(origin, [p.lon, p.lat]);
    g.keys.add(p.parentId || p.stopId); g.sts.push(st);
    const c = classOf(st.mode); if (c) g.kinds.add(c);
    if (d < g.d) { g.d = d; g.lon = p.lon; g.lat = p.lat; }
  }
  return [...by.values()].sort((a, b) => a.d - b.d).slice(0, max);
}
function board(st, nRows, distLabel) {
  const kinds = CLASSES.filter(c => st.kinds.has(c.id)).map(c => icon(KIND_ICON[c.id])).join("");
  return `<section class="board"><button class="board-h" data-stop="${esc([...st.keys].join("\n"))}" data-name="${esc(st.name)}" data-lon="${st.lon}" data-lat="${st.lat}">
      <span class="nm"><b>${esc(st.name)}</b><small>${distLabel}</small></span><span class="kinds">${kinds}</span>${icon("chev", "s")}</button>
    ${deps(groupDepartures(st.sts), nRows)}</section>`;
}

function searchBar() {
  return `<div class="search" role="search"><button class="field" data-act="search">${icon("search")}<span>Where to?</span></button>
    <button class="me" data-act="settings" aria-label="Settings">${icon("gear", "s")}</button></div>`;
}

/* ============================== Explore ============================== */

function loadNearby(s, force) {
  const c = here();
  if (!force && s.nearAt && metres(c, s.nearAt) < 250) return;
  s.nearAt = c; s.near = null; s["near$"] = false;
  load(s, "near", async () => stationsFrom((await api.departures({ center: c, radius: 600, n: 100 })).stopTimes, c, 4));
}
const onMapMoved = debounce(() => {
  const s = screen();
  if (s.t !== "explore" || PAGES.has(cur().t)) return;
  if (s.tab === "lines") loadInView(s);
  else if (!me) loadNearby(s);
}, 450);
function loadInView(s) { net.linesInView().then(ls => { s.inview = ls.sort(compareLines); refresh(s); }); }
const saved = () => store.get("saved", []);

const VIEWS = {};
VIEWS.explore = {
  sheet: "half",
  enter(s) { mapFor(); loadNearby(s); if (s.tab === "lines") loadInView(s); },
  html(s) {
    const places = saved();
    const shortcuts = places.length ? `<div class="shortcuts">${places.map((p, i) => `<button class="shortcut" data-saved="${i}"><span class="sq">${icon("dir", "s")}</span><span><b>${esc(p.name)}</b><small>Directions</small></span></button>`).join("")}</div>` : "";
    const modes = CLASSES.filter(c => net.seen.has(c.id) || !net.enabled.has(c.id));
    const modeBar = modes.length > 1 ? `<div class="modes-bar" role="group" aria-label="Show on the map">${modes.map(c => `<button class="mode" data-mode="${c.id}" aria-pressed="${net.enabled.has(c.id)}">${icon(c.icon)}${c.label}</button>`).join("")}</div>` : "";
    const tabs = `<div class="tabs" role="tablist"><button role="tab" data-tab="near" aria-selected="${s.tab === "near"}">${me ? "Near you" : "Nearby"}</button><button role="tab" data-tab="lines" aria-selected="${s.tab === "lines"}">Lines in view</button></div>`;
    let content;
    if (s.tab === "lines") {
      const ls = s.inview;
      content = !ls ? loading() : !ls.length ? `<p class="pad">No lines here at this zoom. Zoom in for trams and buses.</p>` :
        CLASSES.filter(c => ls.some(l => l.cls === c.id)).map(c => `<p class="sec">${c.label}</p><div class="list">${ls.filter(l => l.cls === c.id).slice(0, 80).map(l =>
          `<button class="row line" data-line="${esc(l.key)}">${badge(l)}<span><b>${esc(l.longName || `${classLabel(l.cls)} ${l.name}`)}</b><small>${l.numStops ? `${l.numStops} stops` : classLabel(l.cls)}</small></span>${icon("chev", "s")}</button>`).join("")}</div>`).join("");
    } else {
      content = s.nearErr ? failed(s.nearErr, "reload-near") : !s.near ? `<p class="sec">Departures</p>${loading(4)}` :
        !s.near.length ? `<p class="pad">No stops within 600 m of ${me ? "you" : "the map centre"}. Move the map to a town or city.</p>` :
        `<p class="sec"><span>${me ? "Departures near you" : "Departures near the map centre"}</span><button class="link act" data-act="reload-near">${icon("refresh", "xs")}Refresh</button></p>` +
        s.near.map(st => board(st, 4, `${distance(st.d)}${me ? ` · ${Math.max(1, Math.round(st.d / 75))} min walk` : ""}`)).join("");
    }
    return shortcuts + modeBar + tabs + content;
  },
};

/* ============================== Stop (a station: one or more stops with one name) ============================== */

VIEWS.stop = {
  sheet: "half",
  enter(s) {
    mapFor();
    if (s.lon != null) map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 16), padding: padding(), duration: 650 });
    // A stop from search: take in the other stops of its station, if the map knows them.
    if (s.ids.length === 1) net.group(s.ids[0]).then(g => { if (g && g.keys.length > 1 && screen() === s) { s.ids = g.keys; s.name = s.name || g.name; s.deps = null; s["deps$"] = false; loadStop(s); } });
    loadStop(s);
    clearInterval(s.timer);
    s.timer = setInterval(() => { if (screen() !== s) return clearInterval(s.timer); loadStop(s, true); }, 30000);
  },
  html(s) {
    const g = s.deps ? groupDepartures(s.deps) : [];
    const lines = [...new Map(g.map(x => [x.line.key, x.line])).values()].sort(compareLines);
    const kinds = CLASSES.filter(c => lines.some(l => l.cls === c.id));
    const shownG = s.only ? g.filter(x => x.line.key === s.only) : g;
    const d = me && s.lon != null ? metres(me, [s.lon, s.lat]) : null;
    return `<header class="sign"><div><b>${esc(s.name || "Stop")}</b><small>${[d != null ? distance(d) : null, lines.length ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}` : null, s.ids.length > 1 ? `${s.ids.length} stops` : null].filter(Boolean).join(" · ") || "Stop"}</small>
        ${kinds.length ? `<div class="kinds">${kinds.map(c => `<span title="${c.label}">${icon(KIND_ICON[c.id])}</span>`).join("")}</div>` : ""}</div>
      <div class="tools"><button class="accent" data-act="dir-stop" aria-label="Directions to here">${icon("dir", "s")}</button><button data-act="back" aria-label="Close">${icon("close", "s")}</button></div></header>
      ${lines.length > 1 ? `<div class="chips">${lines.map(l => `<button class="chip" data-only="${esc(l.key)}" aria-pressed="${s.only === l.key}">${badge(l, "sm")}${esc(l.longName ? l.longName.split(/\s*[-–>]\s*/).pop().slice(0, 22) : classLabel(l.cls))}</button>`).join("")}</div>` : ""}
      <div class="legend"><span><i class="l-rt"></i>live</span><span><i class="l-late"></i>late</span><span>times in minutes</span></div>
      ${s.depsErr ? failed(s.depsErr, "reload-stop") : !s.deps ? loading(5) : `<div class="board">${deps(shownG)}</div>`}
      ${s.deps && s.cursors?.length ? `<button class="btn block" data-act="more-deps">Later departures</button>` : ""}`;
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
    if (p && s.lon == null) { s.lon = p.lon; s.lat = p.lat; map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16), padding: padding() }); }
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
    const title = d ? `To ${d.stops[d.stops.length - 1].name}` : l.longName || `${classLabel(l.cls)} ${l.name}`;
    const head = `<header class="lhead">${badge(l, "big")}<div><b>${esc(title)}</b><small>${esc([classLabel(l.cls), d && `${d.stops.length} stops`, l.agency].filter(Boolean).join(" · "))}</small></div>
      <button class="icon-btn filled" data-act="back" aria-label="Close">${icon("close", "s")}</button></header>`;
    if (s.dataErr) return head + failed(s.dataErr, "reload-line");
    if (!d || !s.model) return head + loading(6);
    const first = d.stops[0], last = d.stops[d.stops.length - 1];
    return head + `<div class="seg" role="group" aria-label="Direction">
        <button aria-pressed="true">To ${esc(last.name)}</button>
        <button data-act="reverse" aria-pressed="false"${s["rev$"] ? " disabled" : ""}>${s["rev$"] ? "Finding…" : `To ${esc(first.name)}`}</button></div>
      ${diagramHtml(l, d.stops, s.model, { expanded: s.expanded, current: s.at, rightLabel: d.timed ? (d.live ? "live trip" : "next trip") : "" })}
      ${d.timed ? summaryHtml(d.stops, s.back) : `<p class="pad">Nothing of this line is running in the next hours.</p>`}`;
  },
  after(s) { if (s.data && s.model) requestAnimationFrame(() => drawDiagram(registry.get(s.key), s.data.stops, s.model)); },
};

async function tripData(tripId) {
  const t = await api.trip(tripId);
  const leg = t.legs.find(l => l.tripId) || t.legs[0];
  const stops = [leg.from, ...(leg.intermediateStops || []), leg.to].map(stopOf);
  const now = Date.now();
  stops.forEach(x => { x.past = x.time && Date.parse(x.time) < now - 30000; x.rt = leg.realTime; x.late = x.sched && x.time && Date.parse(x.time) - Date.parse(x.sched) >= 60000; });
  return { stops, shape: shape(leg.legGeometry), timed: true, live: leg.realTime, tripId };
}
function loadLine(s) {
  s.expanded = s.expanded || new Set();
  load(s, "data", async () => {
    const l = registry.get(s.key);
    let d = null;
    if (s.tripId) d = await tripData(s.tripId);
    else {
      // From the map: the line's route, then its next trip from the first stop.
      const rd = await api.routeDetails([...l.routes][0]);
      const r = rd.routes[0];
      const rstops = [r.segments[0].from, ...r.segments.map(x => x.to)].map(i => rd.stops[i]);
      try {
        const dep = await api.departures({ stopId: rstops[0].stopId, n: 80 });
        const st = dep.stopTimes.find(x => lineOfStopTime(x) === l);
        if (st) { s.tripId = st.tripId; d = await tripData(st.tripId); }
      } catch { /* stops without times */ }
      if (!d) d = { stops: rstops.map(stopOf), shape: r.segments.flatMap(x => shape(rd.polylines[x.polyline]?.polyline)), timed: false };
    }
    s.model = await diagramModel(l, d.stops, net);
    s.back = null;
    if (d.timed) findBack(l, d).then(async st => {
      if (!st || s.data !== d) return;
      const b = await tripData(st.tripId), bs = b.stops;
      const journey = (Date.parse(bs[bs.length - 1].arr || bs[bs.length - 1].time) - Date.parse(bs[0].dep || bs[0].time)) / 1000;
      const turn = Math.max(0, Math.min(3600, (Date.parse(bs[0].dep || bs[0].time) - Date.parse(d.stops[d.stops.length - 1].arr || d.stops[d.stops.length - 1].time)) / 1000));
      if (journey > 0) { s.back = { journey, turn }; refresh(s); }
    }).catch(() => {});
    const coords = d.shape.length > 1 ? d.shape : d.stops.map(x => [x.lon, x.lat]);
    setOverlay("focus", { type: "FeatureCollection", features: [{ type: "Feature", properties: { c: colourOf(l) }, geometry: { type: "LineString", coordinates: coords } }] });
    frame(coords, 15.5);
    return d;
  });
}
/** The next trip of this line leaving from the far end, back towards the start. */
async function findBack(l, d) {
  const last = d.stops[d.stops.length - 1], firstName = d.stops[0].name;
  const dep = await api.departures({ stopId: last.key, n: 100, time: last.arr || last.time });
  return dep.stopTimes.find(x => lineOfStopTime(x) === l && (x.tripTo?.name === firstName || x.headsign === firstName))
    || dep.stopTimes.find(x => lineOfStopTime(x) === l && x.tripTo?.name !== last.name);
}
async function reverseLine(s) {
  const d = s.data, l = registry.get(s.key);
  if (!d || s["rev$"]) return;
  s["rev$"] = true; refresh(s);
  try {
    const st = await findBack(l, d);
    if (!st) throw new Error("no trip back soon");
    Object.assign(s, { tripId: st.tripId, data: null, model: null, at: null, back: null, "rev$": false });
    loadLine(s);
  } catch (e) { s["rev$"] = false; toast(`Couldn't find the other direction (${e.message}).`); refresh(s); }
}

/* ============================== Lines under a tap ============================== */

VIEWS.pick = {
  sheet: "half",
  enter() { mapFor(); },
  html(s) {
    const ls = s.keys.map(k => registry.get(k)).filter(Boolean).sort(compareLines);
    return `<header class="lhead"><span></span><div><b>${ls.length} lines here</b><small>Pick one to follow</small></div><button class="icon-btn filled" data-act="back" aria-label="Close">${icon("close", "s")}</button></header>
      <div class="list">${ls.map(l => `<button class="row line" data-line="${esc(l.key)}">${badge(l)}<span><b>${esc(l.longName || `${classLabel(l.cls)} ${l.name}`)}</b><small>${esc(classLabel(l.cls))}</small></span>${icon("chev", "s")}</button>`).join("")}</div>`;
  },
};

/* ============================== Place ============================== */

VIEWS.place = {
  sheet: "half",
  enter(s) {
    mapFor({ pin: [s.lon, s.lat] });
    map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), padding: padding(), duration: 650 });
    load(s, "near", async () => stationsFrom((await api.departures({ center: [s.lon, s.lat], radius: 500, n: 60 })).stopTimes, [s.lon, s.lat], 2));
    if (s.needsName) load(s, "rev", async () => { const a = (await api.reverse([s.lon, s.lat]))[0]; if (a) { s.name = a.name; s.sub = subOf(a); } return true; });
  },
  html(s) {
    const isSaved = saved().some(p => p.name === s.name && Math.abs(p.lon - s.lon) < 1e-5);
    const d = me ? metres(me, [s.lon, s.lat]) : null;
    return `<header class="phead"><div><b>${esc(s.name)}</b><small>${esc([s.sub, d != null ? `${distance(d)} away` : null].filter(Boolean).join(" · "))}</small></div>
        <button class="icon-btn filled" data-act="back" aria-label="Close">${icon("close", "s")}</button></header>
      <div class="actions"><button class="btn ink" data-act="dir-place">${icon("dir", "s")}Directions</button>
        <button class="btn sq" data-act="save-place" aria-label="${isSaved ? "Remove from saved" : "Save place"}" aria-pressed="${isSaved}">${icon("save", "s")}</button>
        <button class="btn sq" data-act="share" aria-label="Share">${icon("share", "s")}</button></div>
      <p class="sec">Public transport nearby</p>
      ${s.nearErr ? failed(s.nearErr) : !s.near ? loading(3) : s.near.length ? s.near.map(st => board(st, 3, `${distance(st.d)} from here`)).join("") : `<p class="pad">No stops within 500 m.</p>`}`;
  },
};

/* ============================== Directions ============================== */

const T = { from: { me: true }, to: null, time: null, arriveBy: false, mode: "transit" };
const endName = e => e?.me ? (me ? "Your location" : "Map centre") : e?.name || "Choose destination";
const endPos = e => e?.me ? here() : [e.lon, e.lat];

function tripCard() {
  return `<div class="trip"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back", "s")}</button>
    <div class="ends"><button class="end" data-act="pick-from"><span class="dot-from"></span><span>${esc(endName(T.from))}</span></button>
      <button class="end${T.to ? "" : " unset"}" data-act="pick-to"><span class="dot-to"></span><span>${esc(endName(T.to))}</span></button></div>
    <button class="icon-btn filled" data-act="swap" aria-label="Swap start and destination">${icon("swap", "s")}</button></div>`;
}
function planKey() { return JSON.stringify([endPos(T.from).map(v => v.toFixed(4)), T.to && endPos(T.to).map(v => v.toFixed(4)), T.time, T.arriveBy]); }
function loadPlan(s) {
  if (!T.to) return;
  const k = planKey();
  if (s.planKey === k && (s.plan || s["plan$"])) return;
  Object.assign(s, { planKey: k, plan: null, planErr: null, "plan$": false });
  load(s, "plan", () => api.plan({ from: endPos(T.from), to: endPos(T.to), time: T.time, arriveBy: T.arriveBy }));
}
const isDirect = (it, mode) => it.legs.every(l => l.mode === mode);
function options(s) {
  const p = s.plan; if (!p) return { transit: [], walk: [], bike: [] };
  return { transit: p.itineraries.filter(it => it.legs.some(l => l.mode !== "WALK" && l.mode !== "BIKE")),
    walk: (p.direct || []).filter(it => isDirect(it, "WALK")), bike: (p.direct || []).filter(it => isDirect(it, "BIKE")) };
}
function journeyBar(it) {
  return `<div class="jbar">${it.legs.filter(l => !(l.mode === "WALK" && l.duration < 90 && it.legs.length > 1)).map(l => {
    const grow = Math.max(1, l.duration);
    if (l.mode === "WALK") return `<span class="walk" style="flex:${grow}" title="Walk ${duration(l.duration)}">${icon("walk")}</span>`;
    if (l.mode === "BIKE") return `<span class="bike" style="flex:${grow}" title="Cycle ${duration(l.duration)}">${icon("bike")}</span>`;
    const line = lineOfStopTime(l);
    return `<span style="flex:${grow};--c:${colourOf(line)};--t:${textOn(line)}" title="${esc(classLabel(line.cls) + " " + line.name)}">${esc(line.name)}</span>`;
  }).join("")}</div>`;
}
function itinCard(it, id, tags) {
  const ride = it.legs.find(l => l.mode !== "WALK" && l.mode !== "BIKE"), tz = it.legs[0].from.tz;
  const dist = it.legs.reduce((a, l) => a + (l.distance || 0), 0);
  return `<button class="itin" data-itin="${id}"><div class="r1"><b>${clock(it.startTime, tz)}–${clock(it.endTime, tz)}</b>${tags}<span class="dur">${duration(it.duration)}</span></div>
    ${journeyBar(it)}
    <div class="r3">${ride ? `${ride.realTime ? `<i class="livedot"></i>` : ""}From ${esc(ride.from.name)} at ${clock(ride.startTime, ride.from.tz)}${it.transfers ? ` · ${it.transfers} ${it.transfers === 1 ? "change" : "changes"}` : ""}` : distance(dist)}</div></button>`;
}
function toLocalInput(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

VIEWS.trip = {
  sheet: "half",
  enter(s) {
    s.planKey = null; loadPlan(s);
    const pts = [endPos(T.from), T.to && endPos(T.to)].filter(Boolean);
    mapFor({ dim: true, pin: T.to ? endPos(T.to) : null });
    frame(pts, 15);
  },
  html(s) {
    loadPlan(s);
    const o = options(s);
    const best = m => o[m].length ? duration(Math.min(...o[m].map(it => it.duration))) : s["plan$"] ? "…" : "–";
    const btn = (m, label, ic) => `<button data-trip-mode="${m}" aria-pressed="${T.mode === m}">${icon(ic)}<small>${best(m)}</small><span class="sr">${label}</span></button>`;
    const when = T.time ? `${T.arriveBy ? "Arrive by" : "Depart"} ${new Date(T.time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "Leave now";
    let list;
    if (!T.to) list = `<p class="pad">Choose where you're going.</p>`;
    else if (s.planErr) list = failed(s.planErr, "reload-plan");
    else if (!s.plan) list = loading(4);
    else {
      const its = o[T.mode];
      if (!its.length) list = `<div class="empty">${icon("info")}<p>${T.mode === "transit" ? "No public transport connection found for this time." : `Too far to ${T.mode === "walk" ? "walk" : "cycle"}.`}</p></div>`;
      else {
        const fastest = Math.min(...its.map(it => it.duration)), fewest = Math.min(...its.map(it => it.transfers)), fastIt = its.find(x => x.duration === fastest);
        const fewIt = its.filter(x => x.transfers === fewest).sort((a, b) => a.duration - b.duration)[0];
        list = its.map(it => itinCard(it, s.plan.itineraries.includes(it) ? `i${s.plan.itineraries.indexOf(it)}` : `d${s.plan.direct.indexOf(it)}`,
          (it === fastIt ? `<span class="tag">Fastest</span>` : "") + (T.mode === "transit" && it === fewIt && fewest < fastIt.transfers ? `<span class="tag alt">Fewest changes</span>` : ""))).join("")
          + (T.mode === "transit" && s.plan.nextPageCursor ? `<button class="btn block" data-act="later"${s["later$"] ? " disabled" : ""}>${s["later$"] ? "Loading…" : "Later connections"}</button>` : "");
      }
    }
    return `<div class="tmodes" role="group" aria-label="How to travel">${btn("transit", "Public transport", "tram")}${btn("walk", "Walk", "walk")}${btn("bike", "Cycle", "bike")}</div>
      <button class="when" data-act="when" aria-expanded="${!!s.whenOpen}">${icon("clock", "s")}${esc(when)}${icon("caret-down", "xs")}</button>
      ${s.whenOpen ? `<div class="whenbox"><div class="seg" role="group"><button data-when="now" aria-pressed="${!T.time}">Now</button><button data-when="dep" aria-pressed="${!!T.time && !T.arriveBy}">Depart at</button><button data-when="arr" aria-pressed="${!!T.time && T.arriveBy}">Arrive by</button></div>
        <input type="datetime-local" id="whenat" value="${toLocalInput(T.time ? new Date(T.time) : new Date())}" aria-label="Date and time"></div>` : ""}
      ${list}`;
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
    f.push({ type: "Feature", properties: { k: "ride", c }, geometry: { type: "LineString", coordinates: coords } });
    for (const p of l.intermediateStops || []) f.push({ type: "Feature", properties: { k: "stop", end: 0, c }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    for (const p of [l.from, l.to]) f.push({ type: "Feature", properties: { k: "stop", end: 1, c, name: p.name }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
  }
  return { type: "FeatureCollection", features: f };
}

VIEWS.itin = {
  sheet: "half",
  enter(s) {
    mapFor({ dim: true, tripFc: itinFeatures(s.it), pin: T.to ? endPos(T.to) : null });
    frame(s.it.legs.flatMap(l => shape(l.legGeometry)), 16);
  },
  html(s) {
    const it = s.it, tz = it.legs[0].from.tz;
    let rows = `<div class="tlrow stopr walk-top"><span class="t">${clock(it.startTime, tz)}</span><span class="rail"></span><div class="c"><b>${esc(endName(T.from))}</b></div></div>`;
    it.legs.forEach((l, li) => {
      if (l.mode === "WALK" || l.mode === "BIKE") {
        if (l.duration < 30 && it.legs.length > 1) return;
        rows += `<div class="tlrow walkseg"><span class="t"></span><span class="rail"></span><div class="c"><span class="walkline">${icon(l.mode === "WALK" ? "walk" : "bike", "s")}${l.mode === "WALK" ? "Walk" : "Cycle"} ${duration(l.duration)} · ${distance(l.distance || 0)}</span></div></div>`;
        return;
      }
      const line = lineOfStopTime(l), c = colourOf(line), mids = l.intermediateStops || [], open = s.open.has(li);
      const late = l.realTime && Date.parse(l.startTime) - Date.parse(l.scheduledStartTime) >= 60000;
      rows += `<div class="tlrow stopr ride-top" style="--c:${c}"><span class="t${late ? " late" : l.realTime ? " rt" : ""}">${clock(l.startTime, l.from.tz)}</span><span class="rail"></span><div class="c">
          <b>${esc(l.from.name)}</b>${l.from.track ? `<small>Platform ${esc(l.from.track)}</small>` : ""}
          <button class="ride" data-line="${esc(line.key)}" data-trip="${esc(l.tripId)}" data-at="${esc(l.from.parentId || l.from.stopId)}">${badge(line)}<span>towards ${esc(l.headsign || l.tripTo?.name || "")}</span>${icon("chev", "s")}</button>
          <button class="link" data-open="${li}" style="padding-left:0">${open ? "Hide stops" : `${mids.length + 1} ${mids.length ? "stops" : "stop"} · ${duration(l.duration)}`}</button></div></div>`;
      if (open) for (const p of mids) rows += `<div class="tlrow stopr small ride-mid mid" style="--c:${c}"><span class="t sm">${clock(p.departure || p.arrival, p.tz)}</span><span class="rail"></span><div class="c">${esc(p.name)}</div></div>`;
      else rows += `<div class="tlrow rideseg" style="--c:${c}"><span class="t"></span><span class="rail"></span><div class="c"></div></div>`;
      rows += `<div class="tlrow stopr ride-bottom" style="--c:${c}"><span class="t">${clock(l.endTime, l.to.tz)}</span><span class="rail"></span><div class="c"><b>${esc(l.to.name)}</b><small>Get off${l.to.track ? ` · platform ${esc(l.to.track)}` : ""}</small></div></div>`;
    });
    rows += `<div class="tlrow stopr walk-bottom"><span class="t">${clock(it.endTime, tz)}</span><span class="rail"></span><div class="c"><b>${esc(endName(T.to))}</b></div></div>`;
    return `<header class="lhead"><button class="icon-btn filled" data-act="back" aria-label="Back to routes">${icon("back", "s")}</button>
        <div><b>${duration(it.duration)} · arrive ${clock(it.endTime, tz)}</b><small>${it.transfers ? `${it.transfers} ${it.transfers === 1 ? "change" : "changes"}` : "No changes"}</small></div><span></span></header>
      ${journeyBar(it)}<div class="tl">${rows}</div>`;
  },
};

/* ============================== Search ============================== */

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const subOf = r => {
  const areas = r.areas || [];
  const town = areas.find(a => a.default)?.name, country = areas.find(a => a.adminLevel === 2)?.name;
  const kind = r.type === "STOP" ? "Stop" : r.type === "ADDRESS" ? [r.street, r.houseNumber].filter(Boolean).join(" ") || "Address" : r.category ? cap(r.category.replace(/_\d+$/, "").replace(/_/g, " ")) : "Place";
  return [kind, town !== r.name ? town : null, country].filter(Boolean).join(" · ");
};
function resultRow(r, i, recent) {
  const ic = recent ? "recent" : r.type === "STOP" ? (r.modes?.some(m => classOf(m) === "train") ? "train" : r.modes?.includes("TRAM") ? "tram" : "bus") : r.type === "ADDRESS" ? "home" : "pin";
  return `<button class="row" data-result="${i}" data-recent="${recent ? 1 : 0}"><span class="sq">${icon(ic, "s")}</span><span><b>${esc(r.name)}</b><small>${esc(r.sub ?? subOf(r))}</small></span><span class="aside">${distance(metres(here(), [r.lon, r.lat]))}</span></button>`;
}
function searchPage(s) {
  const ph = s.target === "from" ? "Start from…" : s.target === "to" ? "Going to…" : "Places, addresses and stops";
  return `<div class="pagehead"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back", "s")}</button>
      <label class="qfield">${icon("search", "s")}<input id="q" type="search" placeholder="${esc(ph)}" value="${esc(s.q || "")}" autocomplete="off" enterkeyhint="search"></label></div>
    <div class="pagebody" id="results">${searchResults(s)}</div>`;
}
function searchResults(s) {
  if (!s.q?.trim()) {
    const rec = store.get("recent", []);
    return (s.target ? `<div class="list"><button class="row" data-act="use-me"><span class="sq">${icon("loc-fix", "s")}</span><span><b>Your location</b><small>${me ? "Found" : "Or the map centre, until it's found"}</small></span><span></span></button></div>` : "")
      + (saved().length ? `<p class="sec">Saved</p><div class="list">${saved().map((p, i) => `<button class="row" data-savedpick="${i}"><span class="sq">${icon("save", "s")}</span><span><b>${esc(p.name)}</b><small>${esc(p.sub || "")}</small></span><span></span></button>`).join("")}</div>` : "")
      + (rec.length ? `<p class="sec">Recent</p><div class="list">${rec.map((r, i) => resultRow(r, i, true)).join("")}</div>` : `<p class="pad">Search for a street, a place or a stop anywhere Transitous covers.</p>`);
  }
  if (s.err) return failed(s.err);
  if (!s.results) return loading(4);
  if (!s.results.length) return `<div class="empty">${icon("search")}<p>Nothing found for “${esc(s.q)}”.</p></div>`;
  return `<div class="list">${s.results.map((r, i) => resultRow(r, i)).join("")}</div>`;
}
const runSearch = debounce(async s => {
  const q = s.q?.trim(); if (!q) return;
  const mine = (s.seq = (s.seq || 0) + 1);
  try {
    const r = await api.geocode(q, here());
    if (mine !== s.seq) return;
    const h = here(); // nearby first (within 80 km), otherwise in the order the search ranked them
    s.results = r.map((x, i) => ({ x, i, far: metres(h, [x.lon, x.lat]) > 80000 })).sort((a, b) => a.far - b.far || a.i - b.i).map(o => o.x);
    s.err = null;
  } catch (e) { if (mine !== s.seq) return; s.err = e.message; }
  if (cur() === s) $("#results").innerHTML = searchResults(s);
}, 200);
function chooseResult(r, s) {
  const rec = store.get("recent", []).filter(x => !(x.name === r.name && Math.abs(x.lat - r.lat) < 1e-5));
  rec.unshift({ type: r.type, name: r.name, id: r.id, lat: r.lat, lon: r.lon, sub: r.sub ?? subOf(r), modes: r.modes });
  store.set("recent", rec.slice(0, 8));
  const place = { name: r.name, sub: r.sub ?? subOf(r), lon: r.lon, lat: r.lat };
  stack.pop();
  if (s.target) { T[s.target] = place; shown = null; return render(true); }
  if (r.type === "STOP" && r.id) go({ t: "stop", ids: [r.id], name: r.name, lon: r.lon, lat: r.lat });
  else go({ t: "place", ...place });
}

/* ============================== Settings ============================== */

function settingsPage() {
  const sw = (on, attr, title, sub, ic) => `<div class="setrow"><span class="lead">${ic ? icon(ic) : ""}<span><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span></span><button class="switch" role="switch" aria-checked="${on}" ${attr} aria-label="${title}"></button></div>`;
  return `<div class="pagehead"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back", "s")}</button><h2>Settings</h2></div>
    <div class="pagebody">
      <p class="sec">Appearance</p>
      <div class="seg" role="group" aria-label="Theme">${["system", "light", "dark"].map(t => `<button data-theme-set="${t}" aria-pressed="${settings.theme === t}">${cap(t)}</button>`).join("")}</div>
      <p class="sec">Map</p>
      <div class="group">${sw(settings.liveOnly, 'data-set="live"', "Only lines running now", "Lines with nothing on the move in the next half hour are left out")}
        ${sw(settings.spread, 'data-set="spread"', "Lines side by side", "Lines sharing a street or track are drawn next to each other")}</div>
      <p class="sec">Show</p>
      <div class="group">${CLASSES.map(c => sw(net.enabled.has(c.id), `data-mode="${c.id}"`, c.label, "", c.icon)).join("")}</div>
      <p class="sec">Your data</p>
      <div class="group"><button class="setrow" data-act="clear-recent"><span><b>Clear recent searches</b><small>Kept in this browser only</small></span>${icon("chev", "s")}</button></div>
      <p class="sec">About</p>
      <div class="group"><div class="setrow"><span><b>Wayfinder</b><small>Timetables, live times and routing from <a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, drawn with <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>. Set in Overpass.</small></span></div></div>
    </div>`;
}

/* ============================== Events ============================== */

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3800);
}

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act],[data-line],[data-stop],[data-tab],[data-mode],[data-trip-mode],[data-itin],[data-open],[data-more],[data-less],[data-result],[data-saved],[data-savedpick],[data-when],[data-set],[data-theme-set],[data-only]");
  if (!el || el.disabled) return;
  const d = el.dataset, s = screen();
  if (d.more) { s.expanded.add(d.more); return refresh(s); }
  if (d.less) { s.expanded.delete(d.less); return refresh(s); }
  switch (d.act) {
    case "search": return go({ t: "search", q: "" });
    case "settings": return go({ t: "settings" });
    case "home": return home();
    case "back": return back();
    case "reload-near": return loadNearby(s, true);
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
    case "reverse": return reverseLine(s);
    case "dir-stop": T.to = { name: s.name, sub: "Stop", lon: s.lon, lat: s.lat }; T.mode = "transit"; return go({ t: "trip" });
    case "dir-place": T.to = { name: s.name, sub: s.sub, lon: s.lon, lat: s.lat }; T.mode = "transit"; return go({ t: "trip" });
    case "save-place": {
      let list = saved(); const i = list.findIndex(p => p.name === s.name && Math.abs(p.lon - s.lon) < 1e-5);
      if (i >= 0) list.splice(i, 1); else list = [...list, { name: s.name, sub: s.sub, lon: s.lon, lat: s.lat }];
      store.set("saved", list); toast(i >= 0 ? "Removed from saved places." : "Saved. It's on the start screen now."); return refresh(s);
    }
    case "share": {
      const url = `${location.origin}${location.pathname}#map=17/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}`;
      try { if (navigator.share) await navigator.share({ title: s.name, url }); else { await navigator.clipboard.writeText(url); toast("Link copied."); } } catch { /* cancelled */ }
      return;
    }
    case "pick-from": return go({ t: "search", q: "", target: "from" });
    case "pick-to": return go({ t: "search", q: "", target: "to" });
    case "swap": if (T.to) [T.from, T.to] = [T.to, T.from]; shown = null; return render(true);
    case "use-me": T[cur().target] = { me: true }; stack.pop(); shown = null; return render(true);
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
  if (d.tab) { s.tab = d.tab; if (d.tab === "lines") { s.inview = null; loadInView(s); } return refresh(s); }
  if (d.mode) {
    net.enabled.has(d.mode) ? net.enabled.delete(d.mode) : net.enabled.add(d.mode);
    if (!net.enabled.size) net.enabled.add(d.mode);
    settings.modes = [...net.enabled]; saveSettings(); net.render();
    if (cur().t === "settings") $("#page").innerHTML = settingsPage();
    return refresh(s);
  }
  if (d.only) { s.only = s.only === d.only ? null : d.only; return refresh(s); }
  if (d.set === "live") { settings.liveOnly = net.liveOnly = !settings.liveOnly; saveSettings(); net.render(true); $("#page").innerHTML = settingsPage(); return; }
  if (d.set === "spread") { settings.spread = net.spread = !settings.spread; saveSettings(); net.render(); $("#page").innerHTML = settingsPage(); return; }
  if (d.themeSet) { settings.theme = d.themeSet; saveSettings(); applyTheme(); $("#page").innerHTML = settingsPage(); return; }
  if (d.tripMode) { T.mode = d.tripMode; return refresh(s); }
  if (d.when) {
    if (d.when === "now") { T.time = null; T.arriveBy = false; s.whenOpen = false; }
    else { const v = $("#whenat").value; T.time = v ? new Date(v).toISOString() : new Date().toISOString(); T.arriveBy = d.when === "arr"; }
    return refresh(s);
  }
  if (d.itin) return go({ t: "itin", it: itinOf(s, d.itin), open: new Set() });
  if (d.open !== undefined) { const k = +d.open; s.open.has(k) ? s.open.delete(k) : s.open.add(k); return refresh(s); }
  if (d.result !== undefined) { const c = cur(), r = d.recent === "1" ? store.get("recent", [])[+d.result] : c.results[+d.result]; return r && chooseResult(r, c); }
  if (d.savedpick !== undefined) return chooseResult({ type: "PLACE", ...saved()[+d.savedpick] }, cur());
  if (d.saved !== undefined) { T.to = { ...saved()[+d.saved] }; T.mode = "transit"; return go({ t: "trip" }); }
  if (d.line) {
    if (!registry.get(d.line) || (s.t === "line" && s.key === d.line && !d.trip)) return;
    return go({ t: "line", key: d.line, tripId: d.trip || null, at: d.at || null });
  }
  if (d.stop) return go({ t: "stop", ids: d.stop.split("\n"), name: d.name, lon: d.lon ? +d.lon : null, lat: d.lat ? +d.lat : null });
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { const s = cur(); s.q = e.target.value; s.results = null; s.err = null; $("#results").innerHTML = searchResults(s); runSearch(s); }
});
document.addEventListener("change", e => { if (e.target.id === "whenat" && T.time) { T.time = new Date(e.target.value).toISOString(); refresh(screen()); } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && stack.length > 1) { e.preventDefault(); back(); }
  const row = e.target.closest?.(".srow");
  if (row && (e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); }
  if (e.key === "Enter" && e.target.id === "q") { const s = cur(); if (s.results?.[0]) chooseResult(s.results[0], s); }
});

// New lines arrived: connections in a line diagram and the mode filters can change.
net.on(debounce(() => {
  const s = screen();
  if (PAGES.has(cur().t)) return;
  if (s.t === "line" && s.data && s.model) diagramModel(registry.get(s.key), s.data.stops, net).then(m => { s.model = m; refresh(s); });
  else if (s.t === "explore" && net.seen.size !== s.seenCount) { s.seenCount = net.seen.size; refresh(s); }
}, 900));

// Map taps: a station opens its departures, a line opens the line (or a choice of lines).
const tapBox = (p, r = 8) => [[p.x - r, p.y - r], [p.x + r, p.y + r]];
map.on("click", e => {
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
    map.getCanvas().style.cursor = map.queryRenderedFeatures(tapBox(e.point), { layers: ["stations", "net-lines"] }).length ? "pointer" : "";
  });
});

render(true);

// For poking around in the browser console: wayfinder.map, wayfinder.net, wayfinder.stack …
window.wayfinder = { map, net, registry, get stack() { return stack; }, T, settings };
