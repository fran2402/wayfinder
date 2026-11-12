// Live vehicles: a marker in the line's colour that points the way it's going (rotated by its bearing),
// with the kind of vehicle inside (Phosphor icons, fill weight, MIT) — or its line number when close.

import { ensure } from "./icons.js";

const GLYPH = {"bus":"M248,80v24a8,8,0,0,1-16,0V80a8,8,0,0,1,16,0ZM16,72a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V80A8,8,0,0,0,16,72Zm200-8V208a16,16,0,0,1-16,16H184a16,16,0,0,1-16-16v-8H88v8a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V64A32,32,0,0,1,72,32H184A32,32,0,0,1,216,64ZM104,148a12,12,0,1,0-12,12A12,12,0,0,0,104,148Zm72,0a12,12,0,1,0-12,12A12,12,0,0,0,176,148Zm24-76H56v40H200Z","tram":"M184,48H136V24h32a8,8,0,0,0,0-16H88a8,8,0,0,0,0,16h32V48H72A32,32,0,0,0,40,80V184a32,32,0,0,0,32,32h8L65.6,235.2a8,8,0,1,0,12.8,9.6L100,216h56l21.6,28.8a8,8,0,1,0,12.8-9.6L176,216h8a32,32,0,0,0,32-32V80A32,32,0,0,0,184,48Zm0,152H72a16,16,0,0,1-16-16V128H200v56A16,16,0,0,1,184,200ZM96,172a12,12,0,1,1-12-12A12,12,0,0,1,96,172Zm88,0a12,12,0,1,1-12-12A12,12,0,0,1,184,172Z","train":"M184,24H72A32,32,0,0,0,40,56V184a32,32,0,0,0,32,32h8L65.6,235.2a8,8,0,1,0,12.8,9.6L100,216h56l21.6,28.8a8,8,0,1,0,12.8-9.6L176,216h8a32,32,0,0,0,32-32V56A32,32,0,0,0,184,24ZM84,184a12,12,0,1,1,12-12A12,12,0,0,1,84,184Zm36-64H56V80h64Zm52,64a12,12,0,1,1,12-12A12,12,0,0,1,172,184Zm28-64H136V80h64Z","metro":"M156,176V152h20v16a8,8,0,0,1-8,8Zm-16,0V152H116v24Zm36-88a8,8,0,0,0-8-8H88a8,8,0,0,0-8,8v48h96ZM152,24H104A72,72,0,0,0,32,96V208a8,8,0,0,0,8,8H76.58a4,4,0,0,0,3.58-2.21L91.06,192H88a24,24,0,0,1-24-24V88A24,24,0,0,1,88,64h80a24,24,0,0,1,24,24v80a24,24,0,0,1-24,24h-3.06l10.9,21.79a4,4,0,0,0,3.58,2.21H216a8,8,0,0,0,8-8V96A72,72,0,0,0,152,24Zm-4.94,168H108.94l-9.1,18.21a4,4,0,0,0,3.58,5.79h49.16a4,4,0,0,0,3.58-5.79ZM80,168a8,8,0,0,0,8,8h12V152H80Z","ferry":"M221.06,110.59,208,106.23V56a16,16,0,0,0-16-16H136V24a8,8,0,0,0-16,0V40H64A16,16,0,0,0,48,56v50.23l-13.06,4.36A16,16,0,0,0,24,125.77V152c0,61.54,97.89,86.72,102.06,87.76a8,8,0,0,0,3.88,0C134.11,238.72,232,213.54,232,152V125.77A16,16,0,0,0,221.06,110.59ZM136,168a8,8,0,0,1-16,0V104.87a8,8,0,0,1,16,0Zm56-67.1L130.53,80.41a8,8,0,0,0-5.06,0L64,100.9V56H192Z","other":"M247.87,30.59a8,8,0,0,0-9.28-6.46l-224,40A8,8,0,0,0,16,80a8.6,8.6,0,0,0,1.42-.12L120,61.56V96H64a32,32,0,0,0-32,32v64a32,32,0,0,0,32,32H192a32,32,0,0,0,32-32V128a32,32,0,0,0-32-32H136V58.7L241.4,39.88A8,8,0,0,0,247.87,30.59ZM104,160V112h48v48ZM64,112H88v48H48V128A16,16,0,0,1,64,112Zm144,16v32H168V112h24A16,16,0,0,1,208,128Z"};
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const light = hex => { const c = hex.replace("#", ""), r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16); return 0.299 * r + 0.587 * g + 0.114 * b > 170; };

/** The pointer: a disc with a nose, nose up (the map turns it). id "veh-<rrggbb>". */
function pointerDef(hex) {
  const c = "#" + hex, rim = light(c) ? "#5F6368" : "#fff";
  // A disc centred on the point (18,18), with a clear nose at the top: the direction of travel.
  const shape = `<circle cx="18" cy="18" r="9.6"/><path d="M18 1.8L25.2 12.1H10.8z"/>`;
  return { svg: svg(36, 36,
    `<g fill="rgba(0,0,0,.22)" stroke="rgba(0,0,0,.22)" stroke-width="4.4" stroke-linejoin="round" transform="translate(0 1)">${shape}</g>` +
    `<g fill="${rim}" stroke="${rim}" stroke-width="3.2" stroke-linejoin="round">${shape}</g>` +
    `<g fill="${c}">${shape}</g>`), w: 36, h: 36, ratio: 3 };
}
/** The vehicle kind, upright. id "vg-<cls>-<w|d>" (white or dark glyph). */
function glyphDef(cls, dark) {
  return { svg: svg(36, 36, `<path d="${GLYPH[cls] || GLYPH.bus}" fill="${dark ? "#111" : "#fff"}" transform="translate(11.6 11.6) scale(${12.8 / 256})"/>`), w: 36, h: 36, ratio: 3 };
}
/** Draw the icon a vehicle layer asks for (from styleimagemissing). True if it was one of these. */
export function vehicleIcon(id) {
  let m = /^veh-([0-9a-fA-F]{6})$/.exec(id);
  if (m) { ensure(id, () => pointerDef(m[1])); return true; }
  m = /^vg-(\w+)-([wd])$/.exec(id);
  if (m) { ensure(id, () => glyphDef(m[1], m[2] === "d")); return true; }
  return false;
}
export const isDarkText = hex => /^#[0-9a-fA-F]{6}$/.test(hex) && light(hex);
