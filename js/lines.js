// What a line is, how it is named and coloured, and how its badge looks.

import { esc, hash } from "./util.js";

/** Transitous modes grouped the way people think of them. Coaches are left out. */
const CLASS_OF = {
  HIGHSPEED_RAIL: "train", LONG_DISTANCE: "train", NIGHT_RAIL: "train", REGIONAL_FAST_RAIL: "train", REGIONAL_RAIL: "train",
  SUBURBAN: "train", RAIL: "train", SUBWAY: "metro", METRO: "metro", TRAM: "tram", BUS: "bus", FERRY: "ferry",
  FUNICULAR: "other", AERIAL_LIFT: "other", AREAL_LIFT: "other", CABLE_CAR: "other", OTHER: "other",
};
export const classOf = mode => CLASS_OF[mode] || null;

export const CLASSES = [
  { id: "train", label: "Trains", icon: "train" },
  { id: "metro", label: "Metro", icon: "metro" },
  { id: "tram", label: "Trams", icon: "tram" },
  { id: "bus", label: "Buses", icon: "bus" },
  { id: "ferry", label: "Ferries", icon: "ferry" },
  { id: "other", label: "Cable cars", icon: "cable" },
];
export const CLASS_ORDER = Object.fromEntries(CLASSES.map((c, i) => [c.id, i]));
export const classLabel = id => ({ train: "Train", metro: "Metro", tram: "Tram", bus: "Bus", ferry: "Ferry", other: "Cable car" })[id] || "";

/** Relative line widths on the map and in diagrams. */
export const WIDTH = { train: 1.2, metro: 1.25, tram: 1, bus: 0.68, ferry: 0.8, other: 0.8 };
/** Lines of these groups can share a street or track and are glued side by side. */
export const GROUP = { train: "rail", metro: "metro", tram: "street", bus: "street", ferry: "water", other: "other" };

/** Lines with no colour of their own take one from this palette; buses share one blue. */
export const PALETTE = ["#E2483D", "#F08A24", "#D9A511", "#7CB32B", "#1E9B55", "#0E9AA7", "#2E96D6", "#3361D1", "#5B4FCF", "#8E4DC2", "#D33F8B", "#94612F"];
export const BUS_BLUE = "#2F6FD0";
export const TRAIN_GREY = "#5E6772";

export function normColour(c) {
  if (!c) return "";
  c = String(c).replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(c) || c === "ffffff") return "";
  return c;
}

export const lineKey = (cls, name, colour) => `${cls}|${name}|${normColour(colour)}`;

/** One registry for every line seen anywhere (map, departures, trips) so colours stay put. */
export const registry = new Map();

export function ensureLine({ mode, name, colour, textColour, longName, agency }) {
  const cls = classOf(mode);
  if (!cls) return null;
  name = String(name || longName || "?").trim();
  const key = lineKey(cls, name, colour);
  let l = registry.get(key);
  if (!l) {
    l = { key, cls, mode, name, raw: normColour(colour), rawText: normColour(textColour), longName: longName || "", agency: agency || "",
      routes: new Set(), minZoom: 99, colour: null, nid: registry.size + 1, rank: null };
    registry.set(key, l);
  }
  if (longName && !l.longName) l.longName = longName;
  if (agency && !l.agency) l.agency = agency;
  return l;
}

/**
 * The line's colour: its own, else a palette colour that no line it meets already uses.
 * `neighbours` (lines sharing a station) is optional; the first answer is kept for good.
 */
export function colourOf(l, neighbours) {
  if (l.colour) return l.colour;
  if (l.raw) l.colour = "#" + l.raw;
  else if (l.cls === "bus") l.colour = BUS_BLUE;
  else if (l.cls === "train") l.colour = TRAIN_GREY;
  else {
    const used = new Set();
    for (const n of neighbours || []) if (n !== l && n.colour && !n.raw) used.add(n.colour);
    const start = hash(l.name) % PALETTE.length;
    l.colour = PALETTE[start];
    for (let k = 0; k < PALETTE.length; k++) { const c = PALETTE[(start + k) % PALETTE.length]; if (!used.has(c)) { l.colour = c; break; } }
  }
  return l.colour;
}

export function textOn(l) {
  if (l.rawText && l.raw) return "#" + l.rawText;
  const c = colourOf(l).slice(1), r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? "#111" : "#fff";
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Trains first, then metro, trams, buses…; by number within a kind ("2" before "10"). Uses a precomputed rank when there is one. */
export const compareLines = (a, b) =>
  (a.rank != null && b.rank != null) ? a.rank - b.rank : CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls] || collator.compare(a.name, b.name);
/** Rank every known line once, so sorting thousands of bundles is cheap. */
export function rankLines() {
  const all = [...registry.values()];
  all.forEach(l => { l.rank = null; });
  all.sort(compareLines).forEach((l, i) => { l.rank = i; });
}

export const badge = (l, size = "") =>
  `<span class="badge ${l.cls} ${size}" style="--c:${colourOf(l)};--t:${textOn(l)}" title="${esc(classLabel(l.cls) + " " + l.name)}">${esc(l.name)}</span>`;

/** A line from a departure (stoptimes) or a trip leg. */
export const lineOfStopTime = st => ensureLine({
  mode: classOf(st.mode) ? st.mode : "BUS", name: st.routeShortName || st.displayName || st.tripShortName, colour: st.routeColor, textColour: st.routeTextColor,
  longName: st.routeLongName, agency: st.agencyName,
});
