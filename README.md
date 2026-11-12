# Wayfinder

Public transport on an open map, as a website: every line in view drawn like a metro map, live
departures, line diagrams and journey planning. Live at **https://fran2402.github.io/wayfinder/**.

No build step: it is plain HTML, CSS and JavaScript modules, so every file can be read and changed
as it is. Push to `main` and the "Publish site" workflow puts it on GitHub Pages.

## What it does

- Every line in view drawn like a metro map (lines on the same street glued side by side), only the ones running now.
- Moving vehicles, live: every bus, tram and train on its way; tap one for its trip.
- Departure boards with live and late times; stations that share a name are one station.
- Whole-line diagrams with branches; journey planning by public transport, walking or cycling.
- Links for stops, places and lines; the browser's Back steps through screens.
- Search in the bar (`/` or Ctrl/⌘ K), breadcrumbs for the way back, a status line with what is live; works offline once loaded and installs like an app.

## Run it locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

(Opening `index.html` straight from disk doesn't work: browsers block JavaScript modules from `file://`.)

## Where things are

| File | What it does |
|---|---|
| `index.html` | The page: map, search bar, panel/sheet, icons (Phosphor, inline) |
| `css/app.css` | All styling. Colour tokens at the top (light, and `[data-theme="dark"]`) |
| `js/app.js` | The interface: screens, sheet, search, departures, directions, settings |
| `js/network.js` | The transit network on the map (main thread): which tiles to load, map layers, stop markers |
| `js/net-worker.js` | The heavy part, in a Web Worker: downloads lines, lays every shape onto a shared corridor graph, glues lines side by side, groups stops with the same name into stations |
| `js/diagram.js` | The line diagram (track, shared strands, connecting ticks, capsules) |
| `js/lines.js` | Modes, line colours (palette for lines without one), badges |
| `js/basemap.js` | The base map style (OpenStreetMap via OpenFreeMap), light and dark |
| `js/api.js` | Calls to the Transitous API |
| `vendor/maplibre-gl/` | MapLibre GL JS 5.24.0 (BSD-3-Clause), kept in the repo so nothing depends on a CDN |

In the browser console, `wayfinder.map`, `wayfinder.net` and `wayfinder.stack` let you inspect the
map, the loaded network and the current screens.

## Data

- Timetables, live times, routing and line shapes: [Transitous](https://transitous.org) (community-run, free; please use it fairly).
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by [OpenFreeMap](https://openfreemap.org) © OpenMapTiles.
- Fonts: Inter Tight and JetBrains Mono (Google Fonts). Icons: [Phosphor](https://phosphoricons.com) (MIT).
