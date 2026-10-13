#!/usr/bin/env python3
"""Regenerate the 256x256 marketplace logo (media/icon.png), deterministically.

Pure python (zlib+struct, no PIL, no downloads). Design, original artwork:
- rounded-square background with a subtle two-tone vertical gradient
- white terminal-prompt glyph ">" over a baseline "_" (the editor-area
  terminal motif of the product)
- a small stacked-harness motif: three offset rounded tabs under the glyph
  (the "multi-harness" idea) — no text fonts involved anywhere.
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")

SIZE = 256
ANTIALIAS = 3
TOP = (14, 26, 44)       # deep blue tile, upper tone
BOTTOM = (36, 57, 90)    # deep blue tile, lower tone
GLYPH = (245, 246, 248)  # near-white prompt glyph
TAB = (120, 170, 255)    # accent for the stacked tabs

INSET = 12
RADIUS = 52


def rounded_rect_contains(x, y, r, x0, y0, x1, y1):
    qx = x - min(max(x, x0 + r), x1 - r)
    qy = y - min(max(y, y0 + r), y1 - r)
    return qx * qx + qy * qy <= r * r


def seg_distance(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / (abx * abx + aby * aby)))
    dx, dy = apx - t * abx, apy - t * aby
    return (dx * dx + dy * dy) ** 0.5


def in_glyph_or_tabs(x, y):
    """Return 0 none, 1 glyph (white), 2 accent tab."""
    # Prompt chevron: two thick strokes forming ">" around x 58..116, y 62..140
    if seg_distance(x, y, 62, 74, 108, 106) <= 9:
        return 1
    if seg_distance(x, y, 108, 106, 62, 138) <= 9:
        return 1
    # Prompt underscore at baseline right of the chevron
    if 128 <= x <= 196 and 138 <= y <= 150:
        return 1
    # Stacked harness tabs: three small rounded rects, offset like editor tabs
    for i, (tx, ty, tw, th) in enumerate((
        (62, 168, 58, 16),
        (74, 188, 58, 16),
        (86, 208, 58, 16),
    )):
        if rounded_rect_contains(x, y, 7, tx, ty, tx + tw, ty + th):
            # front tab accent, back tabs translucent (blend below uses alpha)
            return 2 if i == 2 else 2.35
    return 0


def build_rows():
    rows = []
    probes = ANTIALIAS * ANTIALIAS
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            r = g = b = 0.0
            a = 0.0
            for syi in range(ANTIALIAS):
                for sxi in range(ANTIALIAS):
                    x = px + (sxi + 0.5) / ANTIALIAS
                    y = py + (syi + 0.5) / ANTIALIAS
                    if not rounded_rect_contains(x, y, RADIUS, INSET, INSET, SIZE - INSET, SIZE - INSET):
                        continue
                    # two-tone vertical gradient across the tile
                    t = y / (SIZE - 2 * INSET)
                    bg = tuple(TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3))
                    kind = in_glyph_or_tabs(x, y)
                    if kind == 1:
                        blend = GLYPH
                        alpha = 1.0
                    elif kind == 2:
                        blend = TAB
                        alpha = 1.0
                    elif kind > 2:  # back tabs at reduced opacity
                        blend = TAB
                        alpha = 0.45
                    else:
                        blend = bg
                        alpha = 1.0
                    r += blend[0] * alpha
                    g += blend[1] * alpha
                    b += blend[2] * alpha
                    a += alpha
            if a == 0:
                row += b"\0\0\0\0"
            else:
                r, g, b = round(r / a), round(g / a), round(b / a)
                alpha = round(255 * a / probes)
                row += bytes((min(r, 255), min(g, 255), min(b, 255), 255))
        rows.append(bytes(row))
    return rows


def png_bytes(rows, size):
    def chunk(tag, payload):
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type: none
        raw += row
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    os.makedirs(MEDIA, exist_ok=True)
    data = png_bytes(build_rows(), SIZE)
    out = os.path.join(MEDIA, "icon.png")
    with open(out, "wb") as handle:
        handle.write(data)
    print(f"wrote icon.png ({len(data)} bytes, {SIZE}x{SIZE}, gen-logo.py only)")


if __name__ == "__main__":
    main()
