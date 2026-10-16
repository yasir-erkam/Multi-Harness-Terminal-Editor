# README images

Screenshots and animations used by the repository README. This folder is excluded from the VSIX by `.vscodeignore`; the Marketplace and Open VSX render these images from GitHub through the `repository` URL in `package.json`, so they must be committed and pushed before publishing.

## Expected files

| File | Type | Content |
| --- | --- | --- |
| `demo.gif` | Animation, 6–12 s, under ~3 MB | Single-click an agent in the sidebar so its saved sessions appear, then select a session (or double-click the agent) to open it in an editor-area terminal tab. The GIF also covers the sidebar, so no separate sidebar screenshot is needed. |
| `editor-terminals.png` | Screenshot | Two or three agent terminals open as editor tabs (optionally split side by side) with clean, finished output. |

## Capture guidelines

- Width about 1200–1600 px; crop to the VS Code window, not the whole browser or desktop.
- GIF: 10–15 fps, keep under ~3 MB. Optimize with ScreenToGif (Windows), Peek (Linux) or Gifski (macOS).
- PNG: run through an optimizer (for example `oxipng` or TinyPNG) before committing.
- Use a clean demo project. Make sure no real paths, usernames, tokens, API keys or private conversation titles are visible.
- Prefer the default Dark Modern theme so the images match the rest of the README artwork.
- Always provide descriptive alt text when referencing an image from the README.
