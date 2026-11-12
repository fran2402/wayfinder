#!/usr/bin/env python3
"""Ski data for Wayfinder: OpenSkiMap's daily OpenStreetMap extracts (runs, lifts, ski areas),
slimmed to what the map draws, as line-delimited GeoJSON for tippecanoe.

  python3 tools/build-ski.py <dir with runs.geojson lifts.geojson ski_areas.geojson> <out dir>

Runs get their colour here, by the resort's convention: Europe (green novice, blue easy, red
intermediate, black advanced), North America (green easy, blue intermediate, black advanced) and
Japan (green easy, red intermediate, black advanced). Data © OpenStreetMap contributors (ODbL),
prepared by OpenSkiMap.org.
"""
import json, os, sys

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

def features(name):
    """The file has one feature per line (between "," lines): read it without loading it whole."""
    with open(os.path.join(src, name), encoding="utf-8") as f:
        for line in f:
            line = line.strip().rstrip(",")
            if line.startswith('{"type":"Feature"') or line.startswith('{"properties"'):
                try:
                    yield json.loads(line)
                except ValueError:
                    pass

GREEN, BLUE, RED, BLACK, ORANGE, GREY = "#2E9E44", "#1F6FE0", "#E0332F", "#202124", "#F28C28", "#7B7F86"
COLOURS = {
    "europe": {"novice": GREEN, "easy": BLUE, "intermediate": RED, "advanced": BLACK, "expert": BLACK, "freeride": ORANGE, "extreme": ORANGE},
    "north_america": {"novice": GREEN, "easy": GREEN, "intermediate": BLUE, "advanced": BLACK, "expert": BLACK, "freeride": ORANGE, "extreme": ORANGE},
    "japan": {"novice": GREEN, "easy": GREEN, "intermediate": RED, "advanced": BLACK, "expert": BLACK, "freeride": ORANGE, "extreme": ORANGE},
}
OTHER = {"nordic": ("#2B7BB9", "dash", 1.7), "skitour": ("#B5541C", "dash", 1.6), "sled": ("#8E5C3E", "dash", 1.8), "sleigh": ("#8E5C3E", "dash", 1.6),
         "hike": ("#C2408F", "dot", 1.6), "snow_park": (ORANGE, "solid", 2.4), "playground": (GREEN, "solid", 2.0), "fatbike": (GREY, "dot", 1.4),
         "connection": (GREY, "dot", 1.2), "ice_skate": ("#5E97F6", "solid", 1.6)}
PRIORITY = ["downhill", "snow_park", "playground", "nordic", "skitour", "sled", "sleigh", "hike", "fatbike", "ice_skate", "connection"]
NA = {"US", "CA"}

def convention_by_country(f):
    for p in f["properties"].get("places") or []:
        cc = p.get("iso3166_1Alpha2")
        if cc in NA: return "north_america"
        if cc == "JP": return "japan"
    return "europe"

def flat(geom):
    """Drop the elevation from coordinates."""
    def strip(c):
        return [strip(x) for x in c] if c and isinstance(c[0], list) else c[:2]
    return {"type": geom["type"], "coordinates": strip(geom["coordinates"])}

def centroid(geom):
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
    return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]

def write(fh, geom, props, minzoom):
    # (Which zooms each layer starts at is set with tippecanoe's -j filter: see tools/build-ski.sh.)
    fh.write(json.dumps({"type": "Feature", "geometry": geom, "properties": props}, separators=(",", ":"), ensure_ascii=False) + "\n")

# Ski areas: their outline, a label point, and their run colour convention.
conv = {}
n = 0
with open(os.path.join(out, "areas.ndjson"), "w") as fa, open(os.path.join(out, "labels.ndjson"), "w") as fl:
    for f in features("ski_areas.geojson"):
        p = f["properties"]
        if p.get("status") not in (None, "operating"): continue
        conv[p["id"]] = p.get("runConvention") or convention_by_country(f)
        g = f.get("geometry")
        if not g: continue
        acts = p.get("activities") or []
        props = {"n": p.get("name") or "", "a": "downhill" if "downhill" in acts else (acts[0] if acts else "")}
        if g["type"] in ("Polygon", "MultiPolygon"):
            write(fa, flat(g), props, 7)
            pt = centroid(g)
        else:
            pt = g["coordinates"][:2]
        if props["n"]:
            stats = (p.get("statistics") or {}).get("runs") or {}
            props["top"] = round((p.get("statistics") or {}).get("maxElevation") or 0)
            write(fl, {"type": "Point", "coordinates": pt}, props, 5 if props["a"] == "downhill" else 8)
        n += 1
print("ski areas", n)

n = 0
with open(os.path.join(out, "runs.ndjson"), "w") as fr:
    for f in features("runs.geojson"):
        p = f["properties"]
        if p.get("status") not in (None, "operating"): continue
        uses = p.get("uses") or []
        use = next((u for u in PRIORITY if u in uses), uses[0] if uses else "")
        diff = p.get("difficulty") or ""
        if use == "downhill":
            areas = p.get("skiAreas") or []
            c = next((conv[a["properties"]["id"]] for a in areas if a.get("properties", {}).get("id") in conv), None) or convention_by_country(f)
            col = COLOURS[c].get(diff, GREY)
            kind = "dash" if diff in ("freeride", "extreme") else "solid"
            w = 2.6
        else:
            col, kind, w = OTHER.get(use, (GREY, "dot", 1.2))
        props = {"u": use, "d": diff, "col": col, "k": kind, "w": w, "n": p.get("name") or "", "r": (p.get("ref") or "")[:3], "x": 1 if diff == "expert" else 0}
        write(fr, flat(f["geometry"]), props, 9 if use == "downhill" else 11)
        n += 1
print("runs", n)

n = 0
with open(os.path.join(out, "lifts.ndjson"), "w") as fl:
    for f in features("lifts.geojson"):
        p = f["properties"]
        if p.get("status") not in (None, "operating"): continue
        write(fl, flat(f["geometry"]), {"t": p.get("liftType") or "", "n": p.get("name") or "", "r": (p.get("ref") or "")[:4]}, 9)
        n += 1
print("lifts", n)
