# Third-party notices

Editor title-bar buttons and terminal tabs share the harness icons. Source
assets are vendored in `media/sources/`; `icons.json` records their URLs and
repository revisions where available. Retrieved on 2026-10-13. Regenerate the
16px theme variants offline with `node scripts/gen-icons.mjs`. Shapes and brand
accents are preserved; monochrome foregrounds adapt to the editor theme. PNG
sources are embedded unchanged in SVG wrappers.

## LobeHub brand marks (MIT)

Three icons use `@lobehub/icons-static-svg` version 1.95.1:

| Harness | Source | Mark |
| --- | --- | --- |
| Claude Code | `claudecode.svg` | Claude Code mascot |
| Codex | `openai.svg` | OpenAI blossom, as used in the official Codex IDE extension |
| Copilot CLI | `githubcopilot.svg` | GitHub Copilot robot |

These are LobeHub's redrawn marks, not exact vendor SVG exports. Copyright (c)
2023 LobeHub. The full MIT license is in `media/sources/LobeHub-LICENSE.txt`.

## Upstream application and website assets

Exact source URLs are in [sources/icons.json](sources/icons.json).

| Harness | Source asset | Attribution / license |
| --- | --- | --- |
| OpenCode | Repository brand logo | OpenCode contributors; MIT, `openCode-LICENSE.txt` |
| Pi Agent | [Website logo](https://pi.dev/logo-auto.svg) | Pi / Mario Zechner; official website brand asset. Original colors retained; outer whitespace cropped via viewBox. |
| Oh My Pi | Repository `assets/icon.svg` | Copyright (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük, (c) 2026 Stencil Labs, Inc.; MIT, `ohMyPi-LICENSE.txt` |
| Gemini CLI | Repository IDE companion icon | Google LLC / Gemini CLI contributors; Apache-2.0, `gemini-LICENSE.txt` |
| Cursor Agent | [Official website favicon](https://cursor.com/marketing-static/favicon-light.svg) | Cursor / Anysphere; official website brand asset used to identify Cursor Agent |
| Aider | Repository website application icon | Paul Gauthier / Aider contributors; Apache-2.0, `aider-LICENSE.txt` |
| Crush | Repository application notification icon | Copyright 2025-2026 Charmbracelet, Inc.; FSL-1.1-MIT, `crush-LICENSE.txt` |
| Qwen Code | Repository IDE sidebar icon | Qwen Code contributors; Apache-2.0, `qwen-LICENSE.txt` |
| Goose | Repository desktop application icon | Block, Inc. / Goose contributors; Apache-2.0, `goose-LICENSE.txt` |

License filenames above are relative to `media/sources/`. Vendor names and marks
identify the corresponding tools; this extension is not endorsed by the vendors.
