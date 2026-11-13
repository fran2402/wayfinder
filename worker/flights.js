// Wayfinder flights relay — a Cloudflare Worker (free plan).
//
// The site can't call the flight feeds from the browser (they don't allow it), so this tiny relay does:
//   GET /airport?lat=41.30&lon=2.08&iata=BCN&icao=LEBL  → live departures and arrivals around an airport
//   GET /near?lat=41.30&lon=2.08&dist=40               → aircraft near a point (for planes on the map)
//   GET /schedule?iata=BCN&dir=departures              → today's whole board: times, gates, terminals, status
//   GET /track?hex=34324e  or  /track?cs=IBE0689        → one aircraft, live, with its route (for tracking)
//   GET /ships?w=13&s=44&e=14&n=45                       → boats in an area (AIS via aisstream.io; secret AISSTREAM_KEY)
// Data: aircraft positions from adsb.lol (free, ODbL), routes from adsbdb.com (free), no keys needed.
// The day's schedule comes from AeroDataBox and needs a key: in the Worker's Settings → Variables and Secrets,
// add a secret AERODATABOX_KEY (your RapidAPI key). Without it /schedule answers 501 and the site shows live flights only.

const ALLOW = ["https://fran2402.github.io", "http://localhost:8765"];
const MAX_ROUTE_LOOKUPS = 40; // the free plan allows 50 outgoing requests per call

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const cors = { "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0], "Vary": "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const send = (data, status = 200, maxAge = 20) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json", "cache-control": `public, max-age=${maxAge}` } });
    const num = (k, lo, hi) => { const v = parseFloat(url.searchParams.get(k)); if (!isFinite(v) || v < lo || v > hi) throw new Error("bad " + k); return v; };
    try {
      if (url.pathname === "/near") {
        const lat = num("lat", -90, 90), lon = num("lon", -180, 180), dist = Math.min(100, num("dist", 1, 250));
        const ac = await aircraft(lat, lon, dist, ctx);
        return send({ at: Date.now(), aircraft: ac.map(slim) }, 200, 10);
      }
      if (url.pathname === "/track") {
        const hex = (url.searchParams.get("hex") || "").toLowerCase(), cs = (url.searchParams.get("cs") || "").toUpperCase().replace(/\s+/g, "");
        if (!/^[0-9a-f]{6}$/.test(hex) && !/^[A-Z0-9]{2,8}$/.test(cs)) throw new Error("need hex or cs");
        const d = await cachedJson(hex ? `https://api.adsb.lol/v2/hex/${hex}` : `https://api.adsb.lol/v2/callsign/${cs}`, 4, ctx);
        const a = (d?.ac || []).find(x => x.lat != null);
        if (!a) return send({ at: Date.now(), aircraft: null }, 200, 4);
        const r = a.flight ? await route(a.flight.trim(), ctx).catch(() => null) : null;
        const place = ap => ap && { iata: ap.iata_code, icao: ap.icao_code, city: ap.municipality, name: ap.name, lat: ap.latitude, lon: ap.longitude };
        return send({ at: Date.now(), aircraft: slim(a), route: r && { flight: r.callsign_iata || r.callsign, airline: r.airline?.name || null, from: place(r.origin), to: place(r.destination) } }, 200, 4);
      }
      if (url.pathname === "/ships") {
        if (!env.AISSTREAM_KEY) return send({ error: "no AIS key" }, 501, 300);
        const box = ["w", "s", "e", "n"].map(k => num(k, -180, 180));
        if (box[2] - box[0] > 6 || box[3] - box[1] > 4) return send({ ships: [], note: "zoom in" }, 200, 30);
        return send(await ships(box, env, ctx), 200, 20);
      }
      if (url.pathname === "/schedule") {
        if (!env.AERODATABOX_KEY) return send({ error: "no schedule key" }, 501, 300);
        const code = (url.searchParams.get("iata") || url.searchParams.get("icao") || "").toUpperCase();
        const kind = url.searchParams.get("iata") ? "iata" : "icao";
        if (!/^[A-Z0-9]{3,4}$/.test(code)) throw new Error("bad airport code");
        const dir = url.searchParams.get("dir") === "arrivals" ? "arrivals" : "departures";
        return send(await schedule(kind, code, dir, env, ctx), 200, 300);
      }
      if (url.pathname === "/airport") {
        const lat = num("lat", -90, 90), lon = num("lon", -180, 180);
        const iata = (url.searchParams.get("iata") || "").toUpperCase(), icao = (url.searchParams.get("icao") || "").toUpperCase();
        if (!iata && !icao) throw new Error("need iata or icao");
        return send(await board(lat, lon, iata, icao, ctx), 200, 20);
      }
      return send({ error: "not found" }, 404, 0);
    } catch (e) {
      return send({ error: String(e.message || e) }, 400, 0);
    }
  },
};

/** An aircraft, slimmed to what the map shows. */
const slim = a => ({ hex: a.hex, flight: (a.flight || "").trim(), type: a.t || null, reg: a.r || null, desc: a.desc || null, lat: a.lat, lon: a.lon, track: a.track ?? a.true_heading ?? null,
  alt: a.alt_baro, gs: a.gs ?? null, vs: a.baro_rate ?? a.geom_rate ?? null, squawk: a.squawk || null, cat: a.category || null });

/** Aircraft within `dist` nautical miles, from adsb.lol (cached 10 s). */
async function aircraft(lat, lon, dist, ctx) {
  const u = `https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.round(dist)}`;
  const data = await cachedJson(u, 10, ctx);
  return (data?.ac || []).filter(a => a.lat != null);
}

/** A callsign's route from adsbdb (cached 12 h, also when unknown). */
async function route(callsign, ctx) {
  const data = await cachedJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, 43200, ctx, true);
  const r = data?.response;
  return typeof r === "object" && r?.flightroute ? r.flightroute : null;
}

async function cachedJson(u, seconds, ctx, okIf404 = false) {
  const cache = caches.default, key = new Request(u);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const res = await fetch(u, { headers: { "User-Agent": "Wayfinder flights relay" } });
  if (!res.ok && !(okIf404 && res.status === 404)) throw new Error(`upstream ${res.status}`);
  const text = res.ok ? await res.text() : "null";
  ctx.waitUntil(cache.put(key, new Response(text, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${seconds}` } })));
  return JSON.parse(text);
}

/** Departures and arrivals happening now: aircraft near the airport whose route starts or ends there. */
async function board(lat, lon, iata, icao, ctx) {
  const near = (await aircraft(lat, lon, 60, ctx)).filter(a => (a.flight || "").trim()).sort((a, b) => (a.dst ?? 999) - (b.dst ?? 999)).slice(0, MAX_ROUTE_LOOKUPS);
  const routes = await Promise.all(near.map(a => route(a.flight.trim(), ctx).catch(() => null)));
  const here = ap => ap && ((iata && ap.iata_code === iata) || (icao && ap.icao_code === icao));
  const place = ap => ap && { iata: ap.iata_code, icao: ap.icao_code, city: ap.municipality, name: ap.name, country: ap.country_iso_name };
  const departures = [], arrivals = [];
  near.forEach((a, i) => {
    const r = routes[i];
    if (!r) return;
    const dep = here(r.origin), arr = here(r.destination);
    if (!dep && !arr) return;
    const ground = a.alt_baro === "ground", alt = ground ? 0 : a.alt_baro, km = (a.dst ?? 0) * 1.852, vs = a.baro_rate ?? a.geom_rate ?? 0;
    const row = {
      flight: r.callsign_iata || r.callsign, callsign: r.callsign_icao || r.callsign, airline: r.airline?.name || null,
      from: place(r.origin), to: place(r.destination), type: a.t || null, reg: a.r || null,
      alt, gs: a.gs ?? null, vs, km: Math.round(km * 10) / 10, lat: a.lat, lon: a.lon, track: a.track ?? null,
    };
    if (dep) {
      row.status = ground ? (a.gs > 40 ? "Taking off" : "Taxiing") : alt < 10000 && vs > 300 ? "Departed" : "En route";
      departures.push(row);
    } else {
      row.status = ground ? "Landed" : km < 15 && alt < 4000 ? "Landing" : "Approaching";
      if (!ground && a.gs > 80) row.etaMin = Math.max(1, Math.round(km / (a.gs * 1.852) * 60));
      arrivals.push(row);
    }
  });
  departures.sort((a, b) => a.km - b.km);
  arrivals.sort((a, b) => (a.status === "Landed") - (b.status === "Landed") || a.km - b.km);
  return { at: Date.now(), airport: { iata, icao }, departures, arrivals, sources: ["adsb.lol (ODbL)", "adsbdb.com"] };
}

/* ============================== The day's schedule (AeroDataBox) ============================== */

const ADB = env => ({ host: env.AERODATABOX_HOST || "aerodatabox.p.rapidapi.com", key: env.AERODATABOX_KEY });
async function adb(env, path, seconds, ctx) {
  const { host, key } = ADB(env);
  const u = `https://${host}${path}`, cache = caches.default, ck = new Request("https://adb.cache" + path);
  const hit = await cache.match(ck);
  if (hit) return hit.json();
  const res = await fetch(u, { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host, "x-magicapi-key": key } });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`schedule source ${res.status}`);
  const text = await res.text();
  ctx.waitUntil(cache.put(ck, new Response(text, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${seconds}` } })));
  return JSON.parse(text);
}

/** Today (in the airport's own time zone), 00:00–24:00, in two 12-hour requests; cached 10 minutes. */
async function schedule(kind, code, dir, env, ctx) {
  const info = await adb(env, `/airports/${kind}/${code}`, 30 * 86400, ctx);
  const tz = info?.timeZone || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const opts = `?withLeg=true&direction=${dir === "departures" ? "Departure" : "Arrival"}&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
  const halves = await Promise.all([[`${today}T00:00`, `${today}T11:59`], [`${today}T12:00`, `${today}T23:59`]]
    .map(([a, b]) => adb(env, `/flights/airports/${kind}/${code}/${a}/${b}${opts}`, 600, ctx)));
  const list = halves.flatMap(h => h?.[dir] || []);
  const flights = list.map(f => {
    // With withLeg the flight has departure and arrival legs; without, "movement" is the other airport.
    const mine = dir === "departures" ? f.departure : f.arrival, other = dir === "departures" ? f.arrival : f.departure;
    const at = mine || f.movement || {}, far = (other || f.movement || {}).airport || {};
    const sched = at.scheduledTime?.local || at.scheduledTimeLocal, revised = at.revisedTime?.local || at.actualTime?.local || null;
    const hm = t => t ? t.slice(11, 16) : null;
    const late = sched && revised ? Math.round((Date.parse(revised.replace(" ", "T")) - Date.parse(sched.replace(" ", "T"))) / 60000) : 0;
    return {
      time: hm(sched), revised: hm(revised), late: isFinite(late) ? late : 0, sort: sched || "",
      flight: (f.number || "").replace(/\s+/g, ""), airline: f.airline?.name || null,
      city: far.municipalityName || far.shortName || far.name || null, code: far.iata || far.icao || null, country: far.countryCode || null,
      gate: at.gate || null, terminal: at.terminal || null, checkIn: at.checkInDesk || null, belt: at.baggageBelt || null,
      status: f.status || "Unknown", aircraft: f.aircraft?.model || null, reg: f.aircraft?.reg || null,
    };
  }).filter(f => f.time).sort((a, b) => a.sort.localeCompare(b.sort));
  return { at: Date.now(), date: today, tz, airport: { code, name: info?.shortName || info?.fullName || null, country: info?.country?.code || null }, dir, flights };
}

/* ============================== Boats (aisstream.io) ============================== */

// AIS from aisstream.io (free; the key is the Worker secret AISSTREAM_KEY). Each request listens for a
// few seconds to the area (in 1° cells), and what was heard is kept per cell for 15 minutes — ships at
// anchor or moored only report every few minutes, so they add up over successive requests.
async function ships([w, s, e, n], env, ctx) {
  const cells = [];
  for (let x = Math.floor(w); x <= Math.floor(e); x++) for (let y = Math.floor(s); y <= Math.floor(n); y++) cells.push([x, y]);
  const cache = caches.default, key = ([x, y]) => new Request(`https://ais.cache/${x}/${y}`);
  const known = new Map();
  let fresh = true;
  for (const c of cells) {
    const hit = await cache.match(key(c));
    if (!hit) { fresh = false; continue; }
    const d = await hit.json();
    if (Date.now() - d.at > 40000) fresh = false;
    for (const x of d.ships) if (Date.now() - x.at < 15 * 60000) known.set(x.mmsi, x);
  }
  if (!fresh) {
    for (const x of await listen([w, s, e, n], env.AISSTREAM_KEY, 7000)) known.set(x.mmsi, { ...known.get(x.mmsi), ...x });
    // Keep what's known per cell.
    for (const c of cells) {
      const mine = [...known.values()].filter(x => Math.floor(x.lon) === c[0] && Math.floor(x.lat) === c[1]);
      ctx.waitUntil(cache.put(key(c), new Response(JSON.stringify({ at: Date.now(), ships: mine }), { headers: { "cache-control": "public, max-age=900" } })));
    }
  }
  return { at: Date.now(), ships: [...known.values()].filter(x => x.lon >= w && x.lon <= e && x.lat >= s && x.lat <= n) };
}

/** Listen to aisstream.io for `ms` milliseconds; the ships heard, latest report each. */
async function listen([w, s, e, n], key, ms) {
  const res = await fetch("https://stream.aisstream.io/v0/stream", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error("aisstream: no connection");
  ws.accept();
  ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[s, w], [n, e]]],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"] }));
  const out = new Map();
  await new Promise(resolve => {
    const done = () => { try { ws.close(); } catch {} resolve(); };
    setTimeout(done, ms);
    ws.addEventListener("close", resolve);
    ws.addEventListener("error", resolve);
    ws.addEventListener("message", ev => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)); } catch { return; }
      const md = m.MetaData || {}, mmsi = md.MMSI;
      if (!mmsi) return;
      const x = out.get(mmsi) || { mmsi };
      x.name = (md.ShipName || x.name || "").trim() || x.name; x.lat = md.latitude ?? x.lat; x.lon = md.longitude ?? x.lon; x.at = Date.now();
      const msg = m.Message || {};
      const pr = msg.PositionReport || msg.StandardClassBPositionReport || msg.ExtendedClassBPositionReport;
      if (pr) { x.sog = pr.Sog; x.cog = pr.Cog; x.heading = pr.TrueHeading === 511 ? null : pr.TrueHeading; if (pr.NavigationalStatus != null) x.status = pr.NavigationalStatus; if (pr.Type) x.type ??= pr.Type; }
      const sd = msg.ShipStaticData;
      if (sd) { x.type = sd.Type; x.dest = (sd.Destination || "").trim() || null; x.callsign = (sd.CallSign || "").trim() || null; x.imo = sd.ImoNumber || null;
        x.draught = sd.MaximumStaticDraught || null; const d = sd.Dimension; if (d) { x.length = d.A + d.B; x.width = d.C + d.D; } }
      const st = msg.StaticDataReport;
      if (st?.ReportB) { x.type = st.ReportB.ShipType ?? x.type; x.callsign = (st.ReportB.CallSign || "").trim() || x.callsign; }
      out.set(mmsi, x);
    });
  });
  return [...out.values()].filter(x => x.lat != null);
}
