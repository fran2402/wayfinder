// Wayfinder: the interface. One map, one surface beside it (a bottom sheet on phones, a panel on
// wide screens), and a stack of screens: explore → stop / line / place → directions → route.

import { api, shape } from "./api.js";
import { buildStyle } from "./basemap.js";
import { Network } from "./network.js";
import { diagramModel, diagramHtml, drawDiagram } from "./diagram.js";
import { CLASSES, badge, classLabel, colourOf, compareLines, lineOfStopTime, registry, classOf } from "./lines.js";
import { $, esc, icon, clock, minutesUntil, duration, distance, metres, debounce, store } from "./util.js";

/* ============================== Settings ============================== */

const settings = Object.assign({ theme: "system", spread: true, modes: CLASSES.map(c => c.id) }, store.get("settings", {}));
const saveSettings = () => store.set("settings", settings);
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const effectiveTheme = () => settings.theme === "system" ? (darkQuery.matches ? "dark" : "light") : settings.theme;
document.documentElement.dataset.theme = effectiveTheme();

/* ============================== Map ============================== */

const START = store.get("view", { center: [15.977, 45.8131], zoom: 13.2 }); // Zagreb until you move
const map = new maplibregl.Map({
  container: "map", style: buildStyle(effectiveTheme()), center: START.center, zoom: START.zoom, hash: "map",
  attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, minZoom: 3, maxZoom: 19,
  fadeDuration: 150,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '<a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>' }), "bottom-right");

const net = new Network(map);
net.spread = settings.spread;
net.enabled = new Set(settings.modes);

const EMPTY = { type: "FeatureCollection", features: [] };
const overlay = { focus: EMPTY, trip: EMPTY };
function setOverlay(name, fc) { overlay[name] = fc; map.getSource(name)?.setData(fc); }

map.on("load", () => { net.update(); net.render(); });
map.on("moveend", () => {
  net.update();
  store.set("view", { center: map.getCenter().toArray(), zoom: map.getZoom() });
  onMapMoved();
});
net.on(() => { $("#busy").hidden = net.loading === 0; });
// New lines arrived: connections in a line diagram and the "lines in view" list can change.
net.on(debounce(() => {
  const s = screen();
  if (PAGES.has(cur().t)) return;
  if (s.t === "line" && s.data) { s.model = diagramModel(registry.get(s.key), s.data.stops, net); refresh(s); }
  else if (s.t === "explore" && (s.tab === "lines" || net.seen.size !== s.seenCount)) { s.seenCount = net.seen.size; refresh(s); }
}, 600));

function applyTheme() {
  const t = effectiveTheme();
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === "dark" ? "#141914" : "#F8FAF3";
  map.setStyle(buildStyle(t));
  map.once("style.load", () => { net.render(); for (const k in overlay) map.getSource(k)?.setData(overlay[k]); });
}
darkQuery.addEventListener("change", () => settings.theme === "system" && applyTheme());

// Markers: you, and a pin for a chosen place.
const meEl = document.createElement("div"); meEl.className = "me-dot";
const meMarker = new maplibregl.Marker({ element: meEl });
const pinEl = document.createElement("div"); pinEl.className = "pin-mark"; pinEl.innerHTML = icon("pin");
const pinMarker = new maplibregl.Marker({ element: pinEl, anchor: "bottom" });

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

/* ============================== Layout: sheet or panel ============================== */

const wideQuery = matchMedia("(min-width: 840px)");
const wide = () => wideQuery.matches;
const panel = $("#panel"), body = $("#body");
let sheet = "half";
function sheetHeight(state = sheet) {
  const H = innerHeight, topH = ($("#top").offsetHeight || 56) + 24;
  return state === "peek" ? 132 : state === "full" ? H - topH - 8 : Math.round(H * 0.46);
}
function setSheet(state, animate = true) {
  sheet = state;
  panel.classList.toggle("anim", animate);
  document.body.style.setProperty("--sheet", wide() ? "0px" : sheetHeight() + "px");
  document.body.dataset.sheet = state;
}
function padding() {
  if (wide()) return { top: 60, bottom: 60, left: panel.offsetWidth + 56, right: 60 };
  return { top: ($("#top").offsetHeight || 56) + 56, bottom: sheetHeight() + 24, left: 36, right: 36 };
}
wideQuery.addEventListener("change", () => { render(); });
addEventListener("resize", debounce(() => { setSheet(sheet, false); afterRender(); }, 100));

// Drag the sheet by its handle; it snaps to small, half or full and never hides completely.
(() => {
  const grip = $("#grip");
  let start = null;
  grip.addEventListener("pointerdown", e => { if (wide()) return; start = { y: e.clientY, h: sheetHeight(), t: Date.now() }; grip.setPointerCapture(e.pointerId); panel.classList.remove("anim"); });
  grip.addEventListener("pointermove", e => {
    if (!start) return;
    const h = Math.max(110, Math.min(sheetHeight("full"), start.h - (e.clientY - start.y)));
    document.body.style.setProperty("--sheet", h + "px");
  });
  grip.addEventListener("pointerup", e => {
    if (!start) return;
    const dy = e.clientY - start.y, h = start.h - dy;
    start = null;
    if (Math.abs(dy) < 6) return setSheet(sheet === "full" ? "half" : sheet === "half" ? "full" : "half");
    const states = ["peek", "half", "full"];
    const best = states.reduce((a, b) => Math.abs(sheetHeight(b) - h) < Math.abs(sheetHeight(a) - h) ? b : a);
    setSheet(best);
  });
})();

/* ============================== Navigation ============================== */

const PAGES = new Set(["search", "settings"]);
let stack = [{ t: "explore", tab: "deps" }];
const cur = () => stack[stack.length - 1];
function screen() { for (let i = stack.length - 1; i >= 0; i--) if (!PAGES.has(stack[i].t)) return stack[i]; return stack[0]; }
function go(s) { stack.push(s); render(true); }
function back() { if (stack.length > 1) { stack.pop(); render(true); } }
function home() { stack = [stack[0]]; render(true); }

let shownScreen = null;
function render(fresh = false) {
  const c = cur(), s = screen(), V = VIEWS[s.t];
  // Pages cover everything on phones and the panel on wide screens.
  const page = $("#page");
  page.hidden = !PAGES.has(c.t);
  if (PAGES.has(c.t)) {
    if (fresh || page.dataset.t !== c.t) { page.innerHTML = c.t === "search" ? searchPage(c) : settingsPage(); page.dataset.t = c.t; }
    if (c.t === "search" && fresh) setTimeout(() => $("#q")?.focus(), 40);
  } else page.dataset.t = "";
  const tripTop = s.t === "trip" || s.t === "itin";
  const topHtml = tripTop ? tripCard() : searchBar();
  $("#top").innerHTML = wide() ? "" : topHtml;
  $("#ptop").innerHTML = wide() ? topHtml : "";
  document.body.dataset.screen = s.t;
  const scroll = shownScreen === s && !fresh ? body.scrollTop : 0;
  body.innerHTML = V.html(s);
  body.scrollTop = scroll;
  if (shownScreen !== s) {
    shownScreen = s;
    if (!wide()) setSheet(s.sheet || V.sheet || "half");
    V.enter?.(s);
  } else setSheet(sheet, false);
  afterRender();
}
function afterRender() { const s = screen(); VIEWS[s.t].after?.(s); }
/** Re-draw the current screen's content (data arrived) without leaving it. */
function refresh(s) { if (screen() === s && !PAGES.has(cur().t)) render(); else if (screen() === s) { const sc = body.scrollTop; body.innerHTML = VIEWS[s.t].html(s); body.scrollTop = sc; afterRender(); } }

/** Load data for a screen once; re-draw it when it arrives. */
async function load(s, key, fn) {
  if (s[key + "$"]) return;
  s[key + "$"] = true;
  try { s[key] = await fn(); s[key + "Err"] = null; }
  catch (e) { s[key + "Err"] = e.message || "Something went wrong"; }
  finally { s[key + "$"] = false; refresh(s); }
}

/** What the map shows behind each screen. */
function mapFor({ focus = null, dim = false, focusFc = EMPTY, tripFc = EMPTY, pin = null } = {}) {
  net.setFocus(focus, dim);
  setOverlay("focus", focusFc);
  setOverlay("trip", tripFc);
  if (pin) pinMarker.setLngLat(pin).addTo(map); else pinMarker.remove();
}
function frame(coords, maxZoom = 16) {
  if (!coords.length) return;
  const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: padding(), maxZoom, duration: 700 });
}
const here = () => me || map.getCenter().toArray();

/* ============================== Shared pieces ============================== */

const loading = (text = "Loading") => `<div class="loading"><span class="spinner"></span>${esc(text)}…</div>`;
const failed = (msg, retry) => `<div class="empty">${icon("warn")}<p>Couldn't load this (${esc(msg)}).</p>${retry ? `<button class="btn tonal" data-act="${retry}">Try again</button>` : ""}</div>`;

function timeChips(times, max = 3) {
  return `<span class="times">${times.slice(0, max).map(x => {
    const m = minutesUntil(x.iso), late = x.sched && Date.parse(x.iso) - Date.parse(x.sched) >= 60000;
    const label = m <= 0 ? "now" : m < 60 ? `${m}` : clock(x.iso, x.tz);
    return `<span class="${x.cancelled ? "cx" : late ? "late" : x.rt ? "rt" : ""}" title="${x.cancelled ? "Cancelled" : clock(x.iso, x.tz) + (x.rt ? " (live)" : " (timetable)")}">${label}</span>`;
  }).join("")}</span>`;
}

/** Departures grouped by line and direction, soonest first. */
function groupDepartures(stopTimes) {
  const groups = new Map();
  for (const st of stopTimes) {
    const line = lineOfStopTime(st);
    if (!line || !net.enabled.has(line.cls)) continue;
    const to = st.headsign || st.tripTo?.name || "";
    const k = line.key + "|" + to;
    if (!groups.has(k)) groups.set(k, { line, to, times: [], first: st });
    groups.get(k).times.push({ iso: st.place.departure || st.place.arrival, sched: st.place.scheduledDeparture, rt: st.realTime, cancelled: st.cancelled || st.tripCancelled, tz: st.place.tz, tripId: st.tripId, stop: st.place });
  }
  return [...groups.values()].sort((a, b) => Date.parse(a.times[0].iso) - Date.parse(b.times[0].iso));
}
function depRows(groups, max = 99) {
  if (!groups.length) return `<p class="muted pad">No departures in the next hours.</p>`;
  return groups.slice(0, max).map(g => {
    const t = g.times[0];
    return `<button class="deprow" data-line="${esc(g.line.key)}" data-trip="${esc(t.tripId)}" data-at="${esc(t.stop.parentId || t.stop.stopId)}">
      ${badge(g.line)}<span class="to"><b>${esc(g.to)}</b>${t.stop.track ? `<small>Platform ${esc(t.stop.track)}</small>` : ""}</span>
      ${timeChips(g.times)}</button>`;
  }).join("");
}

function searchBar() {
  return `<div class="searchbar" role="search">
    <button class="sb-field" data-act="search">${icon("search")}<span>Search places and stops</span></button>
    <button class="round tonal" data-act="settings" aria-label="Settings">${icon("gear")}</button></div>`;
}

/* ============================== Explore ============================== */

function loadNearby(s, force) {
  const c = here();
  if (!force && s.depsAt && metres(c, s.depsAt) < 250) return;
  s.depsAt = c; s.deps = null;
  s["deps$"] = false;
  load(s, "deps", async () => {
    const d = await api.departures({ center: c, radius: 600, n: 90 });
    const stations = new Map();
    for (const st of d.stopTimes) {
      const k = st.place.parentId || st.place.stopId;
      if (!stations.has(k)) stations.set(k, { key: k, name: st.place.name, lon: st.place.lon, lat: st.place.lat, d: metres(c, [st.place.lon, st.place.lat]), sts: [] });
      stations.get(k).sts.push(st);
    }
    return [...stations.values()].sort((a, b) => a.d - b.d).slice(0, 4);
  });
}
const onMapMoved = debounce(() => {
  const s = screen();
  if (s.t !== "explore" || PAGES.has(cur().t)) return;
  if (s.tab === "lines") refresh(s);
  else if (!me) loadNearby(s);
}, 500);

const saved = () => store.get("saved", []);

const VIEWS = {};
VIEWS.explore = {
  sheet: "half",
  enter(s) { mapFor(); loadNearby(s); },
  html(s) {
    const places = saved();
    const shortcuts = places.length ? `<div class="chips shortcuts">${places.map((p, i) => `<button class="shortcut" data-saved="${i}"><span class="ico">${icon(p.icon || "pin")}</span><span><b>${esc(p.name)}</b><small>Directions</small></span></button>`).join("")}</div>` : "";
    const modeChips = `<div class="chips" role="group" aria-label="Show on the map">${CLASSES.filter(c => net.seen.has(c.id) || !net.enabled.has(c.id)).map(c => `<button class="chip" data-mode="${c.id}" aria-pressed="${net.enabled.has(c.id)}">${icon(c.icon)}${c.label}</button>`).join("")}</div>`;
    const tabs = `<div class="tabs" role="tablist"><button role="tab" data-tab="deps" aria-selected="${s.tab === "deps"}">Departures</button><button role="tab" data-tab="lines" aria-selected="${s.tab === "lines"}">Lines in view</button></div>`;
    let content;
    if (s.tab === "lines") {
      const ls = net.linesInView();
      content = ls.length ? CLASSES.filter(c => ls.some(l => l.cls === c.id)).map(c => `<p class="eyebrow">${c.label}</p><div class="list">${ls.filter(l => l.cls === c.id).slice(0, 60).map(l =>
        `<button class="item line" data-line="${esc(l.key)}">${badge(l)}<span><b>${esc(l.longName || `${classLabel(l.cls)} ${l.name}`)}</b><small>${esc(classLabel(l.cls))}${l.numStops ? ` · ${l.numStops} stops` : ""}</small></span>${icon("chev", "s")}</button>`).join("")}</div>`).join("")
        : net.loading ? loading("Loading lines") : `<p class="muted pad">No lines here at this zoom. Zoom in to see trams and buses.</p>`;
    } else {
      const where = me ? "Near you" : "Near the map centre";
      content = s.depsErr ? failed(s.depsErr, "reload-deps") : !s.deps ? loading("Finding departures") :
        !s.deps.length ? `<p class="muted pad">No stops within 600 m of ${me ? "you" : "the map centre"}. Move the map to a city.</p>` :
        `<p class="eyebrow row">${where}<button class="linkbtn" data-act="reload-deps">${icon("refresh", "s")}Refresh</button></p>` +
        s.deps.map(st => `<div class="nearstop"><h4><button class="linkish" data-stop="${esc(st.key)}" data-name="${esc(st.name)}" data-lon="${st.lon}" data-lat="${st.lat}">${esc(st.name)}${icon("chev", "s")}</button><small>${distance(st.d)}${me ? ` · ${Math.max(1, Math.round(st.d / 75))} min walk` : ""}</small></h4>${depRows(groupDepartures(st.sts), 4)}</div>`).join("");
    }
    return shortcuts + modeChips + tabs + content;
  },
};

/* ============================== Stop ============================== */

VIEWS.stop = {
  sheet: "half",
  enter(s) {
    mapFor({ pin: null });
    if (s.lon != null) map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 16), padding: padding(), duration: 700 });
    loadStop(s);
    clearInterval(s.timer);
    s.timer = setInterval(() => { if (screen() !== s) return clearInterval(s.timer); s["deps$"] = false; loadStop(s, true); }, 30000);
  },
  html(s) {
    const g = s.deps ? groupDepartures(s.deps.stopTimes) : [];
    const lines = [...new Map(g.map(x => [x.line.key, x.line])).values()].sort(compareLines);
    const d = me && s.lon != null ? metres(me, [s.lon, s.lat]) : null;
    return `<div class="head"><button class="icbtn" data-act="back" aria-label="Back">${icon("back")}</button>
        <div><b>${esc(s.name || s.deps?.place?.name || "Stop")}</b><span class="sub">${d != null ? `${distance(d)} away · ` : ""}${lines.length ? `${lines.length} lines` : "Stop"}</span></div>
        <button class="icbtn" data-act="dir-stop" aria-label="Directions to this stop">${icon("dir")}</button></div>
      ${lines.length ? `<div class="chips">${lines.map(l => `<button class="chip line" data-line="${esc(l.key)}">${badge(l, "sm")}${esc(l.longName ? l.longName.split(/\s*[-–]\s*/).pop() : classLabel(l.cls))}</button>`).join("")}</div>` : ""}
      <p class="eyebrow row">Next departures <span class="legend"><i class="rt"></i>live <i class="late"></i>late</span></p>
      ${s.depsErr ? failed(s.depsErr, "reload-stop") : !s.deps ? loading("Loading departures") : depRows(g)}
      ${s.deps?.nextPageCursor ? `<button class="btn tonal wide" data-act="more-deps">Later departures</button>` : ""}`;
  },
};
function loadStop(s, quiet) {
  if (!quiet) s.deps = null;
  load(s, "deps", async () => {
    const d = await api.departures({ stopId: s.id, n: 60 });
    if (s.lon == null && d.place) { s.lon = d.place.lon; s.lat = d.place.lat; map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 16), padding: padding() }); }
    return d;
  });
}

/* ============================== Line ============================== */

const stopOf = p => ({ name: p.name, key: p.parentId || p.stopId, id: p.stopId, lon: p.lon, lat: p.lat, tz: p.tz,
  time: p.departure || p.arrival, sched: p.scheduledDeparture || p.scheduledArrival, track: p.track });

VIEWS.line = {
  sheet: "half",
  enter(s) { mapFor({ focus: s.key }); loadLine(s); },
  html(s) {
    const l = registry.get(s.key);
    if (!l) return failed("unknown line");
    const d = s.data;
    const title = d ? `To ${d.stops[d.stops.length - 1].name}` : l.longName || `${classLabel(l.cls)} ${l.name}`;
    const head = `<div class="head">${badge(l, "big")}<div><b>${esc(title)}</b><span class="sub">${esc(classLabel(l.cls))}${d ? ` · ${d.stops.length} stops` : ""}${l.agency ? " · " + esc(l.agency) : ""}</span></div>
      <button class="icbtn" data-act="back" aria-label="Close line">${icon("close")}</button></div>`;
    if (s.dataErr) return head + failed(s.dataErr, "reload-line");
    if (!d) return head + loading("Loading the line");
    const pair = `<div class="pair" role="group" aria-label="Direction">
      <button aria-pressed="true">To ${esc(d.stops[d.stops.length - 1].name)}</button>
      <button data-act="reverse" aria-pressed="false"${s["rev$"] ? " disabled" : ""}>${s["rev$"] ? "Finding…" : `To ${esc(d.stops[0].name)}`}</button></div>`;
    const model = s.model;
    const anyMore = model.meet.some(m => m.length > 3);
    const first = d.stops[0], last = d.stops[d.stops.length - 1];
    const run = first.time && last.time ? (Date.parse(last.time) - Date.parse(first.time)) / 1000 : null;
    return head + pair + `
      <div class="diaghead"><span>${d.timed ? `Trip at ${clock(first.time, first.tz)}` : "Stops"}</span><span class="sp"></span>
        ${anyMore ? `<button class="linkbtn" data-act="expand-all">${s.expandAll ? "Fewer connections" : "All connections"}</button>` : ""}</div>
      ${diagramHtml(l, d.stops, model, { expandAll: s.expandAll, expanded: s.expanded, current: s.at })}
      <div class="summary">${run != null ? `<span class="k">Journey</span><b>${duration(run)}</b>` : ""}<span class="k">Stops</span><span>${d.stops.length}</span>
        ${d.timed ? `<span class="k">Times</span><span>${d.live ? "live" : "timetable"}</span>` : `<span class="k">Times</span><span>none for this line right now</span>`}</div>`;
  },
  after(s) { if (s.data && s.model) requestAnimationFrame(() => drawDiagram(registry.get(s.key), s.data.stops, s.model)); },
};

async function tripData(tripId) {
  const t = await api.trip(tripId);
  const leg = t.legs.find(l => l.tripId) || t.legs[0];
  const stops = [leg.from, ...(leg.intermediateStops || []), leg.to].map(stopOf);
  const now = Date.now();
  stops.forEach(x => { x.past = x.time && Date.parse(x.time) < now - 30000; x.rt = leg.realTime; x.late = x.sched && x.time && Date.parse(x.time) - Date.parse(x.sched) >= 60000; });
  return { stops, shape: shape(leg.legGeometry), timed: true, live: leg.realTime, tripId, headsign: leg.headsign, line: lineOfStopTime(leg) };
}

function loadLine(s) {
  s.expanded = s.expanded || new Set();
  load(s, "data", async () => {
    const l = registry.get(s.key);
    let d = null;
    if (s.tripId) d = await tripData(s.tripId);
    else {
      // From the map: take the line's longest route, then find its next trip from the first stop.
      const idx = [...l.routes][0];
      const rd = await api.routeDetails(idx);
      const r = rd.routes[0];
      const order = [r.segments[0].from, ...r.segments.map(x => x.to)];
      const rstops = order.map(i => rd.stops[i]);
      try {
        const deps = await api.departures({ stopId: rstops[0].stopId, n: 80 });
        const st = deps.stopTimes.find(x => lineOfStopTime(x) === l);
        if (st) { s.tripId = st.tripId; d = await tripData(st.tripId); }
      } catch { /* fall back to stops without times */ }
      if (!d) d = { stops: rstops.map(stopOf), shape: r.segments.flatMap(x => shape(rd.polylines[x.polyline]?.polyline)), timed: false };
    }
    s.model = diagramModel(l, d.stops, net);
    setOverlay("focus", { type: "FeatureCollection", features: [{ type: "Feature", properties: { c: colourOf(l) }, geometry: { type: "LineString", coordinates: d.shape.length > 1 ? d.shape : d.stops.map(x => [x.lon, x.lat]) } }] });
    frame(d.shape.length > 1 ? d.shape : d.stops.map(x => [x.lon, x.lat]), 15.5);
    return d;
  });
}

/** The other direction: the next trip of this line leaving from the far end. */
async function reverseLine(s) {
  const d = s.data, l = registry.get(s.key);
  if (!d || s["rev$"]) return;
  s["rev$"] = true; refresh(s);
  try {
    const last = d.stops[d.stops.length - 1];
    const deps = await api.departures({ stopId: last.key, n: 100 });
    const firstName = d.stops[0].name;
    const st = deps.stopTimes.find(x => lineOfStopTime(x) === l && (x.tripTo?.name === firstName || x.headsign === firstName))
      || deps.stopTimes.find(x => lineOfStopTime(x) === l && x.tripTo?.name !== last.name);
    if (!st) throw new Error("no trip back soon");
    s.tripId = st.tripId; s.data = null; s.at = null;
    s["rev$"] = false;
    loadLine(s);
  } catch (e) { s["rev$"] = false; toast(`Couldn't find the other direction (${e.message}).`); refresh(s); }
}

/* ============================== Lines under a tap ============================== */

VIEWS.pick = {
  sheet: "half",
  enter() { mapFor(); },
  html(s) {
    const ls = s.keys.map(k => registry.get(k)).filter(Boolean).sort(compareLines);
    return `<div class="head"><button class="icbtn" data-act="back" aria-label="Back">${icon("back")}</button><div><b>${ls.length} lines here</b><span class="sub">Pick one to follow</span></div><span></span></div>
      <div class="list">${ls.map(l => `<button class="item line" data-line="${esc(l.key)}">${badge(l)}<span><b>${esc(l.longName || `${classLabel(l.cls)} ${l.name}`)}</b><small>${esc(classLabel(l.cls))}</small></span>${icon("chev", "s")}</button>`).join("")}</div>`;
  },
};

/* ============================== Place ============================== */

VIEWS.place = {
  sheet: "half",
  enter(s) {
    mapFor({ pin: [s.lon, s.lat] });
    map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), padding: padding(), duration: 700 });
    load(s, "near", async () => {
      const d = await api.departures({ center: [s.lon, s.lat], radius: 500, n: 50 });
      const byStation = new Map();
      for (const st of d.stopTimes) { const k = st.place.parentId || st.place.stopId; if (!byStation.has(k)) byStation.set(k, { key: k, name: st.place.name, lon: st.place.lon, lat: st.place.lat, d: metres([s.lon, s.lat], [st.place.lon, st.place.lat]), sts: [] }); byStation.get(k).sts.push(st); }
      return [...byStation.values()].sort((a, b) => a.d - b.d).slice(0, 2);
    });
    if (s.needsName) load(s, "rev", async () => { const r = await api.reverse([s.lon, s.lat]); const a = r[0]; if (a) { s.name = a.name; s.sub = subOf(a); } return true; });
  },
  html(s) {
    const isSaved = saved().some(p => p.name === s.name && Math.abs(p.lon - s.lon) < 1e-5);
    const d = me ? metres(me, [s.lon, s.lat]) : null;
    return `<div class="placehead"><div><b>${esc(s.name)}</b><div class="sub">${esc(s.sub || "")}${d != null ? ` · ${distance(d)} away` : ""}</div></div>
        <button class="icbtn" data-act="back" aria-label="Close">${icon("close")}</button></div>
      <div class="actions"><button class="btn primary" data-act="dir-place">${icon("dir")}Directions</button>
        <button class="btn tonal icon" data-act="save-place" aria-label="${isSaved ? "Remove from saved" : "Save place"}" aria-pressed="${isSaved}">${icon("save")}</button>
        <button class="btn tonal icon" data-act="share" aria-label="Share">${icon("share")}</button></div>
      ${s.nearErr ? "" : !s.near ? loading("Finding stops nearby") : s.near.map(st => `<div class="nearstop"><h4><button class="linkish" data-stop="${esc(st.key)}" data-name="${esc(st.name)}" data-lon="${st.lon}" data-lat="${st.lat}">${esc(st.name)}${icon("chev", "s")}</button><small>${distance(st.d)} from here</small></h4>${depRows(groupDepartures(st.sts), 3)}</div>`).join("") || `<p class="muted pad">No public transport stops within 500 m.</p>`}`;
  },
};

/* ============================== Directions ============================== */

const T = { from: { me: true }, to: null, time: null, arriveBy: false, mode: "transit" };
const endName = e => e?.me ? (me ? "Your location" : "Map centre") : e?.name || "Choose…";
const endPos = e => e?.me ? here() : [e.lon, e.lat];

function tripCard() {
  return `<div class="tripcard"><button class="round" data-act="back" aria-label="Back">${icon("back")}</button>
    <div class="ends"><button class="end" data-act="pick-from"><span class="dot"></span><span>${esc(endName(T.from))}</span></button>
      <button class="end" data-act="pick-to"><span class="pinlet"></span><span>${esc(endName(T.to))}</span></button></div>
    <button class="round tonal" data-act="swap" aria-label="Swap start and destination">${icon("swap")}</button></div>`;
}

function planKey() { return JSON.stringify([endPos(T.from).map(v => v.toFixed(4)), T.to && endPos(T.to).map(v => v.toFixed(4)), T.time, T.arriveBy]); }
function loadPlan(s) {
  if (!T.to) return;
  const k = planKey();
  if (s.planKey === k && (s.plan || s["plan$"])) return;
  s.planKey = k; s.plan = null; s.planErr = null; s["plan$"] = false;
  load(s, "plan", () => api.plan({ from: endPos(T.from), to: endPos(T.to), time: T.time, arriveBy: T.arriveBy }));
}
const isDirect = (it, mode) => it.legs.every(l => l.mode === mode);
function options(s) {
  const p = s.plan; if (!p) return { transit: [], walk: [], bike: [] };
  const transit = p.itineraries.filter(it => it.legs.some(l => !["WALK", "BIKE"].includes(l.mode)));
  return { transit, walk: (p.direct || []).filter(it => isDirect(it, "WALK")), bike: (p.direct || []).filter(it => isDirect(it, "BIKE")) };
}
const lineOfLeg = leg => lineOfStopTime(leg);
function legChips(it) {
  return it.legs.filter(l => !(l.mode === "WALK" && l.duration < 60 && it.legs.length > 1)).map(l =>
    l.mode === "WALK" ? `<span class="walk">${icon("walk", "s")}${Math.round(l.duration / 60)}</span>`
      : l.mode === "BIKE" ? `<span class="walk">${icon("bike", "s")}${Math.round(l.duration / 60)}</span>` : badge(lineOfLeg(l), "sm")).join(`<span class="sep">${icon("chev", "xs")}</span>`);
}
function itinCard(it, i, tags) {
  const ride = it.legs.find(l => !["WALK", "BIKE"].includes(l.mode));
  const tz = it.legs[0].from.tz;
  const dist = it.legs.reduce((a, l) => a + (l.distance || 0), 0);
  return `<button class="route${tags ? "" : ""}" data-itin="${i}">
    <div class="r1"><b>${clock(it.startTime, tz)} – ${clock(it.endTime, tz)}</b>${tags || ""}<span class="dur">${duration(it.duration)}</span></div>
    <div class="legbar">${legChips(it)}</div>
    <div class="r3">${ride ? `${ride.realTime ? `<i class="dotlive"></i>` : ""}Leaves ${esc(ride.from.name)} at ${clock(ride.startTime, ride.from.tz)}${it.transfers ? ` · ${it.transfers} ${it.transfers === 1 ? "change" : "changes"}` : ""}` : `${distance(dist)}`}</div></button>`;
}

VIEWS.trip = {
  sheet: "half",
  enter(s) { s.planKey = null; loadPlan(s); showPlanOnMap(s); },
  html(s) {
    loadPlan(s);
    const o = options(s);
    const best = m => o[m].length ? duration(Math.min(...o[m].map(it => it.duration))) : s["plan$"] ? "…" : "–";
    const btn = (m, label, ic) => `<button data-trip-mode="${m}" aria-pressed="${T.mode === m}" aria-label="${label}">${icon(ic)}<small>${best(m)}</small></button>`;
    const when = T.time ? `${T.arriveBy ? "Arrive by" : "Depart"} ${new Date(T.time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "Leave now";
    let list;
    if (!T.to) list = `<p class="muted pad">Choose where you're going.</p>`;
    else if (s.planErr) list = failed(s.planErr, "reload-plan");
    else if (!s.plan) list = loading("Planning");
    else {
      const its = o[T.mode];
      if (!its.length) list = `<div class="empty">${icon("info")}<p>${T.mode === "transit" ? "No public transport connection found for this time." : `Too far to ${T.mode === "walk" ? "walk" : "cycle"}.`}</p></div>`;
      else {
        const fastest = Math.min(...its.map(it => it.duration)), fewest = Math.min(...its.map(it => it.transfers));
        list = its.map(it => itinCard(it, s.plan.itineraries.includes(it) ? `i${s.plan.itineraries.indexOf(it)}` : `d${s.plan.direct.indexOf(it)}`,
          (it.duration === fastest ? `<span class="tag">Fastest</span>` : "") + (T.mode === "transit" && it.transfers === fewest && fewest < its.find(x => x.duration === fastest).transfers ? `<span class="tag alt">Fewest changes</span>` : ""))).join("")
          + (T.mode === "transit" && s.plan.nextPageCursor ? `<button class="btn tonal wide" data-act="later"${s["later$"] ? " disabled" : ""}>${s["later$"] ? "Loading…" : "Later connections"}</button>` : "");
      }
    }
    return `<div class="modes" role="group" aria-label="How to travel">${btn("transit", "Public transport", "tram")}${btn("walk", "Walk", "walk")}${btn("bike", "Cycle", "bike")}</div>
      <div class="whenrow"><button class="when" data-act="when" aria-expanded="${!!s.whenOpen}">${icon("clock", "s")}${esc(when)}${icon("caret-down", "xs")}</button></div>
      ${s.whenOpen ? `<div class="whenbox"><div class="pair" role="group"><button data-when="now" aria-pressed="${!T.time}">Now</button><button data-when="dep" aria-pressed="${!!T.time && !T.arriveBy}">Depart at</button><button data-when="arr" aria-pressed="${!!T.time && T.arriveBy}">Arrive by</button></div>
        <input type="datetime-local" id="whenat" value="${toLocalInput(T.time ? new Date(T.time) : new Date())}" aria-label="Date and time"></div>` : ""}
      ${list}`;
  },
};
function toLocalInput(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function showPlanOnMap(s) {
  const pts = [endPos(T.from), T.to && endPos(T.to)].filter(Boolean);
  mapFor({ dim: true, pin: T.to ? endPos(T.to) : null });
  if (pts.length) frame(pts, 15);
}
function itinOf(s, id) { return id[0] === "i" ? s.plan.itineraries[+id.slice(1)] : s.plan.direct[+id.slice(1)]; }

function itinFeatures(it) {
  const f = [];
  for (const l of it.legs) {
    const coords = shape(l.legGeometry);
    if (coords.length < 2) continue;
    if (l.mode === "WALK" || l.mode === "BIKE") { f.push({ type: "Feature", properties: { k: l.mode === "WALK" ? "walk" : "bike" }, geometry: { type: "LineString", coordinates: coords } }); continue; }
    const c = colourOf(lineOfLeg(l));
    f.push({ type: "Feature", properties: { k: "ride", c }, geometry: { type: "LineString", coordinates: coords } });
    for (const p of l.intermediateStops || []) f.push({ type: "Feature", properties: { k: "stop", end: 0, c }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    for (const p of [l.from, l.to]) f.push({ type: "Feature", properties: { k: "stop", end: 1, c, name: p.name }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
  }
  return { type: "FeatureCollection", features: f };
}

VIEWS.itin = {
  sheet: "half",
  enter(s) {
    const fc = itinFeatures(s.it);
    mapFor({ dim: true, tripFc: fc, pin: T.to ? endPos(T.to) : null });
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
      const line = lineOfLeg(l), c = colourOf(line), mids = l.intermediateStops || [], open = s.open?.has(li);
      const late = l.realTime && Date.parse(l.startTime) - Date.parse(l.scheduledStartTime) >= 60000;
      rows += `<div class="tlrow stopr ride-top" style="--c:${c}"><span class="t${late ? " late" : l.realTime ? " rt" : ""}">${clock(l.startTime, l.from.tz)}</span><span class="rail"></span><div class="c">
          <b>${esc(l.from.name)}</b>${l.from.track ? `<small>Platform ${esc(l.from.track)}</small>` : ""}
          <button class="ride" data-line="${esc(line.key)}" data-trip="${esc(l.tripId)}" data-at="${esc(l.from.parentId || l.from.stopId)}">${badge(line)}<span>towards ${esc(l.headsign || l.tripTo?.name || "")}</span>${icon("chev", "s")}</button>
          <button class="linkbtn flush" data-open="${li}">${open ? "Hide stops" : `${mids.length + 1} ${mids.length ? "stops" : "stop"} · ${duration(l.duration)}`}</button></div></div>`;
      if (open) for (const p of mids) rows += `<div class="tlrow stopr small ride-mid mid" style="--c:${c}"><span class="t muted">${clock(p.departure || p.arrival, p.tz)}</span><span class="rail"></span><div class="c">${esc(p.name)}</div></div>`;
      else rows += `<div class="tlrow rideseg" style="--c:${c}"><span class="t"></span><span class="rail"></span><div class="c"></div></div>`;
      rows += `<div class="tlrow stopr ride-bottom" style="--c:${c}"><span class="t">${clock(l.endTime, l.to.tz)}</span><span class="rail"></span><div class="c"><b>${esc(l.to.name)}</b><small>Get off${l.to.track ? ` · platform ${esc(l.to.track)}` : ""}</small></div></div>`;
    });
    rows += `<div class="tlrow stopr walk-bottom"><span class="t">${clock(it.endTime, tz)}</span><span class="rail"></span><div class="c"><b>${esc(endName(T.to))}</b></div></div>`;
    return `<div class="head"><button class="icbtn" data-act="back" aria-label="Back to routes">${icon("back")}</button>
        <div><b>${duration(it.duration)} · arrive ${clock(it.endTime, tz)}</b><span class="sub">${it.transfers ? `${it.transfers} ${it.transfers === 1 ? "change" : "changes"}` : "No changes"}</span></div><span></span></div>
      <div class="legbar">${legChips(it)}</div><div class="tl">${rows}</div>`;
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
function resultItem(r, i, recent) {
  const ic = recent ? "recent" : r.type === "STOP" ? (r.modes?.some(m => classOf(m) === "train") ? "train" : r.modes?.includes("TRAM") ? "tram" : "bus") : r.type === "ADDRESS" ? "home" : "pin";
  const d = metres(here(), [r.lon, r.lat]);
  return `<button class="item" data-result="${i}" data-recent="${recent ? 1 : 0}"><span class="ico">${icon(ic)}</span><span><b>${esc(r.name)}</b><small>${esc(r.sub ?? subOf(r))}</small></span><span class="aside">${distance(d)}</span></button>`;
}
function searchPage(s) {
  const target = s.target === "from" ? "Start from" : s.target === "to" ? "Going to" : "";
  return `<div class="pagehead"><button class="round" data-act="back" aria-label="Back">${icon("back")}</button>
      <label class="searchfield">${icon("search", "s")}<input id="q" type="search" placeholder="${target ? esc(target) + "…" : "Places, addresses and stops"}" value="${esc(s.q || "")}" autocomplete="off" enterkeyhint="search"></label></div>
    <div class="pagebody" id="results">${searchResults(s)}</div>`;
}
function searchResults(s) {
  if (!s.q?.trim()) {
    const rec = store.get("recent", []);
    return (s.target ? `<div class="list"><button class="item" data-act="use-me"><span class="ico">${icon("loc-fix")}</span><span><b>Your location</b><small>${me ? "Found" : "Uses your location, or the map centre"}</small></span><span></span></button></div>` : "")
      + (saved().length ? `<p class="eyebrow">Saved</p><div class="list">${saved().map((p, i) => `<button class="item" data-savedpick="${i}"><span class="ico">${icon(p.icon || "save")}</span><span><b>${esc(p.name)}</b><small>${esc(p.sub || "")}</small></span><span></span></button>`).join("")}</div>` : "")
      + (rec.length ? `<p class="eyebrow">Recent</p><div class="list">${rec.map((r, i) => resultItem(r, i, true)).join("")}</div>` : `<p class="muted pad">Search for a street, a place or a stop anywhere Transitous covers.</p>`);
  }
  if (s.err) return failed(s.err);
  if (!s.results) return loading("Searching");
  if (!s.results.length) return `<div class="empty">${icon("search")}<p>Nothing found for “${esc(s.q)}”.</p></div>`;
  return `<div class="list">${s.results.map((r, i) => resultItem(r, i)).join("")}</div>`;
}
const runSearch = debounce(async s => {
  const q = s.q?.trim(); if (!q) return;
  const mine = (s.seq = (s.seq || 0) + 1);
  try {
    const r = await api.geocode(q, here());
    if (mine !== s.seq) return;
    // Nearby first (within 80 km), otherwise in the order the search ranked them.
    const h = here();
    s.results = r.map((x, i) => ({ x, i, far: metres(h, [x.lon, x.lat]) > 80000 })).sort((a, b) => a.far - b.far || a.i - b.i).map(o => o.x);
    s.err = null;
  }
  catch (e) { if (mine !== s.seq) return; s.err = e.message; }
  if (cur() === s) $("#results").innerHTML = searchResults(s);
}, 220);
function chooseResult(r, s) {
  const rec = store.get("recent", []).filter(x => !(x.name === r.name && Math.abs(x.lat - r.lat) < 1e-5));
  rec.unshift({ type: r.type, name: r.name, id: r.id, lat: r.lat, lon: r.lon, sub: r.sub ?? subOf(r), modes: r.modes });
  store.set("recent", rec.slice(0, 8));
  const place = { name: r.name, sub: r.sub ?? subOf(r), lon: r.lon, lat: r.lat };
  if (s.target) { T[s.target] = place; stack.pop(); shownScreen = null; return render(true); }
  stack.pop();
  if (r.type === "STOP") go({ t: "stop", id: r.id, name: r.name, lon: r.lon, lat: r.lat });
  else go({ t: "place", ...place });
}

/* ============================== Settings ============================== */

function settingsPage() {
  const sw = (on, attr, title, sub) => `<div class="setrow"><span><b>${title}</b><small>${sub}</small></span><button class="switch" role="switch" aria-checked="${on}" ${attr} aria-label="${title}"></button></div>`;
  return `<div class="pagehead"><button class="round" data-act="back" aria-label="Back">${icon("back")}</button><h2>Settings</h2></div>
    <div class="pagebody">
      <p class="eyebrow">Appearance</p>
      <div class="pair" role="group" aria-label="Theme">${["system", "light", "dark"].map(t => `<button data-theme-set="${t}" aria-pressed="${settings.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
      <p class="eyebrow">Map</p>
      <div class="setgroup">${sw(settings.spread, 'data-set="spread"', "Lines side by side", "Lines sharing a street or track are drawn next to each other")}
        ${CLASSES.map(c => sw(net.enabled.has(c.id), `data-mode="${c.id}"`, c.label, "Show on the map and in departures")).join("")}</div>
      <p class="eyebrow">Your data</p>
      <div class="setgroup"><button class="setrow" data-act="clear-recent"><span><b>Clear recent searches</b><small>Saved in this browser only</small></span>${icon("chev", "s")}</button></div>
      <p class="eyebrow">About</p>
      <div class="setgroup"><div class="setrow"><span><b>Wayfinder</b><small>Public transport on an open map. Timetables, live times and routing from <a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>; map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, drawn with <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>.</small></span></div></div>
    </div>`;
}

/* ============================== Events ============================== */

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3800);
}

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act],[data-line],[data-stop],[data-tab],[data-mode],[data-trip-mode],[data-itin],[data-open],[data-more],[data-less],[data-result],[data-saved],[data-savedpick],[data-when],[data-set],[data-theme-set]");
  if (!el || el.disabled) return;
  const d = el.dataset, s = screen();
  if (d.more) { s.expanded.add(d.more); return refresh(s); }
  if (d.less) { s.expanded.delete(d.less); return refresh(s); }
  switch (d.act) {
    case "search": return go({ t: "search", q: "" });
    case "settings": return go({ t: "settings" });
    case "back": return back();
    case "reload-deps": return loadNearby(s, true);
    case "reload-stop": return loadStop(s);
    case "reload-line": s.dataErr = null; return loadLine(s);
    case "reload-plan": s.planKey = null; return refresh(s);
    case "more-deps": {
      const c = s.deps?.nextPageCursor; if (!c) return;
      try { const more = await api.departures({ stopId: s.id, n: 60, pageCursor: c }); s.deps = { ...more, stopTimes: [...s.deps.stopTimes, ...more.stopTimes] }; refresh(s); } catch (err) { toast(err.message); }
      return;
    }
    case "expand-all": s.expandAll = !s.expandAll; return refresh(s);
    case "reverse": return reverseLine(s);
    case "dir-stop": T.to = { name: s.name || s.deps?.place?.name, sub: "Stop", lon: s.lon, lat: s.lat }; T.mode = "transit"; return go({ t: "trip" });
    case "dir-place": T.to = { name: s.name, sub: s.sub, lon: s.lon, lat: s.lat }; T.mode = "transit"; return go({ t: "trip" });
    case "save-place": {
      let list = saved(); const i = list.findIndex(p => p.name === s.name && Math.abs(p.lon - s.lon) < 1e-5);
      if (i >= 0) list.splice(i, 1); else list = [...list, { name: s.name, sub: s.sub, lon: s.lon, lat: s.lat, icon: "save" }];
      store.set("saved", list); toast(i >= 0 ? "Removed from saved places." : "Saved. It's on the start screen now."); return refresh(s);
    }
    case "share": {
      const url = `${location.origin}${location.pathname}#map=17/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}`;
      try { if (navigator.share) await navigator.share({ title: s.name, url }); else { await navigator.clipboard.writeText(url); toast("Link copied."); } } catch { /* cancelled */ }
      return;
    }
    case "pick-from": return go({ t: "search", q: "", target: "from" });
    case "pick-to": return go({ t: "search", q: "", target: "to" });
    case "swap": if (T.to) { [T.from, T.to] = [T.to, T.from]; } shownScreen = null; return render(true);
    case "use-me": T[cur().target] = { me: true }; stack.pop(); shownScreen = null; return render(true);
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
  if (d.tab) { s.tab = d.tab; return render(); }
  if (d.mode) {
    net.enabled.has(d.mode) ? net.enabled.delete(d.mode) : net.enabled.add(d.mode);
    if (!net.enabled.size) net.enabled.add(d.mode);
    settings.modes = [...net.enabled]; saveSettings(); net.render();
    if (cur().t === "settings") $("#page").innerHTML = settingsPage();
    return render();
  }
  if (d.set === "spread") { settings.spread = net.spread = !settings.spread; saveSettings(); net.render(); $("#page").innerHTML = settingsPage(); return; }
  if (d.themeSet) { settings.theme = d.themeSet; saveSettings(); applyTheme(); $("#page").innerHTML = settingsPage(); return; }
  if (d.tripMode) { T.mode = d.tripMode; return refresh(s); }
  if (d.when) {
    if (d.when === "now") { T.time = null; T.arriveBy = false; s.whenOpen = false; }
    else { const v = $("#whenat").value; T.time = v ? new Date(v).toISOString() : new Date().toISOString(); T.arriveBy = d.when === "arr"; }
    return refresh(s);
  }
  if (d.itin) { const it = itinOf(s, d.itin); return go({ t: "itin", it, open: new Set() }); }
  if (d.open !== undefined) { const k = +d.open; s.open.has(k) ? s.open.delete(k) : s.open.add(k); return refresh(s); }
  if (d.result !== undefined) {
    const c = cur(), r = d.recent === "1" ? store.get("recent", [])[+d.result] : c.results[+d.result];
    return r && chooseResult(r, c);
  }
  if (d.savedpick !== undefined) { const p = saved()[+d.savedpick]; return chooseResult({ type: "PLACE", ...p }, cur()); }
  if (d.saved !== undefined) { const p = saved()[+d.saved]; T.to = { ...p }; T.mode = "transit"; return go({ t: "trip" }); }
  if (d.line) {
    if (!registry.get(d.line)) return;
    if (s.t === "line" && s.key === d.line && !d.trip) return;
    return go({ t: "line", key: d.line, tripId: d.trip || null, at: d.at || null });
  }
  if (d.stop) return go({ t: "stop", id: d.stop, name: d.name, lon: d.lon ? +d.lon : null, lat: d.lat ? +d.lat : null });
});

document.addEventListener("input", e => {
  if (e.target.id === "q") { const s = cur(); s.q = e.target.value; s.results = null; s.err = null; $("#results").innerHTML = s.q.trim() ? searchResults(s) : searchResults(s); runSearch(s); }
});
document.addEventListener("change", e => {
  if (e.target.id === "whenat" && T.time) { T.time = new Date(e.target.value).toISOString(); refresh(screen()); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && stack.length > 1) { e.preventDefault(); back(); }
  const row = e.target.closest?.(".srow");
  if (row && (e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); }
  if (e.key === "Enter" && e.target.id === "q") { const s = cur(); if (s.results?.[0]) chooseResult(s.results[0], s); }
});

$("#locate").addEventListener("click", () => locate(true));

// Map taps: a station opens its departures, a line opens the line (or a choice of lines).
map.on("click", e => {
  const p = e.point, box = [[p.x - 7, p.y - 7], [p.x + 7, p.y + 7]];
  const st = map.queryRenderedFeatures(box, { layers: ["stations"] });
  if (st.length) { const f = st[0]; return go({ t: "stop", id: f.properties.key, name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }); }
  const keys = [...new Set(map.queryRenderedFeatures(box, { layers: ["net-hit"] }).flatMap(f => String(f.properties.lines || f.properties.line).split("\n")))];
  if (keys.length === 1) return go({ t: "line", key: keys[0] });
  if (keys.length > 1) return go({ t: "pick", keys });
});
// Long press / right click anywhere: a place you can get directions to.
map.on("contextmenu", e => go({ t: "place", name: "Dropped pin", sub: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`, lon: e.lngLat.lng, lat: e.lngLat.lat, needsName: true }));
map.on("mousemove", e => {
  const p = e.point, box = [[p.x - 7, p.y - 7], [p.x + 7, p.y + 7]];
  map.getCanvas().style.cursor = map.getLayer("stations") && map.queryRenderedFeatures(box, { layers: ["stations", "net-hit"] }).length ? "pointer" : "";
});

render(true);

// For poking around in the browser console: wayfinder.map, wayfinder.net, wayfinder.stack …
window.wayfinder = { map, net, registry, get stack() { return stack; }, T, settings };
