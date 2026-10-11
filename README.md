# Multi-Harness Terminal Editor

Open 12 AI coding-agent CLIs in native VS Code terminal tabs in the editor area:
Claude Code, Codex, OpenCode, Pi Agent, Oh My Pi, Gemini CLI, Copilot CLI,
Cursor Agent, Aider, Crush, Qwen Code, Goose.

## Features

- One command per harness (e.g. `Multi-Harness: Open Claude Code`) and an
  `Open Agent...` quick-pick.
- Tabs open beside the active editor and reuse the existing tab for the same
  harness instead of spawning a duplicate process.
- Opt-in editor title-bar buttons (`multiHarness.show<Id>Icon`, default off).
- Per-harness executable path (`multiHarness.<id>.executablePath`) and extra
  arguments (`multiHarness.<id>.arguments`), with executable resolution across
  the workspace `node_modules/.bin`, common user-tool directories and `PATH`.
- Optional exit notifications (`multiHarness.notifyOnExit`).

## Getting started

1. From an editor tab, run one of the `Multi-Harness: Open <Agent>` commands.
2. The agent CLI must be installed and on `PATH`, or set its
   `multiHarness.<id>.executablePath` to an absolute path.
3. Enable title-bar buttons per harness via settings if desired.

## Requirements

- VS Code ^1.67.0
- A trusted (non-virtual) workspace; the extension does not activate in
  untrusted or virtual workspaces.

## Building

- `npm run check` — type check
- `npm run build` — bundle with esbuild
- `npm run test` — unit tests plus manifest validation
- `npm run package` — produce a .vsix (`@vscode/vsce`)

## License

MIT — see [LICENSE](LICENSE).
