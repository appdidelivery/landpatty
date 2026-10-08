#!/usr/bin/env python3
"""Fetch publicly available Instagram Reel poster images at build time.

The landing page serves optimized local files; no Instagram image hotlinks
are required in the visitor's browser. Existing covers remain intact if
Instagram denies anonymous requests.
"""
from __future__ import annotations

import hashlib
import html
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageFilter, ImageOps

REEL_IDS = (
    "DeKwNPBJFOk",  # Make & Hair
    "DcJ9GAmhsYn",  # Nail Design
    "DbMZQEZgFNa",  # Autocuidado
    "Da6Kq_0htkE",  # Lash Design
    "DdmuczcNO0A",  # Experiencia Patty
    "Dd2GgLFJd0w",  # Producao especial
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "imagens" / "reels"
OUT.mkdir(parents=True, exist_ok=True)

# Instagram supports these normal browser/crawler UAs for public OpenGraph previews.
HEADERS = [
    {"User-Agent": "facebookexternalhit/1.1", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"},
    {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9"},
]


class OpenGraphParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        p = dict(attrs)
        if p.get("property", "").lower() in ("og:image", "og:image:url") or p.get("name", "").lower() == "twitter:image":
            img = p.get("content")
            if img:
                self.images.append(html.unescape(img))


def choose_cover(doc: str) -> str | None:
    p = OpenGraphParser()
    p.feed(doc)
    # Skip profile avatars (150x150) and favor the Reel's OpenGraph image.
    for u in p.images:
        if "cdninstagram.com/" in u and "t51.2885-19" not in u and "s150x150" not in u:
            return u
    return None


def fetch_cover(session: requests.Session, reel_id: str) -> bytes | None:
    for headers in HEADERS:
        try:
            page = session.get(
                f"https://www.instagram.com/reel/{reel_id}/",
                headers=headers, timeout=22
            )
            page.raise_for_status()
            poster_url = choose_cover(page.text)
            if not poster_url:
                print(f"{reel_id}: OpenGraph cover unavailable for UA {headers['User-Agent'][:20]}")
                continue
            response = session.get(
                poster_url,
                headers={**headers, "Referer": "https://www.instagram.com/"},
                timeout=22,
            )
            response.raise_for_status()
            if not response.headers.get("content-type", "").startswith("image/"):
                print(f"{reel_id}: unexpected media type")
                continue
            return response.content
        except (requests.RequestException, ValueError) as exc:
            print(f"{reel_id}: Instagram fetch failed: {exc}")
    return None


def make_portrait(blob: bytes) -> bytes:
    img = Image.open(BytesIO(blob)).convert("RGB")
    # Keep the whole genuine thumbnail visible even if IG supplies a square crop.
    canvas = ImageOps.fit(img, (360, 640), method=Image.Resampling.LANCZOS)
    canvas = canvas.filter(ImageFilter.GaussianBlur(17))
    subject = ImageOps.contain(img, (360, 640), method=Image.Resampling.LANCZOS)
    x = (360 - subject.width) // 2
    y = (640 - subject.height) // 2
    canvas.paste(subject, (x, y))
    buf = BytesIO()
    canvas.save(buf, format="JPEG", quality=80, optimize=True, progressive=True)
    return buf.getvalue()


def main():
    ok = 0
    with requests.Session() as session:
        for rid in REEL_IDS:
            raw = fetch_cover(session, rid)
            if not raw:
                print(f"{rid}: retaining existing thumbnail or on-site photo fallback")
                continue
            try:
                blob = make_portrait(raw)
                dest = OUT / f"{rid}.jpg"
                if dest.exists() and hashlib.sha256(dest.read_bytes()).digest() == hashlib.sha256(blob).digest():
                    print(f"{rid}: cover unchanged")
                else:
                    dest.write_bytes(blob)
                    print(f"{rid}: saved verified real Reel cover ({len(blob)} bytes)")
                ok += 1
            except (OSError, ValueError) as exc:
                print(f"{rid}: invalid image, preserving fallback ({exc})")
    print(f"Synced {ok}/{len(REEL_IDS)} Reel covers; unsuccessful ones keep existing covers or salon imagery")


if __name__ == "__main__":
    main()
