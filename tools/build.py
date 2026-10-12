"""Build docs/data/data.js from content/places.json.

- Fetches 和合本 (CUV, public domain) verses from bolls.life, cached in build_cache/bible
- Downloads one 960px photo per Commons file into docs/img with author/license credits
- Clips Natural Earth land/lakes/rivers to the Holy Land for an offline base map

Usage: python3 tools/build.py
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "build_cache"
APP = ROOT / "docs"
UA = "IsraelBibleMap/0.1 (personal study app)"

BOOKS = {
    "GEN": (1, "創世記"), "EXO": (2, "出埃及記"), "NUM": (4, "民數記"), "DEU": (5, "申命記"),
    "JOS": (6, "約書亞記"), "1SA": (9, "撒母耳記上"), "2SA": (10, "撒母耳記下"),
    "1KI": (11, "列王紀上"), "2KI": (12, "列王紀下"), "2CH": (14, "歷代志下"), "EZR": (15, "以斯拉記"),
    "PSA": (19, "詩篇"), "SNG": (22, "雅歌"), "ISA": (23, "以賽亞書"), "JER": (24, "耶利米書"),
    "EZK": (26, "以西結書"), "JON": (32, "約拿書"), "ZEC": (38, "撒迦利亞書"),
    "MAT": (40, "馬太福音"), "MRK": (41, "馬可福音"), "LUK": (42, "路加福音"),
    "JHN": (43, "約翰福音"), "ACT": (44, "使徒行傳"),
}
BBOX = (33.9, 29.4, 36.6, 33.8)  # lon_min, lat_min, lon_max, lat_max


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else data.decode("utf-8")
        except Exception as e:  # noqa: BLE001 - retry any network hiccup
            if attempt == 3:
                raise
            print(f"  retry {url[:80]} ({e})")
            time.sleep(15 * (attempt + 1))


# ---------- Bible ----------

def parse_ref(ref):
    m = re.fullmatch(r"(\w+) (\d+):(\d+)(?:-(\d+))?", ref)
    if not m:
        raise ValueError(f"bad ref {ref}")
    book, ch, v1, v2 = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    return book, ch, v1, int(v2) if v2 else v1


def chapter(book_no, ch):
    path = CACHE / "bible" / f"{book_no}_{ch}.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(get(f"https://bolls.life/get-text/CUV/{book_no}/{ch}/"))
        time.sleep(0.3)
    return {v["verse"]: v["text"] for v in json.loads(path.read_text())}


def clean_verse(text):
    text = re.sub(r"<[^>]+>", "", text)
    # bolls puts a space between every character of CUV; drop all spaces
    return re.sub(r"\s+", "", text)


def build_passage(ref):
    book, ch, v1, v2 = parse_ref(ref)
    no, zh = BOOKS[book]
    verses = chapter(no, ch)
    out = [{"v": v, "t": clean_verse(verses[v])} for v in range(v1, v2 + 1)]
    label = f"{zh} {ch}:{v1}" + (f"-{v2}" if v2 != v1 else "")
    return {"label": label, "verses": out}


# ---------- Photos ----------

def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def fetch_photo(file_title, dest_stem):
    meta_path = CACHE / "photos" / (dest_stem + ".json")
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "titles": file_title, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": 960,
    })
    page = next(iter(json.loads(get("https://commons.wikimedia.org/w/api.php?" + q))["query"]["pages"].values()))
    info = page["imageinfo"][0]
    em = info.get("extmetadata", {})
    src = info.get("thumburl") or info["url"]
    ext = ".png" if src.lower().endswith(".png") else ".jpg"
    (APP / "img" / (dest_stem + ext)).write_bytes(get(src, binary=True))
    meta = {
        "src": f"img/{dest_stem}{ext}",
        "author": strip_html(em.get("Artist", {}).get("value")) or "Unknown",
        "license": strip_html(em.get("LicenseShortName", {}).get("value")),
        "page": info["descriptionurl"],
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False))
    time.sleep(3)
    return meta


# ---------- Base map ----------

def clip_ring(ring, box):
    x0, y0, x1, y1 = box
    edges = [
        (lambda p: p[0] >= x0, lambda a, b: (x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0]))),
        (lambda p: p[0] <= x1, lambda a, b: (x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0]))),
        (lambda p: p[1] >= y0, lambda a, b: (a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0)),
        (lambda p: p[1] <= y1, lambda a, b: (a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1)),
    ]
    pts = [tuple(p[:2]) for p in ring]
    for inside, cross in edges:
        if not pts:
            break
        out = []
        prev = pts[-1]
        for cur in pts:
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
            prev = cur
        pts = out
    return [[round(x, 4), round(y, 4)] for x, y in pts]


def polygons(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def lines(geom):
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


def clip_polys(path):
    out = []
    for f in json.loads(path.read_text())["features"]:
        for poly in polygons(f["geometry"]):
            rings = [r for r in (clip_ring(ring, BBOX) for ring in poly) if len(r) >= 3]
            if rings:
                out.append(rings)
    return out


def clip_lines(path):
    x0, y0, x1, y1 = BBOX
    out = []
    for f in json.loads(path.read_text())["features"]:
        for line in lines(f["geometry"]):
            seg = []
            for x, y in (p[:2] for p in line):
                if x0 <= x <= x1 and y0 <= y <= y1:
                    seg.append([round(x, 4), round(y, 4)])
                elif seg:
                    if len(seg) > 1:
                        out.append(seg)
                    seg = []
            if len(seg) > 1:
                out.append(seg)
    return out


def build_basemap():
    return {
        "land": clip_polys(CACHE / "ne_10m_admin_0_countries.geojson"),
        "lakes": clip_polys(CACHE / "ne_10m_lakes.geojson"),
        "rivers": clip_lines(CACHE / "ne_10m_rivers_lake_centerlines.geojson"),
    }


# ---------- Main ----------

def main():
    content = json.loads((ROOT / "content" / "places.json").read_text())

    refs = set()
    for p in content["places"]:
        refs.update(r["ref"] for r in p["refs"])
    for d in content["days"]:
        refs.update(i["ref"] for i in d["items"] if "ref" in i)
    refs.update(e["ref"] for e in content["timeline"] if "ref" in e)
    print(f"Fetching {len(refs)} passages")
    bible = {ref: build_passage(ref) for ref in sorted(refs)}

    print("Fetching photos")
    for p in content["places"]:
        p["photos"] = [fetch_photo(t, f"{p['id']}-{i + 1}") for i, t in enumerate(p["photos"])]
        print(f"  {p['id']}: {len(p['photos'])}")

    print("Clipping base map")
    basemap = build_basemap()
    (APP / "data").mkdir(exist_ok=True)
    (APP / "data" / "basemap.json").write_text(json.dumps(basemap, separators=(",", ":")))

    data = {**content, "bible": bible}
    (APP / "data" / "data.js").write_text(
        "window.APP_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    print("Wrote docs/data/data.js and docs/data/basemap.json")


if __name__ == "__main__":
    main()
