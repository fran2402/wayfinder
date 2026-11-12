// Sea marks: their drawings (SVG) and how to read them from OpenStreetMap's tags (the OpenSeaMap
// tagging). No browser or map code here, so the build (tools/build-sea.mjs) uses the same reading
// as the map: buoys and beacons in their real shapes, colours and topmarks, lights with flares and
// sectors, landmarks, rocks, wrecks, harbour facilities, traffic separation schemes and more.

const C = { red: "#E5383B", green: "#23A455", yellow: "#FFC531", black: "#202124", white: "#FFFFFF", orange: "#F28C28", blue: "#1A73E8", grey: "#9AA0A6", brown: "#8D6E63", amber: "#FFB300", violet: "#8E44AD", magenta: "#C2185B" };
const INK = "#1D2B3A", NAVY = "#174EA6", SEA = "#1A73E8", MAG = "#B0379A", TSS = "#A64BE8";
const FLARE = { red: "#E5383B", green: "#23A455", white: "#FFC531", yellow: "#FFC531", orange: "#F28C28", blue: "#1A73E8", violet: "#8E44AD" };
const col = c => C[c] || C.grey;

/* ============================== Icons (SVG) ============================== */

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// Draw shapes twice: a white halo first, so marks stand out on blue water and on land alike.
const flare = (x, y, colour, len = 13, wid = 3.6) => {
  const c = FLARE[colour] || MAG;
  const d = `M0 0C${-wid * 0.7} ${-len * 0.25} ${-wid} ${-len * 0.66} 0 ${-len}C${wid} ${-len * 0.66} ${wid * 0.7} ${-len * 0.25} 0 0z`;
  return `<path d="${d}" transform="translate(${x} ${y}) rotate(45)" fill="${c}" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>`;
};

// Buoy and beacon bodies in a 30-wide frame, standing on y = 35 (before the 10 px shift for topmarks).
const BODIES = {
  can: { d: "M9.5 20h11v14.2a.8.8 0 0 1-.8.8h-9.4a.8.8 0 0 1-.8-.8z", top: 20, x: [9.5, 20.5] },
  conical: { d: "M15 18.5l6.6 16.5H8.4z", top: 18.5, x: [8.4, 21.6] },
  pillar: { d: "M12.8 12h4.4l2.5 19.2H23V35H7v-3.8h3.3z", top: 12, x: [7, 23] },
  spar: { d: "M13.5 11h3v24h-3z", top: 11, x: [13.5, 16.5] },
  spherical: { d: "M15 21a7 7 0 1 1 0 14a7 7 0 1 1 0-14z", top: 21, x: [8, 22] },
  barrel: { d: "M9.2 25.5h11.6a3.2 4.75 0 0 1 0 9.5H9.2a3.2 4.75 0 0 1 0-9.5z", top: 25.5, x: [6, 24] },
  super: { d: "M6.5 23.5h17V35h-17z", top: 23.5, x: [6.5, 23.5] },
  stake: { d: "M14 10.5h2V35h-2z", top: 10.5, x: [14, 16], base: true },
  tower: { d: "M12 13h6l2.6 22H9.4z", top: 13, x: [9.4, 20.6], base: true },
  lattice: { d: "M12 13h6l2.6 22H9.4z", top: 13, x: [9.4, 20.6], base: true, lattice: true },
  cairn: { d: "M7.5 35l3.2-8.2 4.3-3.3 4.3 3.3 3.2 8.2z", top: 23.5, x: [7.5, 22.5], base: true },
};
const BODY_OF = {
  can: "can", conical: "conical", pillar: "pillar", spar: "spar", spherical: "spherical", barrel: "barrel", "super-buoy": "super", super: "super", ice_buoy: "pillar",
  stake: "stake", withy: "stake", pile: "stake", pile_beacon: "stake", pole: "stake", post: "stake", beacon_tower: "tower", tower: "tower", lattice_beacon: "lattice", lattice: "lattice", cairn: "cairn", buoyant_beacon: "pillar",
};

function topmark(kind, colour, y) {
  const c = col(colour), s = `fill="${c}" stroke="${INK}" stroke-width="0.7" stroke-linejoin="round"`;
  const up = yb => `<path d="M15 ${yb - 5.6}l3.8 5.6h-7.6z" ${s}/>`, down = yb => `<path d="M11.2 ${yb - 5.6}h7.6L15 ${yb}z" ${s}/>`;
  const ball = cy => `<circle cx="15" cy="${cy}" r="2.9" ${s}/>`;
  switch (kind) {
    case "up": return up(y);
    case "down": return down(y);
    case "2up": return up(y) + up(y - 6.6);
    case "2down": return down(y) + down(y - 6.6);
    case "base": return `<path d="M15 ${y - 12}L18.8 ${y - 6}H11.2z" ${s}/><path d="M11.2 ${y - 6}H18.8L15 ${y}z" ${s}/>`;
    case "point": return `<path d="M11.2 ${y - 12}H18.8L15 ${y - 6}z" ${s}/><path d="M15 ${y - 6}L18.8 ${y}H11.2z" ${s}/>`;
    case "ball": return ball(y - 2.9);
    case "2ball": return ball(y - 2.9) + ball(y - 9.4);
    case "can": return `<rect x="11.6" y="${y - 6}" width="6.8" height="6" rx="0.6" ${s}/>`;
    case "x": return `<path d="M11.6 ${y - 7}L18.4 ${y}M18.4 ${y - 7}L11.6 ${y}" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/><path d="M11.6 ${y - 7}L18.4 ${y}M18.4 ${y - 7}L11.6 ${y}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
    case "cross": return `<path d="M15 ${y - 8}V${y}M11.5 ${y - 4.5}h7" stroke="${c}" stroke-width="2"/>`;
    case "board": return `<rect x="11" y="${y - 6}" width="8" height="6" ${s}/>`;
    default: return "";
  }
}
function topmarkKind(shape = "") {
  const s = shape.toLowerCase();
  if (s.includes("2 cones")) return s.includes("up") ? "2up" : s.includes("down") ? "2down" : s.includes("base") ? "base" : s.includes("point") ? "point" : "2up";
  if (s.includes("cone")) return s.includes("down") ? "down" : "up";
  if (s.includes("2 spheres")) return "2ball";
  if (s.includes("sphere") || s.includes("ball")) return "ball";
  if (s.includes("cylinder") || s.includes("can")) return "can";
  if (s.includes("x-shape") || s.includes("saltire")) return "x";
  if (s.includes("cross")) return "cross";
  if (s) return "board";
  return "";
}
function topmarkHeight(k) { return { up: 6, down: 6, "2up": 13, "2down": 13, base: 12, point: 12, ball: 6, "2ball": 12.5, can: 6, x: 7.5, cross: 8, board: 6 }[k] || 0; }

/** A buoy or beacon: body (banded in its colours), topmark, and a light flare if lit. */
let uid = 0;
function buoySvg({ body, colours, pattern, tm, tmColour, light }) {
  const u = "m" + (++uid);
  const B = BODIES[body] || BODIES.pillar, dy = 10, bands = colours.length ? colours : ["grey"];
  const [x0, x1] = B.x, y0 = B.top, y1 = 35;
  let fill = "";
  if (pattern === "vertical" && bands.length > 1) {
    const n = bands.length === 2 ? 4 : bands.length, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) fill += `<rect x="${x0 + i * w}" y="${y0}" width="${w + 0.05}" height="${y1 - y0}" fill="${col(bands[i % bands.length])}"/>`;
  } else {
    const h = (y1 - y0) / bands.length;
    bands.forEach((c, i) => fill += `<rect x="${x0 - 1}" y="${y0 + i * h}" width="${x1 - x0 + 2}" height="${h + 0.05}" fill="${col(c)}"/>`);
  }
  const lattice = B.lattice ? `<path d="M12.6 16l5.6 7.5M17.4 16l-5.6 7.5M11.6 23.5l7.6 9.5M18.4 23.5l-7.6 9.5" stroke="#fff" stroke-width="0.9" opacity="0.85"/>` : "";
  const ty = y0 - 2.2, th = topmarkHeight(tm);
  const stem = tm ? `<path d="M15 ${y0}V${ty}" stroke="${INK}" stroke-width="1.2"/>` : "";
  const tmSvg = tm ? topmark(tm, tmColour || bands[0], ty) : "";
  const base = B.base ? `<path d="M9 35h12" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` : `<path d="M8.5 36.2c2.2-1 4.3-1 6.5 0s4.3 1 6.5 0" fill="none" stroke="${SEA}" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>`;
  // A white outline round the whole mark (body, topmark, base), so it reads on water and land alike.
  const out = `<defs><clipPath id="${u}b"><path d="${B.d}"/></clipPath><filter id="${u}h" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.5" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g filter="url(#${u}h)"><g clip-path="url(#${u}b)">${fill}</g>${lattice}<path d="${B.d}" fill="none" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>${stem}${tmSvg}${B.base ? base : ""}</g>${B.base ? "" : base}`;
  const fl = light ? flare(16.5, y0 + 3, light, 14, 3.8) : "";
  return svg(30, 48, `<g transform="translate(0 ${dy})">${out}${fl}</g>`);
}

const lightSvg = (major, colour) => svg(40, 40, `${flare(20, 20, colour, major ? 19 : 16, major ? 5.6 : 4.8)}<circle cx="20" cy="20" r="${major ? 3.8 : 3.2}" fill="${INK}" stroke="#fff" stroke-width="1.6"/>`);
const lighthouseSvg = colour => svg(30, 44, `
  <path d="M10 41l2.6-24h4.8L20 41z M11.2 13h7.6v4h-7.6z M12.2 8.5h5.6v4.5h-5.6z M15 4.5l3.4 4h-6.8z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  <defs><clipPath id="lh${colour}"><path d="M10 41l2.6-24h4.8L20 41z"/></clipPath></defs>
  <g clip-path="url(#lh${colour})"><rect x="8" y="16" width="14" height="26" fill="#fff"/><rect x="8" y="21" width="14" height="5" fill="${C.red}"/><rect x="8" y="31" width="14" height="5" fill="${C.red}"/></g>
  <path d="M10 41l2.6-24h4.8L20 41z" fill="none" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
  <rect x="11.2" y="15.2" width="7.6" height="1.8" rx="0.4" fill="${INK}"/>
  <rect x="12.4" y="9.6" width="5.2" height="5.6" rx="0.6" fill="${FLARE[colour] || C.yellow}" stroke="${INK}" stroke-width="0.9"/>
  <path d="M15 5.2l3.2 4.4h-6.4z" fill="${INK}"/>
  <path d="M8.6 9.5L3.5 7.4M8.6 12.6L3 12.8M21.4 9.5l5.1-2.1M21.4 12.6l5.6.2" stroke="${FLARE[colour] || C.yellow}" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M7 41.5h16" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`);
const disc = (fill, glyph, size = 28) => svg(size, size, `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 0.5}" fill="#fff"/><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2.2}" fill="${fill}"/><g transform="translate(${(size - 24) / 2} ${(size - 24) / 2})" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`);
const square = (fill, glyph) => svg(24, 24, `<rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill="#fff"/><rect x="2" y="2" width="20" height="20" rx="5.2" fill="${fill}"/><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`);
const text = (t, size = 8.5, y = 15.2) => `<text x="12" y="${y}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="800" font-size="${size}" fill="#fff" stroke="none">${t}</text>`;

const ANCHOR = `<circle cx="12" cy="5.6" r="1.7"/><path d="M12 7.3V19M8.2 10h7.6M5.6 13.4c.4 3.3 3 5.6 6.4 5.6s6-2.3 6.4-5.6M4.4 14.8l1.2-1.6 1.7 1.2M19.6 14.8l-1.2-1.6-1.7 1.2"/>`;
const SAILBOAT = `<path d="M11.8 3.8v12.4M11.8 4.6L6 15h5.8M13.4 6.4l4.6 8.6h-4.6z" fill="#fff" stroke-width="1.2"/><path d="M4.6 16.8h14.8l-2 3H6.6z" fill="#fff" stroke-width="1.2"/>`;
const SHIP = `<path d="M4.4 14.2h15.2l-2.2 4.2H6.6z" fill="#fff" stroke="none"/><path d="M7.5 14V10.6h9V14M10.2 10.6V8.2h3.6v2.4" stroke-width="1.5"/><path d="M4 21c1.4-.9 2.6-.9 4 0s2.6.9 4 0 2.6-.9 4 0 2.6.9 4 0" stroke-width="1.3"/>`;
const GLYPHS = {
  slipway: `<path d="M5 15.5L18.5 8" stroke-width="2"/><path d="M5 18.5c1.3-.8 2.5-.8 3.8 0s2.5.8 3.8 0 2.5-.8 3.8 0" stroke-width="1.3"/>`,
  boat_hoist: `<path d="M7 19V5.5h10M7 9.5l4-4M17 5.5V10m-1.6 0a1.6 1.6 0 1 0 3.2 0" />`,
  fuel_station: `<path d="M6.5 19V6.5a1 1 0 0 1 1-1h5.5a1 1 0 0 1 1 1V19M5.5 19h9.5M8.5 9h3.5M14 11h1.6a1 1 0 0 1 1 1v4.2a1.2 1.2 0 0 0 2.4 0V9.5L17 7.5"/>`,
  water_tap: `<path d="M12 5.5c2.8 3.6 4.4 6 4.4 8.2a4.4 4.4 0 0 1-8.8 0c0-2.2 1.6-4.6 4.4-8.2z"/>`,
  electricity: `<path d="M13 4.5L7.5 13h4l-1 6.5L16.5 11h-4z" fill="#fff" stroke-width="1.2"/>`,
  showers: `<path d="M7 18.5V8a3 3 0 0 1 3-3h1.5a3 3 0 0 1 3 3v.5M11.5 10.5h6M13 13.5v.1M15 13.5v.1M17 13.5v.1M13.5 16v.1M15.5 16v.1"/>`,
  chandler: `<path d="M6.5 9h11l-1 10h-9zM9.5 9V7.5a2.5 2.5 0 0 1 5 0V9"/>`,
  toilets: text("WC", 8.6), visitor_berth: text("V", 11, 16), pump_out: text("P", 11, 16), laundrette: text("L", 11, 16), info: text("i", 12, 16.5),
};
const BLUEFLAG = svg(28, 28, `<circle cx="14" cy="14" r="13.5" fill="#fff"/><circle cx="14" cy="14" r="12.2" fill="none" stroke="#DADCE0"/>
  <path d="M8.2 5.2V23" stroke="#5F6368" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M9 5.8h12.6v9.6H9z" fill="#0B57D0"/>
  <path d="M10.2 9.3c1.6-1.3 3-1.3 4.6 0s3 1.3 4.6 0M10.2 12.2c1.6-1.3 3-1.3 4.6 0s3 1.3 4.6 0" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>`);

const STATIC = {
  "sm-harbour": () => disc(NAVY, ANCHOR), "sm-marina": () => disc(SEA, SAILBOAT), "sm-ferry": () => disc(NAVY, SHIP),
  "sm-anchorage": () => svg(26, 26, `<g transform="translate(1 1)" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${ANCHOR}</g><g transform="translate(1 1)" fill="none" stroke="${MAG}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ANCHOR}</g>`),
  "sm-blueflag": () => BLUEFLAG,
  "sm-rock": () => svg(22, 22, `<circle cx="11" cy="11" r="8.4" fill="rgba(255,255,255,.55)" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1.3 1.9" stroke-linecap="round"/><path d="M11 6.8v8.4M6.8 11h8.4" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>`),
  "sm-rock-awash": () => svg(22, 22, `<circle cx="11" cy="11" r="8.4" fill="rgba(255,255,255,.55)" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1.3 1.9" stroke-linecap="round"/><path d="M11 6.5v9M6.5 11h9M7.8 7.8l6.4 6.4M14.2 7.8l-6.4 6.4" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`),
  "sm-wreck": () => svg(28, 20, `<ellipse cx="14" cy="10" rx="12.4" ry="8.4" fill="rgba(255,255,255,.55)" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1.3 1.9" stroke-linecap="round"/><path d="M6.5 10.5h15M10.5 6.5v8M14 5.5v10M17.5 6.5v8" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`),
  "sm-obstruction": () => svg(20, 20, `<circle cx="10" cy="10" r="7.6" fill="rgba(255,255,255,.55)" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1.3 1.9" stroke-linecap="round"/><circle cx="10" cy="10" r="1.8" fill="${INK}"/>`),
  "sm-mooring": () => svg(16, 18, `<circle cx="8" cy="11" r="5.4" fill="#fff"/><circle cx="8" cy="11" r="4.2" fill="${C.orange}" stroke="${INK}" stroke-width="0.8"/><circle cx="8" cy="4.2" r="2.2" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="8" cy="4.2" r="2.2" fill="none" stroke="${INK}" stroke-width="1.1"/>`),
  "sm-notice-no": () => svg(20, 24, `<path d="M10 14v9" stroke="${INK}" stroke-width="1.6"/><rect x="1.5" y="1.5" width="17" height="14" rx="1.6" fill="#fff" stroke="${C.red}" stroke-width="2"/><path d="M4.4 13.2L15.6 3.8" stroke="${C.red}" stroke-width="2"/>`),
  "sm-notice-info": () => svg(20, 24, `<path d="M10 14v9" stroke="${INK}" stroke-width="1.6"/><rect x="1.5" y="1.5" width="17" height="14" rx="1.6" fill="${SEA}" stroke="#fff" stroke-width="1.4"/><path d="M10 6.2v.1M10 8.6v4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`),
  "sm-hm": () => square(NAVY, text("HM", 8.2)),
  "sm-station": () => svg(18, 18, `<circle cx="9" cy="9" r="7.4" fill="#fff" stroke="${MAG}" stroke-width="1.5"/><circle cx="9" cy="9" r="3.6" fill="none" stroke="${MAG}" stroke-width="1.5"/><circle cx="9" cy="9" r="1.2" fill="${MAG}"/>`),
  "sm-dot": () => svg(14, 14, `<path d="M7 1.5L12.5 7 7 12.5 1.5 7z" fill="${MAG}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`),
  // Traffic lane direction: an open arrow along the lane.
  "sm-arrow": () => svg(44, 18, `<path d="M2 6.5h26V2l14 7-14 7v-4.5H2z" fill="rgba(166,75,232,.28)" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><path d="M2 6.5h26V2l14 7-14 7v-4.5H2z" fill="rgba(166,75,232,.28)" stroke="${TSS}" stroke-width="1.5" stroke-linejoin="round"/>`),
};
// Landmarks and shore features seen from the sea: dark glyphs on a white disc.
const mark = (glyph, colour = INK) => svg(22, 22, `<circle cx="11" cy="11" r="10.4" fill="#fff"/><circle cx="11" cy="11" r="9.2" fill="none" stroke="${colour}" stroke-width="1.3"/><g transform="translate(-1 -1)" fill="none" stroke="${colour}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`);
const LANDMARKS = {
  tower: `<path d="M10 19l1.2-11h1.6L14 19M9 19h6M11 8h2V5.5h-2z"/>`,
  chimney: `<path d="M10.5 19V5h3v14M9 19h6"/><path d="M14.5 4.5c1-1 2.2-.6 3-1.6" stroke-width="1.2"/>`,
  church: `<path d="M12 4v4M10.5 5.5h3M8 19v-6.5L12 9l4 3.5V19zM8 19h8"/>`,
  spire: `<path d="M12 4l3 9v6H9v-6zM9 19h6"/>`, minaret: `<path d="M12 4v3M10.5 19V9.5h3V19M9.5 9.5h5M9 19h6"/>`,
  cross: `<path d="M12 5v14M8.5 9h7"/>`, dome: `<path d="M7 18h10M8 18v-3a4 4 0 0 1 8 0v3M12 11V9"/>`,
  mast: `<path d="M12 4v15M8.5 19h7M12 7l-3.5 12M12 7l3.5 12"/>`, windmill: `<path d="M10 19l1-7h2l1 7M12 12L7 7M12 12l5-5M12 12L7 17M12 12l5 5"/>`,
  windmotor: `<path d="M12 19V11M12 11L8 6M12 11l5-1M12 11l-1.5 5.5M9.5 19h5"/>`, flagstaff: `<path d="M9 4v15M9 5h7l-2 2.5 2 2.5H9M7 19h4"/>`,
  monument: `<path d="M10 19l.8-12L12 5l1.2 2 .8 12M8.5 19h7"/>`, statue: `<circle cx="12" cy="6.5" r="1.6"/><path d="M12 8.5v5M9.5 11h5M10.5 19l1.5-5.5 1.5 5.5M8.5 19h7"/>`,
  tank: `<path d="M7.5 9h9v9h-9zM7.5 9a4.5 2 0 0 1 9 0"/>`, silo: `<path d="M9 19V8a3 3 0 0 1 6 0v11M8 19h8"/>`, building: `<path d="M7 19V9l5-3 5 3v10zM10 19v-4h4v4"/>`,
};
const SHORE = {
  "sm-distance": () => svg(16, 16, `<circle cx="8" cy="8" r="6.6" fill="#fff" stroke="${INK}" stroke-width="1.2"/><circle cx="8" cy="8" r="2.2" fill="${INK}"/>`),
  "sm-berth": () => svg(22, 22, `<circle cx="11" cy="11" r="10.4" fill="#fff"/><circle cx="11" cy="11" r="9" fill="${MAG}"/><path d="M7 15V8l4 4 4-4v7" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`),
  "sm-crane": () => mark(`<path d="M7 19V6h11M7 9.5L10.5 6M16.5 6v4.5"/><path d="M15 12.5a1.5 1.5 0 1 0 3 0"/>`),
  "sm-fog": () => svg(26, 22, `<g fill="none" stroke="${MAG}" stroke-width="1.6" stroke-linecap="round"><path d="M6 6a7 7 0 0 1 0 10M10 3.5a11 11 0 0 1 0 15M14 1.5a14 14 0 0 1 0 19"/></g><circle cx="3.5" cy="11" r="2" fill="${MAG}"/>`),
  "sm-pilot": () => svg(24, 24, `<path d="M12 1.5l10.5 10.5L12 22.5 1.5 12z" fill="#fff" stroke="${MAG}" stroke-width="1.6" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="9.5" fill="${MAG}">P</text>`),
  "sm-rescue": () => svg(24, 24, `<circle cx="12" cy="12" r="11.2" fill="#fff"/><circle cx="12" cy="12" r="9.8" fill="${C.red}"/><path d="M12 6.5v11M6.5 12h11" stroke="#fff" stroke-width="3"/>`),
  "sm-coastguard": () => svg(24, 24, `<circle cx="12" cy="12" r="11.2" fill="#fff"/><circle cx="12" cy="12" r="9.8" fill="${NAVY}"/><path d="M12 5.5l5 2v4c0 3.2-2.2 5.6-5 6.8-2.8-1.2-5-3.6-5-6.8v-4z" fill="#fff"/>`),
  "sm-signal": () => svg(22, 24, `<path d="M11 10v12M7 22h8" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="7" r="5.6" fill="#fff" stroke="${MAG}" stroke-width="1.6"/><circle cx="11" cy="7" r="2.2" fill="${MAG}"/>`),
  "sm-radar": () => svg(22, 22, `<circle cx="11" cy="11" r="10.4" fill="#fff" stroke="${MAG}" stroke-width="1.4"/><path d="M5 15a8 8 0 0 1 8-9" fill="none" stroke="${MAG}" stroke-width="1.6"/><path d="M11 11l5-5" stroke="${MAG}" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="11" r="1.6" fill="${MAG}"/>`),
  "sm-platform": () => svg(24, 24, `<rect x="2" y="2" width="20" height="20" rx="3" fill="#fff" stroke="${INK}" stroke-width="1.4"/><path d="M6 9h12M8 9v9M16 9v9M8 13h8M12 5v4" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>`),
  "sm-callin": () => svg(24, 24, `<circle cx="12" cy="12" r="10.6" fill="#fff" stroke="${MAG}" stroke-width="1.6"/><path d="M7 12h8M12 8.5L15.5 12 12 15.5" fill="none" stroke="${MAG}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  "sm-fishing": () => svg(24, 22, `<path d="M3 11c3-5 9-6.5 14-3l4-3v12l-4-3c-5 3.5-11 2-14-3z" fill="#fff" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="10" r="1.1" fill="${INK}"/>`),
  "sm-farm": () => svg(24, 22, `<path d="M3 11c3-5 9-6.5 14-3l4-3v12l-4-3c-5 3.5-11 2-14-3z" fill="#E6F4EA" stroke="#2E7D32" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="10" r="1.1" fill="#2E7D32"/>`),
  "sm-hulk": () => svg(28, 16, `<path d="M2 5h24l-3 9H5z" fill="#fff" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h14" stroke="${INK}" stroke-width="1.2"/>`),
  "sm-daymark": () => svg(18, 22, `<path d="M9 12v9M5.5 21h7" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><path d="M9 1.5l7 9H2z" fill="#fff" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`),
  "sm-pile": () => svg(12, 12, `<circle cx="6" cy="6" r="4.6" fill="${INK}" stroke="#fff" stroke-width="1.4"/>`),
  "sm-bridge": () => mark(`<path d="M5 15h14M6 15c2-5 10-5 12 0M9 15v-3M15 15v-3"/>`),
  "sm-lock": () => svg(24, 24, `<rect x="2" y="2" width="20" height="20" rx="3" fill="#fff" stroke="${NAVY}" stroke-width="1.4"/><path d="M7 6v12M17 6v12M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" fill="none" stroke="${NAVY}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  "sm-gate": () => svg(24, 24, `<rect x="2" y="2" width="20" height="20" rx="3" fill="#fff" stroke="${NAVY}" stroke-width="1.4"/><path d="M7 6v12M17 6v12M7 8h10M7 12h10" stroke="${NAVY}" stroke-width="1.5" stroke-linecap="round"/>`),
  "sm-customs": () => square(NAVY, text("C", 11, 16)), "sm-fuel": () => square(SEA, GLYPHS.fuel_station), "sm-firstaid": () => square(C.red, `<path d="M12 7v10M7 12h10" stroke-width="2.6"/>`),
  "sm-seaplane": () => svg(24, 24, `<circle cx="12" cy="12" r="11" fill="#fff" stroke="${SEA}" stroke-width="1.4"/><path d="M19 13.4v-1.3l-5.4-3.4V5a1 1 0 0 0-2 0v3.7L6 12.1v1.3l5.6-1.7v3.7l-1.4 1v1.1l2.4-.7 2.4.7v-1.1l-1.4-1v-3.7z" fill="${SEA}"/>`),
};
Object.assign(STATIC, SHORE);
for (const [k, g] of Object.entries(LANDMARKS)) STATIC["sm-lm-" + k] = () => mark(g);
for (const [k, g] of Object.entries(GLYPHS)) STATIC["sm-f-" + k] = () => square(SEA, g);
for (const c of ["red", "green", "white", "yellow", "orange", "blue", "violet"]) {
  STATIC[`sm-light-major-${c}`] = () => lightSvg(true, c);
  STATIC[`sm-light-minor-${c}`] = () => lightSvg(false, c);
  STATIC[`sm-lighthouse-${c}`] = () => lighthouseSvg(c);
}
const SIZES = id => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(STATIC[id]());
  return [+m[1], +m[2]];
};
const staticDef = id => () => { const s = STATIC[id](); const [w, h] = SIZES(id); return { svg: s, w, h, ratio: 3 }; };


/* ============================== Reading OpenStreetMap's sea marks ============================== */

const BUOYS = /^(buoy|beacon)_(lateral|cardinal|isolated_danger|safe_water|special_purpose|installation)$|^(light_float|light_vessel)$/;
const AREA_STYLE = {
  separation_zone: { fill: TSS, fo: 0.28, line: TSS, dash: "none", w: 0 },
  separation_line: { line: TSS, dash: "solid", w: 3.2, o: 0.55 },
  separation_boundary: { line: TSS, dash: "dash", w: 1.4 },
  separation_crossing: { line: TSS, dash: "dash", w: 1.4 },
  separation_roundabout: { line: TSS, dash: "dash", w: 1.4 },
  separation_lane: { line: TSS, dash: "dot", w: 1, o: 0.6, lane: true },
  inshore_traffic_zone: { line: TSS, dash: "dash", w: 1.2, o: 0.7 },
  precautionary_area: { line: TSS, dash: "dash", w: 1.2 },
  recommended_track: { line: INK, dash: "solid", w: 1, o: 0.7 },
  recommended_route_centreline: { line: TSS, dash: "dash", w: 1.2, lane: true },
  navigation_line: { line: INK, dash: "dash", w: 1, o: 0.7 },
  fairway: { line: MAG, dash: "dash", w: 1, o: 0.5, fill: "#FFFFFF", fo: 0.12 },
  dredged_area: { line: "#5E97F6", dash: "dot", w: 1, fill: "#FFFFFF", fo: 0.18 },
  restricted_area: { line: MAG, dash: "dash", w: 1.3, o: 0.8, fill: MAG, fo: 0.04 },
  military_area: { line: C.red, dash: "dash", w: 1.3, o: 0.8, fill: C.red, fo: 0.04 },
  anchorage: { line: MAG, dash: "dash", w: 1.3, o: 0.8, icon: "sm-anchorage" },
  anchor_berth: { line: MAG, dash: "dash", w: 1.1, o: 0.7, icon: "sm-anchorage" },
  marine_farm: { line: "#5F6368", dash: "dot", w: 1.2, fill: "#5F6368", fo: 0.06 },
  cable_submarine: { line: MAG, dash: "dash", w: 1.1, o: 0.65 },
  cable_area: { line: MAG, dash: "dash", w: 1, o: 0.5 },
  pipeline_submarine: { line: "#7B5EA7", dash: "dot", w: 1.6, o: 0.7 },
  pipeline_area: { line: "#7B5EA7", dash: "dot", w: 1, o: 0.5 },
  cable_overhead: { line: "#5F6368", dash: "dash", w: 1, o: 0.7 },
  obstruction: { line: INK, dash: "dot", w: 1.2, o: 0.8 },
  shoreline_construction: { line: "#80868B", dash: "solid", w: 3, o: 0.9 },
  mooring: { line: C.orange, dash: "solid", w: 1.6, o: 0.8 },
  seaplane_landing_area: { line: SEA, dash: "dash", w: 1.2 },
  sea_area: null, harbour: null, small_craft_facility: null, landmark: null,
};

const lightKeys = t => {
  const lights = [];
  for (const k in t) {
    const m = /^seamark:light:(?:(\d+):)?colour$/.exec(k);
    if (!m) continue;
    const p = m[1] ? `seamark:light:${m[1]}:` : "seamark:light:";
    lights.push({ colour: t[k].split(";")[0], start: parseFloat(t[p + "sector_start"]), end: parseFloat(t[p + "sector_end"]), range: parseFloat(t[p + "range"]),
      character: t[p + "character"], group: t[p + "group"], period: t[p + "period"], height: t[p + "height"], orientation: parseFloat(t[p + "orientation"]) });
  }
  return lights;
};
const SHORT = { white: "W", red: "R", green: "G", yellow: "Y", blue: "Bu", orange: "Or", violet: "Vi" };
function characteristic(lights) {
  if (!lights.length) return "";
  const l = lights.find(x => x.character) || lights[0];
  const colours = [...new Set(lights.map(x => SHORT[x.colour] || ""))].join("");
  const ch = (l.character || "") + (l.group ? `(${l.group})` : "");
  const rng = Math.max(...lights.map(x => x.range || 0));
  return [ch ? ch + (colours ? "." : "") + colours : colours, l.period ? l.period + "s" : "", l.height ? l.height + "m" : "", rng ? rng + "M" : ""].filter(Boolean).join(" ");
}

/** One mark from its tags: which icon, how important, its name and characteristic. */
function pointOf(t) {
  const type = t["seamark:type"] || "";
  const lights = lightKeys(t);
  const lit = lights.length ? (lights.find(l => l.colour && l.colour !== "white") || lights[0]).colour : "";
  const name = t["seamark:name"] || t["name:en"] || t.name || "";
  let icon = null, tier = 3, anchor = "center";
  const m = BUOYS.exec(type);
  if (m || type === "light_float" || type === "light_vessel") {
    const kind = m?.[2] || "light_float", beacon = m?.[1] === "beacon", pre = `seamark:${type}:`;
    const cat = t[pre + "category"] || "", sys = (t[pre + "system"] || "iala-a").toLowerCase();
    let colours = (t[pre + "colour"] || "").split(";").filter(Boolean), pattern = t[pre + "colour_pattern"] || "", shape = t[pre + "shape"] || "";
    let tm = topmarkKind(t["seamark:topmark:shape"]), tmColour = (t["seamark:topmark:colour"] || "").split(";")[0];
    if (kind === "lateral") {
      const port = cat.includes("port") ? !cat.startsWith("preferred_channel_starboard") : !cat.includes("starboard") ? null : false;
      const red = (port === true) === (sys !== "iala-b");
      if (!colours.length) colours = port == null ? ["grey"] : [red ? "red" : "green"];
      if (!shape) shape = beacon ? "stake" : port ? "can" : "conical";
      if (!tm && port != null && !beacon) tm = port ? "can" : "up";
    } else if (kind === "cardinal") {
      const dir = cat.replace("cardinal_", "");
      if (!colours.length) colours = { north: ["black", "yellow"], south: ["yellow", "black"], east: ["black", "yellow", "black"], west: ["yellow", "black", "yellow"] }[dir] || ["yellow", "black"];
      if (!tm) tm = { north: "2up", south: "2down", east: "base", west: "point" }[dir] || "";
      tmColour = tmColour || "black";
      if (!shape) shape = beacon ? "stake" : "pillar";
    } else if (kind === "isolated_danger") {
      if (!colours.length) colours = ["black", "red", "black"];
      tm = tm || "2ball"; tmColour = tmColour || "black"; if (!shape) shape = beacon ? "stake" : "pillar";
    } else if (kind === "safe_water") {
      if (!colours.length) { colours = ["red", "white"]; pattern = pattern || "vertical"; }
      tm = tm || "ball"; tmColour = tmColour || "red"; if (!shape) shape = beacon ? "stake" : "spherical";
    } else if (kind === "special_purpose") {
      if (!colours.length) colours = ["yellow"];
      tm = tm || (beacon ? "" : "x"); tmColour = tmColour || "yellow"; if (!shape) shape = beacon ? "stake" : "can";
    } else {
      if (!colours.length) colours = type === "light_vessel" ? ["red"] : ["grey"];
      if (!shape) shape = type === "light_vessel" ? "super" : beacon ? "stake" : "pillar";
    }
    const body = BODY_OF[shape] || (beacon ? "stake" : "pillar");
    pattern = pattern.includes("vertical") ? "vertical" : "horizontal";
    // Light floats and light vessels are lit by definition, even when the light isn't tagged.
    const spec = { body, colours: colours.slice(0, 4), pattern, tm, tmColour, light: lit || (kind === "light_float" ? "white" : "") };
    icon = "sm-b-" + [body, spec.colours.join("."), pattern, tm, tmColour, lit].join("-");
    BUOY_SPECS.set(icon, spec);
    tier = kind === "cardinal" || kind === "isolated_danger" || kind === "safe_water" || type === "light_vessel" ? 1 : kind === "lateral" && !beacon ? 2 : 3;
    anchor = "bottom";
  } else if (type === "light_major" || type === "light_minor" || type === "light" || (t.man_made === "lighthouse")) {
    const c = FLARE[lit] ? lit : "white";
    if (t.man_made === "lighthouse" || (type === "light_major" && /lighthouse|tower/.test(t["seamark:building:function"] || t["seamark:landmark:category"] || ""))) { icon = `sm-lighthouse-${c}`; anchor = "bottom"; tier = 1; }
    else { icon = `sm-light-${type === "light_major" ? "major" : "minor"}-${c}`; tier = type === "light_major" ? 1 : 2; }
  } else if (type === "rock") { icon = /awash/.test(t["seamark:rock:water_level"] || "") ? "sm-rock-awash" : "sm-rock"; tier = 3; }
  else if (type === "wreck") { icon = "sm-wreck"; tier = 3; }
  else if (type === "obstruction") { icon = "sm-obstruction"; tier = 4; }
  else if (type === "mooring") { icon = "sm-mooring"; tier = 4; }
  else if (type === "harbour") { const c = t["seamark:harbour:category"] || ""; icon = c.includes("marina") ? "sm-marina" : "sm-harbour"; tier = 2; }
  else if (type === "anchorage" || type === "anchor_berth") { icon = "sm-anchorage"; tier = 3; }
  else if (type === "small_craft_facility") { const c = (t["seamark:small_craft_facility:category"] || "info").split(";")[0]; icon = "sm-f-" + (GLYPHS[c] ? c : "info"); tier = 4; }
  else if (type === "notice") { icon = /prohib/.test(t["seamark:notice:function"] || "") ? "sm-notice-no" : "sm-notice-info"; anchor = "bottom"; tier = 4; }
  else if (type === "building" && /harbour_master/.test(t["seamark:building:function"] || "")) { icon = "sm-hm"; tier = 4; }
  else if (type === "rescue_station") { icon = "sm-rescue"; tier = 3; }
  else if (type === "coastguard_station") { icon = "sm-coastguard"; tier = 3; }
  else if (/^signal_station/.test(type) || type === "vessel_traffic_service") { icon = "sm-signal"; tier = 4; }
  else if (type === "radar_station" || type === "radar_transponder" || type === "radar_reflector") { icon = "sm-radar"; tier = 4; }
  else if (type === "radio_station") { icon = "sm-station"; tier = 4; }
  else if (type === "landmark" || type === "building") {
    const cat = (t["seamark:landmark:category"] || t["seamark:building:function"] || "").split(";")[0];
    if (/harbour_master/.test(cat)) { icon = "sm-hm"; tier = 4; }
    else if (/customs/.test(cat)) { icon = "sm-customs"; tier = 4; }
    else { const k = Object.keys(LANDMARKS).find(k => cat.includes(k)) || (t["seamark:landmark:function"] === "church" ? "church" : "tower"); icon = "sm-lm-" + k; tier = 3; }
  }
  else if (type === "distance_mark") { icon = "sm-distance"; tier = 4; }
  else if (type === "berth") { icon = "sm-berth"; tier = 4; }
  else if (type === "crane") { icon = "sm-crane"; tier = 4; }
  else if (type === "fog_signal") { icon = "sm-fog"; tier = 3; }
  else if (type === "pilot_boarding") { icon = "sm-pilot"; tier = 3; }
  else if (type === "platform" || type === "offshore_platform") { icon = "sm-platform"; tier = 2; }
  else if (type === "calling-in_point" || type === "calling_in_point") { icon = "sm-callin"; tier = 3; }
  else if (type === "fishing_facility") { icon = "sm-fishing"; tier = 4; }
  else if (type === "marine_farm") { icon = "sm-farm"; tier = 4; }
  else if (type === "hulk") { icon = "sm-hulk"; tier = 4; }
  else if (type === "daymark" || type === "topmark") { icon = "sm-daymark"; tier = 4; }
  else if (type === "pile") { icon = "sm-pile"; tier = 4; }
  else if (type === "bridge") { icon = "sm-bridge"; tier = 4; }
  else if (type === "lock_basin" || type === "lock_basin_part") { icon = "sm-lock"; tier = 4; }
  else if (type === "gate") { icon = "sm-gate"; tier = 4; }
  else if (type === "seaplane_landing_area") { icon = "sm-seaplane"; tier = 4; }
  else if (t.blue_flag === "yes") { icon = "sm-blueflag"; tier = 2; }
  else if (t.leisure === "slipway") { icon = "sm-f-slipway"; tier = 4; }
  else if (type) { icon = "sm-dot"; tier = 4; } // any other kind of sea mark
  else return null;
  const ch = characteristic(lights);
  return { icon, tier, anchor, name, label: [name, ch].filter(Boolean).join("\n"), lights };
}
const BUOY_SPECS = new Map();
/** A buoy's drawing from its icon id ("sm-b-<body>-<colours>-<pattern>-<topmark>-<topmark colour>-<light>"). */
function specFromId(id) {
  const [body, colours, pattern, tm, tmColour, light] = id.slice(5).split("-");
  return { body, colours: colours ? colours.split(".") : [], pattern, tm, tmColour, light };
}
/** How to draw an icon id, for icons.js (null if it isn't a sea mark). */
export const iconDef = id => id.startsWith("sm-b-") ? () => ({ svg: buoySvg(BUOY_SPECS.get(id) || specFromId(id)), w: 30, h: 48, ratio: 3 }) : STATIC[id] ? staticDef(id) : null;

/** Overpass elements → GeoJSON features (points; lines and areas), plus the lights that have sectors. */
export function featuresOf(elements) {
  const out = [];
  for (const el of elements) {
    const t = el.tags || {}, type = t["seamark:type"] || "";
    const geom = el.geometry?.map(p => [p.lon, p.lat]);
    const style = AREA_STYLE[type];
    if (geom && geom.length > 1 && style) {
      const closed = geom.length > 3 && geom[0][0] === geom.at(-1)[0] && geom[0][1] === geom.at(-1)[1];
      const props = { k: type, line: style.line, w: style.w, o: style.o ?? 1, dash: style.dash, lane: style.lane && !closed ? 1 : 0, name: t["seamark:name"] || t.name || "" };
      if (closed && style.fill) out.push({ type: "Feature", id: el.type + el.id + "f", geometry: { type: "Polygon", coordinates: [geom] }, properties: { ...props, fill: style.fill, fo: style.fo } });
      if (style.dash !== "none") out.push({ type: "Feature", id: el.type + el.id, geometry: { type: "LineString", coordinates: geom }, properties: props });
      if (style.icon) { const c = centroid(geom); out.push({ type: "Feature", id: el.type + el.id + "i", geometry: { type: "Point", coordinates: c }, properties: { icon: style.icon, tier: 3, anchor: "center", name: props.name, label: props.name } }); }
      continue;
    }
    const p = pointOf(t);
    if (!p) continue;
    const c = el.lat != null ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : geom ? centroid(geom) : null;
    if (!c) continue;
    const { lights, ...props } = p;
    // Light sectors travel as text ("start,end,colour;…") so they fit in vector tiles; the map draws the arcs.
    const sec = lights.filter(l => isFinite(l.start) && isFinite(l.end)).map(l => `${l.start},${l.end},${l.colour || ""}`).join(";");
    if (sec) { props.sec = sec; props.maj = t["seamark:type"] === "light_major" ? 1 : 0; }
    props.oid = el.type[0] + el.id;
    out.push({ type: "Feature", id: el.type + el.id, geometry: { type: "Point", coordinates: c }, properties: props });
  }
  return out;
}
function centroid(g) { let x = 0, y = 0; for (const p of g) { x += p[0]; y += p[1]; } return [x / g.length, y / g.length]; }

export { FLARE, MAG, STATIC };
