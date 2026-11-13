// Places on the map (shops, food, health, culture…): filled-circle icons in their category's colour,
// and their details from OpenStreetMap when tapped (opening hours, phone, website, address…).

import { PLACE_ICONS, GLYPHS } from "./placeicons.js";
import { ensure, ensureIdle } from "./icons.js";

const idOf = key => "pl-" + key.replace("/", "--");
const OTHER = ["dot-outline", "#6E7681", "Place"];

/** The icon as SVG: a white-rimmed filled circle with a white glyph. */
export function placeSvg(key, size = 28) {
  const [g, colour] = PLACE_ICONS[key] || OTHER;
  const d = GLYPHS[g] || "M128 88a40 40 0 1 1-40 40 40 40 0 0 1 40-40z";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13.4" fill="#fff"/><circle cx="14" cy="14" r="11.8" fill="${colour}"/><path d="${d}" fill="#fff" transform="translate(7.2 7.2) scale(${13.6 / 256})"/></svg>`;
}
const defOf = k => () => ({ svg: placeSvg(k), w: 28, h: 28, ratio: 3 });
/** The common ones a few at a time while idle; any other the moment the map asks for it. */
export function preloadPlaceIcons() {
  ensureIdle([...Object.keys(PLACE_ICONS), "other"].map(k => [idOf(k), defOf(k)]));
}
export function placeIcon1(id) {
  const k = id.slice(3).replace("--", "/");
  if (PLACE_ICONS[k] || k === "other") ensure(id, defOf(k));
}

const SUB_KEYS = Object.keys(PLACE_ICONS).filter(k => k.includes("/"));
const CLASS_KEYS = Object.keys(PLACE_ICONS).filter(k => !k.includes("/"));
const pair = ["concat", ["get", "class"], "/", ["coalesce", ["get", "subclass"], ""]];
/** Style expressions: which icon, and the label colour (a darker shade of the category's). */
export const placeIcon = ["case",
  ["in", pair, ["literal", SUB_KEYS]], ["concat", "pl-", ["get", "class"], "--", ["get", "subclass"]],
  ["in", ["get", "class"], ["literal", CLASS_KEYS]], ["concat", "pl-", ["get", "class"]], "pl-other"];
const darker = hex => { const n = parseInt(hex.slice(1), 16), f = c => Math.round(c * 0.72); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
export const placeTextColour = dark => ["match", ["get", "class"], ...CLASS_KEYS.flatMap(k => [k, dark ? PLACE_ICONS[k][1] : darker(PLACE_ICONS[k][1])]), dark ? "#BDC1C6" : "#5F6368"];
// Street furniture and barriers: not shown as places.
export const HIDDEN = ["bus", "rail", "railway", "tram", "ferry_terminal", "aerialway", "harbor", "gate", "bollard", "lift_gate", "cycle_barrier", "sally_port",
  "waste_basket", "toll_booth", "border_control", "brownfield", "basin", "entrance"];

/** What a place is, from its tile properties. */
export function kindOf(p) {
  const key = PLACE_ICONS[`${p.class}/${p.subclass}`] ? `${p.class}/${p.subclass}` : PLACE_ICONS[p.class] ? p.class : null;
  const [, colour, label] = key ? PLACE_ICONS[key] : OTHER;
  const pretty = s => s ? s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()) : "";
  return { key: key || "other", colour, label: key ? label : pretty(p.subclass || p.class) || "Place" };
}

/** The OpenStreetMap element behind a map feature id (the tiles encode it as osm id × 10 + type). */
export function osmOf(fid) {
  if (fid == null || fid < 10) return null;
  const type = { 1: "node", 2: "way", 3: "relation" }[fid % 10];
  return type ? { type, id: Math.floor(fid / 10) } : null;
}

/** The element's tags from the OpenStreetMap API. */
export async function osmTags({ type, id }) {
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/${type}/${id}.json`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 410 ? "not found" : "OpenStreetMap " + res.status);
  return (await res.json()).elements?.[0]?.tags || {};
}

/* ============================== Reading the tags ============================== */

const DAYS = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "Holidays" };
/** opening_hours, readable: one rule per line, day names spelled out. */
export function hoursLines(oh) {
  if (!oh) return [];
  if (oh.trim() === "24/7") return ["Open 24 hours, every day"];
  return oh.split(/\s*;\s*/).filter(Boolean).map(r => r.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, d => DAYS[d]).replace(/\boff\b/g, "closed").replace(/,(?=\S)/g, ", "));
}
const yes = v => v === "yes" || v === "only" || v === "designated";
/** Everything worth showing, as [icon, label, value, link?] rows. */
const pretty = s => s.replace(/[_:]/g, " ").replace(/^./, c => c.toUpperCase());
export function detailRows(t) {
  const rows = [];
  // A sea mark: what it is, and the facts a sailor needs.
  const st = t["seamark:type"];
  if (st) {
    rows.push(["compass", "Sea mark", pretty(st)]);
    const cat = t[`seamark:${st}:category`];
    if (cat) rows.push(["info", "Category", cat.split(";").map(pretty).join(", ")]);
    const colour = t[`seamark:${st}:colour`];
    if (colour) rows.push(["sun", "Colours", colour.split(";").map(pretty).join(", ")]);
    if (t["seamark:topmark:shape"]) rows.push(["star", "Topmark", pretty(t["seamark:topmark:shape"])]);
    if (t["seamark:light:reference"]) rows.push(["book", "Light list", t["seamark:light:reference"]]);
    if (t["seamark:information"]) rows.push(["info", "Notes", t["seamark:information"]]);
  }
  const street = [t["addr:street"] || t["addr:place"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const addr = [street, [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (addr) rows.push(["pin", "Address", addr]);
  const phone = t.phone || t["contact:phone"] || t["contact:mobile"];
  if (phone) rows.push(["phone", "Phone", phone, "tel:" + phone.split(";")[0].replace(/\s+/g, "")]);
  const web = t.website || t["contact:website"] || t.url;
  if (web) rows.push(["globe", "Website", web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), /^https?:/.test(web) ? web : "https://" + web]);
  const mail = t.email || t["contact:email"];
  if (mail) rows.push(["share", "Email", mail, "mailto:" + mail]);
  if (t.cuisine) rows.push(["food", "Cuisine", t.cuisine.split(";").map(c => c.replace(/_/g, " ")).join(", ")]);
  const diet = Object.keys(t).filter(k => k.startsWith("diet:") && yes(t[k])).map(k => k.slice(5).replace(/_/g, " "));
  if (diet.length) rows.push(["heart", "Diets", diet.join(", ")]);
  const serv = [yes(t.takeaway) && "Takeaway", yes(t.delivery) && "Delivery", yes(t.outdoor_seating) && "Outdoor seating", (t.internet_access && t.internet_access !== "no") && "Wi-Fi",
    yes(t.air_conditioning) && "Air conditioning", t.smoking === "no" && "No smoking"].filter(Boolean);
  if (serv.length) rows.push(["star", "Services", serv.join(" · ")]);
  if (t.wheelchair) rows.push(["wheel", "Wheelchair", { yes: "Accessible", limited: "Partly accessible", no: "Not accessible", designated: "Accessible" }[t.wheelchair] || t.wheelchair]);
  const pay = Object.keys(t).filter(k => k.startsWith("payment:") && yes(t[k])).map(k => k.slice(8).replace(/_/g, " "));
  if (pay.length) rows.push(["ticket", "Payment", pay.slice(0, 6).join(", ")]);
  if (t.operator || t.brand) rows.push(["info", "Operator", t.operator || t.brand]);
  if (t.level) rows.push(["layers", "Floor", t.level]);
  if (t.description) rows.push(["book", "About", t.description]);
  if (t.wikipedia) { const [lang, title] = t.wikipedia.split(":"); if (title) rows.push(["book", "Wikipedia", title, `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`]); }
  return rows;
}
