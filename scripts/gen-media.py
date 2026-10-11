#!/usr/bin/env python3
"""One-off generator for the extension's hand-authored media assets.

24 minimal SVG marks (rounded square + a two-letter mark, one per theme) and a
deterministic 256x256 PNG icon (terminal-prompt motif, pure zlib+struct).
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")

# id -> short mark rendered inside the rounded square
MARKS = {
    "claudeCode": "CC",
    "codex": "CX",
    "openCode": "OC",
    "pi": "PA",
    "ohMyPi": "OP",
    "gemini": "GM",
    "copilot": "CO",
    "cursorAgent": "CA",
    "aider": "AI",
    "crush": "CR",
    "qwen": "QW",
    "goose": "GO",
}
COLORS = {"light": "#1e1e1e", "dark": "#e0e0e0"}

SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
    '<rect x="1" y="1" width="14" height="14" rx="3" fill="{color}" opacity="0.12"/>'
    '<text x="8" y="11.4" font-family="monospace" font-size="7.5" font-weight="bold" '
    'fill="{color}" text-anchor="middle" letter-spacing="0.4">{mark}</text>'
    "</svg>"
)


def write_svgs():
    for harness_id, mark in MARKS.items():
        for theme, color in COLORS.items():
            with open(os.path.join(MEDIA, f"{harness_id}-{theme}.svg"), "w", encoding="utf-8") as handle:
                handle.write(SVG.format(color=color, mark=mark))


# --- icon.png: supersampled rounded square with a prompt motif ---------------

SIZE = 256
BG = (36, 57, 90)
FG = (228, 231, 236)
ANTIALIAS = 3


def rounded_rect_contains(x, y, r, inset):
    x0, y0 = inset, inset
    x1, y1 = SIZE - inset, SIZE - inset
    qx = x - min(max(x, x0 + r), x1 - r)
    qy = y - min(max(y, y0 + r), y1 - r)
    return qx * qx + qy * qy <= r * r


def seg_distance(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / (abx * abx + aby * aby)))
    dx, dy = apx - t * abx, apy - t * aby
    return (dx * dx + dy * dy) ** 0.5


def filled_prompt(px, py):
    return (
        seg_distance(px, py, 66, 82, 112, 128) <= 10.5
        or seg_distance(px, py, 112, 128, 66, 174) <= 10.5
        or seg_distance(px, py, 134, 180, 192, 180) <= 10.5
    )


def build_rows():
    rows = []
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            bg_hits = fg_hits = 0
            probes = ANTIALIAS * ANTIALIAS
            for syi in range(ANTIALIAS):
                for sxi in range(ANTIALIAS):
                    x = px + (sxi + 0.5) / ANTIALIAS
                    y = py + (syi + 0.5) / ANTIALIAS
                    if rounded_rect_contains(x, y, 46, 14):
                        bg_hits += 1
                        if filled_prompt(x, y):
                            fg_hits += 1
            if bg_hits == 0:
                row += b"\0\0\0\0"
            else:
                f = fg_hits / probes
                blended = tuple(round(BG[i] * (1 - f) + FG[i] * f) for i in range(3))
                row += bytes(blended + (255,))
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
    write_svgs()
    data = png_bytes(build_rows(), SIZE)
    with open(os.path.join(MEDIA, "icon.png"), "wb") as handle:
        handle.write(data)
    print(f"wrote {len(MARKS) * 2} svgs and icon.png ({len(data)} bytes)")


if __name__ == "__main__":
    main()
