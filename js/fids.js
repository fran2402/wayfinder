// The airport board, drawn like a split-flap flight information display: a flap per character,
// times in yellow when late and red when cancelled, a status light per flight, the gate.
// Today's schedule when the relay has a schedule key; otherwise the flights moving right now.

import { esc } from "./util.js";

const SIZES = { small: { flight: 7, place: 9, gate: 3 }, big: { flight: 7, place: 15, gate: 3 } };

/** A run of flaps, padded with blank flaps to `n`. */
function flaps(str, n, cls = "") {
  const chars = [...String(str ?? "").toUpperCase()].slice(0, n);
  while (chars.length < n) chars.push(" ");
  return `<span class="fl ${cls}">${chars.map(c => `<i${c === " " ? ' class="e"' : ""}>${c === " " ? "" : esc(c)}</i>`).join("")}</span>`;
}

const RED = /cancel|divert/i;
/** The light: green on time, amber late (or boarding, gate closing), red cancelled or diverted. */
function light(f) {
  if (RED.test(f.status)) return "red";
  if (f.late >= 15 || /delay|gateclosed|boarding|landing|taking off/i.test(f.status)) return "amber";
  return "green";
}
const STATUS_TEXT = { EnRoute: "In the air", CheckIn: "Check-in open", GateClosed: "Gate closed", CanceledUncertain: "Cancelled?", Canceled: "Cancelled", Expected: "On time", Unknown: "Scheduled" };
const statusText = f => (STATUS_TEXT[f.status] || f.status.replace(/([a-z])([A-Z])/g, "$1 $2")) + (f.late >= 5 && !RED.test(f.status) ? ` · ${f.late} min late` : "");

/** Flights moving now (relay /airport) in the board's shape. */
export function liveRows(board, dep) {
  const list = board?.[dep ? "departures" : "arrivals"] || [];
  const now = new Date();
  return list.map(f => {
    const far = (dep ? f.to : f.from) || {};
    const eta = f.etaMin ? new Date(now.getTime() + f.etaMin * 60000) : null;
    return {
      time: eta ? `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}` : null, late: 0,
      flight: f.flight, airline: f.airline, city: far.city || far.name, code: far.iata || far.icao, gate: null, terminal: null,
      status: f.status + (f.alt > 0 && !f.etaMin ? ` · ${Math.round(f.alt / 100) * 100} ft` : ""), aircraft: f.type, live: true,
    };
  });
}

/** The board. `rows`: flights; `meta`: { dir, code, name, country, mode: "day" | "live", note, open }. */
export function boardHtml(rows, meta, size = "small") {
  const Z = SIZES[size], dep = meta.dir === "departures";
  const hhmm = clockAt(meta.tz);
  const flag = meta.country ? `<img class="fflag" src="https://flagcdn.com/w40/${meta.country.toLowerCase()}.png" alt="${esc(meta.country)}" width="30" height="20" loading="lazy" onerror="this.remove()">` : "";
  const head = `<div class="fhead2">
      <div class="ftitle"><span class="fico"><svg viewBox="0 0 24 24"><path d="${dep ? "M2.5 19h19M3.6 12.6l3.2 3.1c.5.5 1.2.6 1.8.3l12.3-6.4c1-.5 1.4-1.8.8-2.8-.5-.9-1.6-1.3-2.6-.8l-4.3 2.2-6.4-3.3-2 1 4.4 3.9-3 1.6-2.4-1.3-1.8.9z" : "M2.5 19h19M5.4 7.2l-.1 4.8c0 .7.4 1.3 1 1.6l12.6 4.3c1.1.4 2.3-.2 2.6-1.3.3-1-.2-2.1-1.2-2.5l-4.6-1.6-2.5-6.9-2.2-.7.4 5.9-3.2-1.1-.8-2.6z"}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg></span>${dep ? "Departures" : "Arrivals"}</div>
      <div class="finfo"><b>${dep ? "DEPARTURE" : "ARRIVAL"} INFORMATION</b><span>(${esc(meta.code || "")}) ${esc(meta.name || "")}</span><span>${meta.mode === "day" ? "Today" : "Moving now"} · ${hhmm}</span></div>${flag}</div>`;
  const cols = `<div class="frow fcols"><span>Time</span><span>Flight Number</span><span>${dep ? "Destination" : "Origin"}</span><span>Gate</span><span>Status</span><span></span></div>`;
  const body = !rows ? `<p class="fnote2">${meta.note || "Loading flights…"}</p>`
    : !rows.length ? `<p class="fnote2">${meta.note || `No ${dep ? "departures" : "arrivals"} right now.`}</p>`
    : rows.map((f, i) => {
      const lt = light(f), tcls = lt === "red" ? "red" : lt === "amber" && f.late >= 15 ? "amber" : "";
      const open = meta.open === i;
      const details = open ? `<div class="fdet">
          <div><small>Status</small><b>${esc(statusText(f))}</b></div>
          ${f.revised && f.revised !== f.time ? `<div><small>${dep ? "Expected departure" : "Expected arrival"}</small><b>${esc(f.revised)}</b></div>` : ""}
          ${f.terminal ? `<div><small>Terminal</small><b>${esc(f.terminal)}</b></div>` : ""}
          ${f.gate ? `<div><small>Gate</small><b>${esc(f.gate)}</b></div>` : ""}
          ${f.checkIn ? `<div><small>Check-in</small><b>${esc(f.checkIn)}</b></div>` : ""}
          ${f.belt ? `<div><small>Baggage belt</small><b>${esc(f.belt)}</b></div>` : ""}
          ${f.airline ? `<div><small>Airline</small><b>${esc(f.airline)}</b></div>` : ""}
          ${f.aircraft ? `<div><small>Aircraft</small><b>${esc(f.aircraft)}</b></div>` : ""}
          <div><small>${dep ? "To" : "From"}</small><b>${esc([f.city, f.code].filter(Boolean).join(" · ") || "—")}</b></div></div>` : "";
      return `<button class="frow${open ? " open" : ""}${f.past ? " past" : ""}" data-fids="${i}"${f.next ? ' data-next="1"' : ""}>
        ${flaps((f.time || "").replace(":", ""), 4, tcls)}${flaps(f.flight, Z.flight)}${flaps(f.city || f.code || "", Z.place)}${flaps(f.gate || (meta.mode === "day" ? "" : "---"), Z.gate)}
        <span class="flight ${lt}"></span><span class="fchev">›</span></button>${details}`;
    }).join("");
  return `<div class="fids ${size}">${head}${cols}<div class="fbody">${body}</div>${meta.foot ? `<p class="ffoot">${meta.foot}</p>` : ""}</div>`;
}

/** Mark which flights are past and which is next (to scroll to). */
export function markNow(rows, tz) {
  if (!rows?.length || rows[0].live) return rows;
  const [ch, cm] = clockAt(tz).split(":").map(Number), cur = ch * 60 + cm;
  let nextSet = false;
  for (const f of rows) {
    const [h, m] = (f.revised || f.time || "00:00").split(":").map(Number);
    f.past = h * 60 + m < cur - 10 && !/delay|boarding/i.test(f.status);
    f.next = !f.past && !nextSet; if (f.next) nextSet = true;
  }
  return rows;
}

/** The time now at the airport ("HH:MM"), or here when its time zone isn't known. */
export function clockAt(tz) {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()); }
  catch { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
}
