// Textures for areas, drawn on demand: a small transparent tile repeated over the area, on top of
// its colour. Names are "pat-<kind>-<theme>" (the map asks for them through "styleimagemissing").

const INK = {
  light: { tree: "rgba(38,110,58,.30)", treeEdge: "rgba(38,110,58,.45)", crop: "rgba(122,140,58,.28)", orchard: "rgba(56,122,52,.42)", vine: "rgba(96,120,40,.5)",
    cross: "rgba(80,96,84,.45)", reed: "rgba(46,120,140,.45)", bush: "rgba(92,110,52,.35)", sand: "rgba(160,128,72,.35)", rock: "rgba(110,104,96,.35)",
    ice: "rgba(90,150,200,.35)", plot: "rgba(70,120,60,.35)", military: "rgba(200,60,60,.30)", quarry: "rgba(110,104,96,.30)", heath: "rgba(140,90,110,.3)" },
  dark: { tree: "rgba(120,200,140,.18)", treeEdge: "rgba(120,200,140,.28)", crop: "rgba(200,210,140,.14)", orchard: "rgba(140,210,130,.26)", vine: "rgba(190,210,120,.28)",
    cross: "rgba(200,210,200,.28)", reed: "rgba(120,190,210,.3)", bush: "rgba(170,190,120,.22)", sand: "rgba(220,200,150,.2)", rock: "rgba(200,195,190,.2)",
    ice: "rgba(160,200,240,.25)", plot: "rgba(150,200,140,.22)", military: "rgba(240,110,110,.28)", quarry: "rgba(200,195,190,.2)", heath: "rgba(210,160,190,.22)" },
};

const DRAW = {
  // Tree crowns, staggered.
  forest(g, c, S) { for (const [x, y, r] of [[6, 7, 4], [18, 5, 3.5], [12, 17, 4.2], [26, 15, 3.6], [4, 26, 3.4], [21, 27, 4]]) { g.fillStyle = c.tree; g.strokeStyle = c.treeEdge; g.lineWidth = 0.8; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); } },
  // Ploughed rows.
  crop(g, c, S) { g.strokeStyle = c.crop; g.lineWidth = 1; for (let y = 2; y < S; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } },
  // Fruit trees in a grid.
  orchard(g, c, S) { g.fillStyle = c.orchard; for (let y = 4; y < S; y += 10) for (let x = (y / 10 % 2 ? 9 : 4); x < S; x += 10) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); } },
  // Vines in dotted rows.
  vineyard(g, c, S) { g.fillStyle = c.vine; for (let y = 3; y < S; y += 6) for (let x = 1; x < S; x += 3) g.fillRect(x, y, 1.4, 1.4); },
  // Crosses.
  cemetery(g, c, S) { g.strokeStyle = c.cross; g.lineWidth = 1.1; for (const [x, y] of [[8, 8], [24, 22]]) { g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y + 4); g.moveTo(x - 2.6, y - 1.5); g.lineTo(x + 2.6, y - 1.5); g.stroke(); } },
  // Reed tufts over water lines.
  wetland(g, c, S) { g.strokeStyle = c.reed; g.lineWidth = 1; for (const [x, y] of [[6, 10], [22, 26]]) { g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y); g.lineTo(x, y - 4); g.moveTo(x, y); g.lineTo(x - 2.5, y - 3.5); g.moveTo(x, y); g.lineTo(x + 2.5, y - 3.5); g.stroke(); } },
  // Scattered bushes.
  scrub(g, c, S) { g.fillStyle = c.bush; for (const [x, y, r] of [[5, 6, 2.2], [17, 10, 1.8], [27, 4, 2], [10, 20, 2.4], [24, 24, 2], [3, 29, 1.6], [16, 30, 1.8]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } },
  heath(g, c, S) { g.fillStyle = c.heath; for (const [x, y] of [[4, 5], [14, 9], [26, 6], [8, 18], [20, 20], [28, 28], [12, 28]]) { g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill(); } },
  // Sand stipple.
  sand(g, c, S) { g.fillStyle = c.sand; for (const [x, y] of [[3, 4], [11, 2], [20, 6], [28, 3], [6, 13], [15, 11], [25, 14], [2, 21], [12, 19], [21, 23], [29, 20], [7, 29], [17, 27], [26, 30]]) g.fillRect(x, y, 1.3, 1.3); },
  // Rock specks.
  rock(g, c, S) { g.fillStyle = c.rock; for (const [x, y] of [[4, 6], [16, 4], [26, 10], [9, 18], [20, 20], [3, 27], [15, 29], [28, 26]]) { g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x + 2, y + 1.5); g.lineTo(x - 2, y + 1.5); g.closePath(); g.fill(); } },
  // Crevasses.
  glacier(g, c, S) { g.strokeStyle = c.ice; g.lineWidth = 1; for (const [x, y] of [[3, 6], [17, 14], [6, 24], [22, 28]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y); g.stroke(); } },
  // Garden plots.
  allotments(g, c, S) { g.strokeStyle = c.plot; g.lineWidth = 1; for (let y = 1; y < S; y += 8) for (let x = 1; x < S; x += 8) g.strokeRect(x + 0.5, y + 0.5, 6, 6); },
  // Hatching.
  military(g, c, S) { g.strokeStyle = c.military; g.lineWidth = 1.6; for (let k = -S; k < S; k += 8) { g.beginPath(); g.moveTo(k, S); g.lineTo(k + S, 0); g.stroke(); } },
  quarry(g, c, S) { g.strokeStyle = c.quarry; g.lineWidth = 1; for (let k = -S; k < S * 2; k += 5) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k - S, S); g.stroke(); } },
};

export function patternImage(map, id) {
  const [, kind, theme] = id.match(/^pat-(\w+)-(\w+)$/) || [];
  if (!DRAW[kind]) return;
  const px = 2, S = 32, c = document.createElement("canvas");
  c.width = c.height = S * px;
  const g = c.getContext("2d");
  g.scale(px, px);
  DRAW[kind](g, INK[theme] || INK.light, S);
  map.addImage(id, { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data }, { pixelRatio: px });
}
