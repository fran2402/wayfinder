#!/usr/bin/env python3
"""Writes js/placeicons.js: the map's place icons — a filled circle in the category's colour with a
white glyph — from Phosphor icons (fill weight, MIT licence).

  python3 tools/make-place-icons.py <phosphor-icons/core package dir>
"""
import json, os, re, sys

PH = os.path.join(sys.argv[1], "assets", "fill")

# Category colours.
FOOD, SHOP, STAY, HEALTH, CULTURE, NATURE, SPORT, LEARN, CIVIC, MONEY, MOVE, FAITH, SERVICE = (
    "#F07D1A", "#3A6FD8", "#D6457A", "#E0453A", "#12968F", "#2E9E52", "#249B78", "#8D6748", "#5C6BC0", "#4F7A5A", "#3F6AB5", "#7A6A9E", "#6E7681")

# key → (glyph, colour, label). Keys are an OpenMapTiles poi class, or "class/subclass" for a subclass.
ICONS = {
    "restaurant": ("fork-knife", FOOD, "Restaurant"), "fast_food": ("hamburger", FOOD, "Fast food"), "cafe": ("coffee", FOOD, "Café"),
    "bar": ("martini", FOOD, "Bar"), "bar/nightclub": ("disco-ball", FOOD, "Nightclub"), "beer": ("beer-stein", FOOD, "Pub"), "ice_cream": ("ice-cream", FOOD, "Ice cream"),
    "bakery": ("bread", FOOD, "Bakery"), "alcohol_shop": ("wine", SHOP, "Wine & spirits"), "butcher": ("knife", SHOP, "Butcher"),
    "grocery": ("shopping-cart", SHOP, "Groceries"), "grocery/marketplace": ("basket", SHOP, "Market"), "grocery/department_store": ("storefront", SHOP, "Department store"),
    "shop": ("storefront", SHOP, "Shop"), "shop/convenience": ("basket", SHOP, "Convenience store"), "shop/kiosk": ("newspaper", SHOP, "Kiosk"), "shop/newsagent": ("newspaper", SHOP, "Newsagent"),
    "shop/jewelry": ("diamond", SHOP, "Jewellery"), "shop/watches": ("watch", SHOP, "Watches"), "shop/florist": ("flower", SHOP, "Florist"), "shop/furniture": ("couch", SHOP, "Furniture"),
    "shop/shoes": ("sneaker", SHOP, "Shoes"), "shop/beauty": ("sparkle", SHOP, "Beauty"), "shop/cosmetics": ("sparkle", SHOP, "Cosmetics"), "shop/perfumery": ("drop", SHOP, "Perfumery"),
    "shop/optician": ("eyeglasses", HEALTH, "Optician"), "shop/mobile_phone": ("device-mobile", SHOP, "Phones"), "shop/electronics": ("monitor", SHOP, "Electronics"),
    "shop/computer": ("laptop", SHOP, "Computers"), "shop/toys": ("puzzle-piece", SHOP, "Toys"), "shop/gift": ("gift", SHOP, "Gifts"), "shop/sports": ("soccer-ball", SHOP, "Sports shop"),
    "shop/outdoor": ("mountains", SHOP, "Outdoor shop"), "shop/hardware": ("hammer", SHOP, "Hardware"), "shop/doityourself": ("hammer", SHOP, "DIY"), "shop/pet": ("paw-print", SHOP, "Pet shop"),
    "shop/travel_agency": ("airplane-tilt", SHOP, "Travel agency"), "shop/tobacco": ("cigarette", SHOP, "Tobacco"), "shop/chocolate": ("cookie", SHOP, "Chocolate"),
    "shop/confectionery": ("cookie", SHOP, "Sweets"), "shop/coffee": ("coffee-bean", SHOP, "Coffee shop"), "shop/ticket": ("ticket", SHOP, "Tickets"), "shop/photo": ("camera", SHOP, "Photo"),
    "shop/tattoo": ("pen-nib", SHOP, "Tattoo"), "shop/massage": ("hand-heart", HEALTH, "Massage"), "shop/mall": ("bag", SHOP, "Shopping centre"), "shop/chemist": ("flask", SHOP, "Chemist"),
    "shop/stationery": ("pencil", SHOP, "Stationery"), "shop/copyshop": ("printer", SHOP, "Copy shop"), "shop/antiques": ("hourglass", SHOP, "Antiques"), "shop/second_hand": ("recycle", SHOP, "Second-hand"),
    "shop/bicycle": ("bicycle", SHOP, "Bike shop"), "shop/motorcycle": ("motorcycle", SHOP, "Motorcycles"), "shop/hearing_aids": ("ear", HEALTH, "Hearing aids"),
    "shop/tailor": ("needle", SHOP, "Tailor"), "shop/fabric": ("needle", SHOP, "Fabric"), "shop/locksmith": ("key", SHOP, "Locksmith"), "shop/video_games": ("game-controller", SHOP, "Video games"),
    "clothing_store": ("t-shirt", SHOP, "Clothes"), "clothing_store/bag": ("handbag", SHOP, "Bags"), "hairdresser": ("scissors", SHOP, "Hairdresser"),
    "library": ("books", LEARN, "Library"), "library/books": ("book-open", SHOP, "Bookshop"), "music": ("music-notes", SHOP, "Music shop"), "bicycle": ("bicycle", SHOP, "Bike shop"),
    "car": ("car", MOVE, "Car dealer"), "car/car_repair": ("wrench", MOVE, "Car repair"), "car/car_parts": ("gear", MOVE, "Car parts"),
    "lodging": ("bed", STAY, "Hotel"), "lodging/hostel": ("bed", STAY, "Hostel"), "lodging/guest_house": ("house", STAY, "Guest house"), "lodging/motel": ("car", STAY, "Motel"),
    "campsite": ("tent", STAY, "Campsite"),
    "hospital": ("first-aid", HEALTH, "Hospital"), "hospital/clinic": ("first-aid-kit", HEALTH, "Clinic"), "hospital/nursing_home": ("heart", HEALTH, "Nursing home"),
    "doctors": ("stethoscope", HEALTH, "Doctor"), "dentist": ("tooth", HEALTH, "Dentist"), "pharmacy": ("pill", HEALTH, "Pharmacy"), "veterinary": ("paw-print", HEALTH, "Vet"),
    "museum": ("bank", CULTURE, "Museum"), "art_gallery": ("palette", CULTURE, "Gallery"), "art_gallery/artwork": ("paint-brush", CULTURE, "Artwork"), "theatre": ("mask-happy", CULTURE, "Theatre"),
    "cinema": ("film-slate", CULTURE, "Cinema"), "attraction": ("star", CULTURE, "Attraction"), "attraction/viewpoint": ("binoculars", CULTURE, "Viewpoint"),
    "castle": ("castle-turret", CULTURE, "Castle"), "monument": ("flag", CULTURE, "Monument"), "aquarium": ("fish", CULTURE, "Aquarium"), "zoo": ("paw-print", NATURE, "Zoo"),
    "escape_game": ("lock-key", CULTURE, "Escape room"), "town_hall": ("buildings", CIVIC, "Town hall"), "town_hall/courthouse": ("scales", CIVIC, "Court"),
    "town_hall/community_centre": ("users-three", CIVIC, "Community centre"),
    "place_of_worship": ("hands-praying", FAITH, "Place of worship"), "place_of_worship/christian": ("church", FAITH, "Church"),
    "place_of_worship/jewish": ("star-of-david", FAITH, "Synagogue"), "place_of_worship/muslim": ("moon-stars", FAITH, "Mosque"),
    "school": ("student", LEARN, "School"), "school/kindergarten": ("baby", LEARN, "Kindergarten"), "college": ("graduation-cap", LEARN, "University"),
    "park": ("tree", NATURE, "Park"), "garden": ("flower-tulip", NATURE, "Garden"), "playground": ("smiley", NATURE, "Playground"), "dog_park": ("dog", NATURE, "Dog park"),
    "picnic_site": ("tree-evergreen", NATURE, "Picnic site"), "shelter": ("house-line", NATURE, "Shelter"), "cemetery": ("cross", NATURE, "Cemetery"),
    "sports_centre": ("barbell", SPORT, "Sports centre"), "fitness": ("barbell", SPORT, "Gym"), "yoga": ("person-simple-tai-chi", SPORT, "Yoga"), "stadium": ("soccer-ball", SPORT, "Stadium"),
    "pitch": ("soccer-ball", SPORT, "Sports pitch"), "pitch/basketball": ("basketball", SPORT, "Basketball"), "pitch/tennis": ("tennis-ball", SPORT, "Tennis"),
    "pitch/table_tennis": ("ping-pong", SPORT, "Table tennis"), "pitch/volleyball": ("volleyball", SPORT, "Volleyball"), "pitch/skateboard": ("person-simple-ski", SPORT, "Skate park"),
    "golf": ("golf", SPORT, "Golf"), "swimming_pool": ("swimming-pool", SPORT, "Swimming pool"), "water_park": ("swimming-pool", SPORT, "Water park"), "ice_rink": ("snowflake", SPORT, "Ice rink"),
    "running": ("person-simple-run", SPORT, "Running"), "cycling": ("bicycle", SPORT, "Cycling"), "tennis": ("tennis-ball", SPORT, "Tennis"), "basketball": ("basketball", SPORT, "Basketball"),
    "bank": ("bank", MONEY, "Bank"), "atm": ("money", MONEY, "ATM"),
    "post": ("envelope-simple", SERVICE, "Post office"), "post/post_box": ("mailbox", SERVICE, "Post box"), "post/parcel_locker": ("package", SERVICE, "Parcel locker"),
    "police": ("police-car", CIVIC, "Police"), "fire_station": ("fire-truck", HEALTH, "Fire station"), "toilets": ("toilet", SERVICE, "Toilets"),
    "drinking_water": ("drop", SERVICE, "Drinking water"), "information": ("info", SERVICE, "Information"), "laundry": ("washing-machine", SERVICE, "Laundry"),
    "telephone": ("phone", SERVICE, "Telephone"), "recycling": ("recycle", SERVICE, "Recycling"), "office": ("briefcase", SERVICE, "Office"), "hackerspace": ("cpu", SERVICE, "Hackerspace"),
    "fuel": ("gas-pump", MOVE, "Fuel"), "fuel/charging_station": ("charging-station", MOVE, "EV charging"), "parking": ("letter-circle-p", MOVE, "Parking"),
    "bicycle_parking": ("bicycle", MOVE, "Bike parking"), "bicycle_rental": ("bicycle", MOVE, "Bike rental"), "motorcycle_parking": ("motorcycle", MOVE, "Motorbike parking"),
    "ferry_terminal": ("boat", MOVE, "Ferry"), "harbor": ("anchor", MOVE, "Marina"), "bus": ("bus", MOVE, "Bus stop"), "railway": ("train", MOVE, "Station"),
    "entrance": ("subway", MOVE, "Station entrance"), "aerialway": ("cable-car", MOVE, "Lift station"),
}
FALLBACK = {"parking": "car", "charging-station": "lightning", "disco-ball": "music-notes", "letter-circle-p": "car", "hands-praying": "church", "moon-stars": "moon",
            "star-of-david": "star", "person-simple-tai-chi": "person", "ping-pong": "soccer-ball", "volleyball": "soccer-ball", "tennis-ball": "soccer-ball", "golf": "flag",
            "cable-car": "mountains", "fire-truck": "fire", "police-car": "shield", "washing-machine": "t-shirt", "needle": "scissors", "mailbox": "envelope-simple",
            "subway": "train", "castle-turret": "flag", "first-aid-kit": "first-aid", "swimming-pool": "drop", "cigarette": "storefront", "person-simple-ski": "person"}

def path_of(name):
    for n in (name, FALLBACK.get(name)):
        if not n: continue
        f = os.path.join(PH, f"{n}-fill.svg")
        if os.path.exists(f):
            return n, "".join(re.findall(r' d="([^"]+)"', open(f).read()))
    raise SystemExit(f"no icon for {name}")

glyphs, out, missing = {}, {}, []
for key, (g, colour, label) in ICONS.items():
    n, d = path_of(g)
    if n != g: missing.append(f"{g}→{n}")
    glyphs[n] = d
    out[key] = [n, colour, label]
js = f"""// Generated by tools/make-place-icons.py — the map's place icons: a filled circle in the
// category's colour with a white glyph (Phosphor icons, fill weight, MIT licence).
// Keys: an OpenMapTiles poi class, or "class/subclass".
export const PLACE_ICONS = {json.dumps(out, separators=(",", ":"))};
export const GLYPHS = {json.dumps(glyphs, separators=(",", ":"))};
"""
open(os.path.join(os.path.dirname(__file__), "..", "js", "placeicons.js"), "w").write(js)
print(len(out), "icons,", len(glyphs), "glyphs,", len(js) // 1024, "KB; substitutes:", ", ".join(missing))
