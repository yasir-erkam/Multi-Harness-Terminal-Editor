#!/usr/bin/env python3
"""One-off: regenerate the 24 editor-title-bar icons.

- 9 harnesses use LobeHub MIT static icons (brand marks), recolored to a single
  theme tone (`currentColor` -> #374151 light / #c8c8c8 dark) and normalized to
  a fixed 16x16 viewport (LobeHub originals are width=1em/height=1em, which can
  render at 0 px inside <img>-style contexts).
- 3 harnesses without a LobeHub icon (ohMyPi, aider, crush) keep the original
  geometric two-letter marks, re-authored as pure stroke shapes (no <text>,
  which depends on ambient fonts).
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")
ICONDIR = os.path.join(ROOT, "node_modules", "@lobehub", "icons-static-svg", "icons")

LIGHT = "#374151"
DARK = "#c8c8c8"

# harness id -> LobeHub icon stem (verified in icons/); None = original mark
LOBE_SRC = {
    "claudeCode": "claude",
    "codex": "codex",          # Codex CLI is OpenAI's; lobe ships the codex mark
    "openCode": "opencode",
    "pi": "pi",
    "ohMyPi": None,            # original
    "gemini": "gemini",
    "copilot": "copilot",
    "cursorAgent": "cursor",
    "aider": None,             # original
    "crush": None,             # original
    "qwen": "qwen",
    "goose": "goose",
}

MARKS = {"ohMyPi": "OP", "aider": "AI", "crush": "CR"}


def lobehub_svg(stem, color):
    """LobeHub icon normalized: 16x16 viewBox, themed fill.

    The paths are authored on a 24-unit grid, so the whole artwork is wrapped in
    a group scaled by 16/24 = 2/3 to fit the 16-unit viewBox the manifest icons
    are required to use.
    """
    src = open(os.path.join(ICONDIR, f"{stem}.svg"), encoding="utf-8").read()
    body = re.sub(r"<svg[^>]*>", "", src, count=1).replace("</svg>", "")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
        f'<g transform="scale(0.66667)" fill="{color}">{body}</g>'
        "</svg>"
    )


def letter_shapes(mark, color, off):
    """Stroke shapes for one letter at x-offset `off` on a 24x24 grid."""
    strokes = {
        "A": [(0, 14), (3.5, 0), (7, 14), (0.9, 9.5), (6.2, 9.5)],
        "I": [(2.4, 0.8), (2.4, 14)],
        "O": (2, 1, 5, 13),
        "P": [(2, 14), (2, 2), (5.6, 2), (7, 4), (5.6, 6.5), (2, 7)],
        "R": [(7, 3), (4, 2), (2, 5), (2, 8), (4, 10), (7, 7), (4, 8.5), (2, 15)],
        "C": [(7, 3), (4, 2), (2, 5), (2, 12), (4, 15), (7, 14)],
    }
    shapes = []
    ch = mark
    if ch == "O":
        strokes = {"O": (2, 1, 5, 13)}
    if ch in strokes and isinstance(strokes[ch], tuple):
        x, y, w, h = strokes[ch]
        shapes.append(f'<rect x="{x + off - 2:.1f}" y="{y}" width="{w}" height="{h}" rx="4" fill="none" stroke="{color}" stroke-width="2.2"/>')
    elif ch in strokes:
        pts = " ".join(f"{x + off:.1f},{y:.1f}" for x, y in strokes[ch])
        if ch in ("P", "R", "C"):
            shapes.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linejoin="round"/>')
        else:
            shapes.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')
    else:
        y, h = strokes["I"][0][1] if False else (0.8, 14)
        shapes.append(
            f'<polyline points="{off + 2.4:.1f},{y:.1f} {off + 2.4:.1f},14" '
            f'fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round"/>'
        )
        shapes.append(f'<rect x="{off + 1.2:.1f}" y="{y}" width="2.4" height="2.4" fill="{color}"/>')
    return shapes


def original_svg(mark, theme, color):
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">',
        '<g transform="scale(0.66667)">',
        f'<rect x="1" y="1" width="22" height="22" rx="4" fill="none" stroke="{color}" stroke-width="2" opacity="0.55"/>',
    ]
    parts.extend(letter_shapes(mark[0], color, 3))
    parts.extend(letter_shapes(mark[1], color, 13))
    parts.append("</g></svg>")
    return "".join(parts)


def write(hid, theme, content):
    path = os.path.join(MEDIA, f"{hid}-{theme}.svg")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    return os.path.getsize(path)


def main():
    sizes = {}
    sources = {}
    for hid, stem in LOBE_SRC.items():
        if stem:
            for theme, color in (("light", LIGHT), ("dark", DARK)):
                sizes[f"{hid}-{theme}"] = write(hid, theme, lobehub_svg(stem, color))
            sources[hid] = f"lobehub/{stem}.svg"
        else:
            mark = MARKS[hid]
            for theme, color in (("light", LIGHT), ("dark", DARK)):
                sizes[f"{hid}-{theme}"] = write(hid, theme, original_svg(mark, theme, color))
            sources[hid] = "original"
    return sizes, sources


if __name__ == "__main__":
    sizes, sources = main()
    for k in sorted(sizes):
        hid = k.rsplit("-", 1)[0]
        print(f"{k:26} {sizes[k]:>5} bytes  <- {sources[hid]}")
