#!/usr/bin/env python3
"""Generates the DerteApp PWA icon set.

The mark is a geometric "D" on a near-black tile with an accent dot, drawn
analytically and supersampled, so the icons stay crisp at every size without
adding an image-processing dependency to the project.

Usage: python3 scripts/generate-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"

INK = (11, 13, 15)          # tile background
PAPER = (255, 255, 255)     # the D
ACCENT = (47, 107, 255)     # DerteApp accent
SAMPLES = 3                 # supersampling factor per axis


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    """Writes 8-bit RGBA pixel data as a PNG."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type: none
        raw.extend(pixels[y * stride : (y + 1) * stride])

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def rounded_rect_contains(x: float, y: float, size: float, radius: float) -> bool:
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def in_ellipse(x: float, y: float, cx: float, cy: float, rx: float, ry: float) -> bool:
    if rx <= 0 or ry <= 0:
        return False
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0


def sample(x: float, y: float, size: float, *, scale: float, rounded: bool):
    """Colour of the icon at one sub-pixel, or None where it is transparent."""
    radius = size * 0.22
    if rounded and not rounded_rect_contains(x, y, size, radius):
        return None

    # Glyph geometry, expressed as fractions of the tile so every size matches.
    glyph = size * scale
    left = (size - glyph) / 2
    top = (size - glyph) / 2
    stroke = glyph * 0.20
    stem_w = stroke
    stem_x0, stem_x1 = left, left + stem_w
    top_y, bottom_y = top, top + glyph
    cy = (top_y + bottom_y) / 2
    ry = glyph / 2
    rx = glyph * 0.72 - stem_w

    in_stem = stem_x0 <= x <= stem_x1 and top_y <= y <= bottom_y
    in_bowl = (
        x >= stem_x1
        and in_ellipse(x, y, stem_x1, cy, rx, ry)
        and not in_ellipse(x, y, stem_x1, cy, rx - stroke, ry - stroke)
    )

    # Accent dot sits in the counter of the D.
    dot_r = glyph * 0.085
    dot_cx = stem_x1 + (rx - stroke) * 0.42
    if (x - dot_cx) ** 2 + (y - cy) ** 2 <= dot_r**2:
        return ACCENT

    if in_stem or in_bowl:
        return PAPER
    return INK


def render(size: int, *, scale: float = 0.56, rounded: bool = True) -> bytes:
    pixels = bytearray(size * size * 4)
    step = 1.0 / SAMPLES
    weight = SAMPLES * SAMPLES

    for py in range(size):
        row = py * size * 4
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SAMPLES):
                y = py + (sy + 0.5) * step
                for sx in range(SAMPLES):
                    x = px + (sx + 0.5) * step
                    colour = sample(x, y, size, scale=scale, rounded=rounded)
                    if colour is None:
                        continue
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    a += 255
            offset = row + px * 4
            if a == 0:
                continue
            # Un-premultiply so edges blend correctly against any background.
            pixels[offset] = round(r / (a / 255))
            pixels[offset + 1] = round(g / (a / 255))
            pixels[offset + 2] = round(b / (a / 255))
            pixels[offset + 3] = round(a / weight)
    return bytes(pixels)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="DerteApp">
  <rect width="512" height="512" rx="113" fill="#0b0d0f"/>
  <path d="M141 113h58v286h-58z" fill="#fff"/>
  <path d="M199 113a184 143 0 0 1 0 286v-58a126 85 0 0 0 0-170z" fill="#fff"/>
  <circle cx="243" cy="256" r="24" fill="#2f6bff"/>
</svg>
"""

TARGETS = [
    ("icon-192.png", 192, 0.56, True),
    ("icon-512.png", 512, 0.56, True),
    ("icon-maskable-512.png", 512, 0.40, False),
    ("apple-touch-icon.png", 180, 0.56, False),
    ("favicon-32.png", 32, 0.62, True),
    ("favicon-16.png", 16, 0.66, True),
]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, size, scale, rounded in TARGETS:
        write_png(OUT_DIR / name, size, size, render(size, scale=scale, rounded=rounded))
        print(f"[icons] {name} ({size}x{size})")
    (OUT_DIR / "icon.svg").write_text(SVG, encoding="utf-8")
    print("[icons] icon.svg")


if __name__ == "__main__":
    main()
