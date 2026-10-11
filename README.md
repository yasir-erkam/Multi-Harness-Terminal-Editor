# Multi-Harness Terminal Editor

> **Note — placeholder metadata.** This repository ships with placeholders: `publisher` is `your-publisher` and `repository` points at `github.com/your-org/multi-harness-terminal-editor`. Replace both in `package.json` with your real Microsoft Marketplace publisher ID and your GitHub repository URL before publishing. The complete release procedure is in [PUBLISHING.md](PUBLISHING.md).

## What it is

Multi-Harness Terminal Editor opens AI coding-agent CLIs — "harnesses" — as **native VS Code terminals in the editor area**. Each of the twelve supported agents gets its own terminal tab, created from an icon in the editor title bar (or from a single Quick Pick command that lists every agent). All icon buttons ship **off by default** and are toggled on per agent, so the title bar only shows the harnesses you actually use. The terminals are ordinary editor-area terminals: they can be split, moved, reordered and closed like any other tab, and the extension adds no custom terminal renderer or panel of its own.

## Features

- **Twelve agents, one terminal each.** Open any supported harness in its own editor-area terminal. Each agent is keyed by an id (for example `claudeCode`, `openCode`, `ohMyPi`) that drives its command, its settings and its icon.
- **One terminal per agent, reused.** Running the command again reveals the agent's existing terminal instead of starting a second process; terminals are matched by the agent's display name.
- **Opened beside the active editor.** The terminal is created with `TerminalOptions.location` set to `ViewColumn.Beside` and marked `isTransient`, so it is not restored on window reload.
- **Agent picker.** `multiHarness.openAgentPicker` — **Multi-Harness: Open Agent...** in the Command Palette — shows a Quick Pick over all twelve harnesses and opens the one you choose; handy when you keep the title-bar icons hidden.
- **Per-agent editor title-bar icons.** Every agent has its own toggle, `multiHarness.show<Id>Icon` (boolean, default `false`). Enable only the agents you want in the editor title bar.
- **Exit notifications.** With `multiHarness.notifyOnExit` enabled (default `false`), the extension shows a notification containing the exit code when an agent terminal closes, so a crashed or non-zero CLI does not pass unnoticed.
- **Multi-root workspaces.** Agent terminals use a workspace folder as their working directory; the extension does not assume a single-folder workspace.
- **Configurable launch.** For each agent you can override the executable with `multiHarness.<id>.executablePath` and add extra CLI flags with `multiHarness.<id>.arguments`.
- **No runtime dependencies.** The extension is pure VS Code API code.

## Getting started

1. From an editor tab, run one of the `Multi-Harness: Open <Agent>` commands — or **Multi-Harness: Open Agent...** to pick from all twelve.
2. The agent CLI must be installed and on `PATH`; otherwise set its `multiHarness.<id>.executablePath` to an absolute path.
3. Enable the matching `multiHarness.show<Id>Icon` setting if you want a title-bar button for that harness.

## Supported agents

| Harness id | Display name | Open command | Default executable |
| --- | --- | --- | --- |
| `claudeCode` | Claude Code | `multiHarness.openClaudeCode` | `claude` |
| `codex` | Codex | `multiHarness.openCodex` | `codex` |
| `openCode` | OpenCode | `multiHarness.openOpenCode` | `opencode` |
| `pi` | Pi Agent | `multiHarness.openPi` | `pi` |
| `ohMyPi` | Oh My Pi | `multiHarness.openOhMyPi` | `omp` |
| `gemini` | Gemini CLI | `multiHarness.openGemini` | `gemini` |
| `copilot` | Copilot CLI | `multiHarness.openCopilot` | `copilot` |
| `cursorAgent` | Cursor Agent | `multiHarness.openCursorAgent` | `cursor-agent` |
| `aider` | Aider | `multiHarness.openAider` | `aider` |
| `crush` | Crush | `multiHarness.openCrush` | `crush` |
| `qwen` | Qwen Code | `multiHarness.openQwen` | `qwen` |
| `goose` | Goose | `multiHarness.openGoose` | `goose` |

## Commands

All commands appear in the Command Palette under the `Multi-Harness` category. The twelve `open*` commands are also individual, keybindable commands.

| Command ID | Palette label | Description |
| --- | --- | --- |
| `multiHarness.openAgentPicker` | Open Agent... | Quick Pick over all twelve harnesses. |
| `multiHarness.openClaudeCode` | Open Claude Code | Open a Claude Code terminal. |
| `multiHarness.openCodex` | Open Codex | Open a Codex terminal. |
| `multiHarness.openOpenCode` | Open OpenCode | Open an OpenCode terminal. |
| `multiHarness.openPi` | Open Pi Agent | Open a Pi Agent terminal. |
| `multiHarness.openOhMyPi` | Open Oh My Pi | Open an Oh My Pi terminal. |
| `multiHarness.openGemini` | Open Gemini CLI | Open a Gemini CLI terminal. |
| `multiHarness.openCopilot` | Open Copilot CLI | Open a Copilot CLI terminal. |
| `multiHarness.openCursorAgent` | Open Cursor Agent | Open a Cursor Agent terminal. |
| `multiHarness.openAider` | Open Aider | Open an Aider terminal. |
| `multiHarness.openCrush` | Open Crush | Open a Crush terminal. |
| `multiHarness.openQwen` | Open Qwen Code | Open a Qwen Code terminal. |
| `multiHarness.openGoose` | Open Goose | Open a Goose terminal. |

## Settings

Every setting lives under the `multiHarness` section.

### Full settings reference

**Icon toggles — `multiHarness.show<Id>Icon`**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.showClaudeCodeIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCodexIcon` | `boolean` | `false` | `window` |
| `multiHarness.showOpenCodeIcon` | `boolean` | `false` | `window` |
| `multiHarness.showPiIcon` | `boolean` | `false` | `window` |
| `multiHarness.showOhMyPiIcon` | `boolean` | `false` | `window` |
| `multiHarness.showGeminiIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCopilotIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCursorAgentIcon` | `boolean` | `false` | `window` |
| `multiHarness.showAiderIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCrushIcon` | `boolean` | `false` | `window` |
| `multiHarness.showQwenIcon` | `boolean` | `false` | `window` |
| `multiHarness.showGooseIcon` | `boolean` | `false` | `window` |

**Executable overrides — `multiHarness.<id>.executablePath`** (machine-overridable; leave empty to use the default executable)

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.claudeCode.executablePath` | `string` | `"claude"` | machine-overridable |
| `multiHarness.codex.executablePath` | `string` | `"codex"` | machine-overridable |
| `multiHarness.openCode.executablePath` | `string` | `"opencode"` | machine-overridable |
| `multiHarness.pi.executablePath` | `string` | `"pi"` | machine-overridable |
| `multiHarness.ohMyPi.executablePath` | `string` | `"omp"` | machine-overridable |
| `multiHarness.gemini.executablePath` | `string` | `"gemini"` | machine-overridable |
| `multiHarness.copilot.executablePath` | `string` | `"copilot"` | machine-overridable |
| `multiHarness.cursorAgent.executablePath` | `string` | `"cursor-agent"` | machine-overridable |
| `multiHarness.aider.executablePath` | `string` | `"aider"` | machine-overridable |
| `multiHarness.crush.executablePath` | `string` | `"crush"` | machine-overridable |
| `multiHarness.qwen.executablePath` | `string` | `"qwen"` | machine-overridable |
| `multiHarness.goose.executablePath` | `string` | `"goose"` | machine-overridable |

**Extra arguments — `multiHarness.<id>.arguments`**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.claudeCode.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.codex.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.openCode.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.pi.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.ohMyPi.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.gemini.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.copilot.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.cursorAgent.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.aider.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.crush.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.qwen.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.goose.arguments` | `array` of `string` | `[]` | `resource` |

**Notifications**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.notifyOnExit` | `boolean` | `false` | `window` |

### Example `settings.json`

```json
{
  "multiHarness.showClaudeCodeIcon": true,
  "multiHarness.showOhMyPiIcon": true,
  "multiHarness.claudeCode.executablePath": "/usr/local/bin/claude",
  "multiHarness.claudeCode.arguments": ["--model", "opus"],
  "multiHarness.ohMyPi.executablePath": "/home/me/.bun/bin/omp",
  "multiHarness.notifyOnExit": true
}
```

## Keyboard shortcuts & focus

**How keys reach a focused terminal.** When a terminal has focus, keystrokes are delivered to the terminal *except* for the commands listed in `terminal.integrated.commandsToSkipShell`. That list is seeded with a built-in set of VS Code commands and can be written to by the user: adding a command ID makes VS Code handle the key instead of the terminal, and prefixing an entry with `-` removes it from the list.

**Ctrl+P opens Quick Open instead of reaching the agent.** `workbench.action.quickOpen` (Ctrl+P) is in that default skip list, so in an editor-area terminal Ctrl+P opens Quick Open rather than being forwarded to the CLI. To hand Ctrl+P back to the shell, add the removal entry — the example VS Code's own docs give for "Send quick open's keyboard shortcut to the shell":

```json
"terminal.integrated.commandsToSkipShell": ["-workbench.action.quickOpen"]
```

**Ctrl/Cmd+W closes the terminal editor tab.** In an **editor-area** terminal, `Ctrl/Cmd+W` is bound to `workbench.action.terminal.killEditor` ("Kill the Active Terminal in Editor Area") with `when: terminalFocus && terminalEditorFocus`, and `workbench.action.terminal.killEditor` is itself in the default `commandsToSkipShell` list — so VS Code consumes the chord and it does **not** reach the agent process. In a **panel** terminal the `terminalEditorFocus` guard does not match and the fallback editor-close binding is *not* in the skip list, so there the key is forwarded to the shell. On Windows the primary binding is `Ctrl+F4`, with `Ctrl+W` as the secondary. (VS Code source: `terminalActions.ts` in `src/vs/workbench/contrib/terminal/browser/`, and `DEFAULT_COMMANDS_TO_SKIP_SHELL` in `src/vs/workbench/contrib/terminal/common/terminal.ts`.)

**Ctrl+C and copy.** On Windows, `Ctrl+C` copies only when text is selected: the `win`-only keybinding of `workbench.action.terminal.copyAndClearSelection` (also in the default skip list) is gated on the `textSelected` context key, so with nothing selected the chord reaches the agent and still interrupts a running CLI. On Linux, plain `Ctrl+C` always reaches the agent because copy is `Ctrl+Shift+C` (`workbench.action.terminal.copySelection`); on macOS, `Cmd+C` copies when a selection exists.

**Sending most keys to the terminal.** Setting `terminal.integrated.sendKeybindingsToShell` to `true` dispatches most keybindings to the terminal instead of VS Code, overriding `commandsToSkipShell`. The documented cost is that terminal-local VS Code shortcuts — Ctrl+F find, for example — stop working while the terminal is focused.

**Chords and mnemonics.** `terminal.integrated.allowChords` (default `true`) sends chorded keybindings to VS Code; note that when a keystroke forms a chord it bypasses `commandsToSkipShell`, and setting this to `false` is how you let e.g. `Ctrl+K` reach the shell. `terminal.integrated.allowMnemonics` (default `false`) concerns Alt+letter menu mnemonics — it controls whether those combinations open the menu bar while the terminal is focused (no effect on macOS).

## Fonts & icons (Nerd Font, ligatures)

**Font family.** `terminal.integrated.fontFamily` has no default value. When it is unset the terminal falls back to `editor.fontFamily`, and whatever value is in effect VS Code always appends `, monospace` (and on macOS also `, AppleBraille`).

**Ligatures.** `terminal.integrated.fontLigatures.enabled` defaults to `false`. When you enable it you can tune the behavior with `terminal.integrated.fontLigatures.featureSettings` (the default is `"calt" on`) and `terminal.integrated.fontLigatures.fallbackLigatures`.

**GPU acceleration.** `terminal.integrated.gpuAcceleration` accepts `auto` (default), `on` or `off`. `auto` selects the WebGL renderer and falls back to the DOM renderer when WebGL fails to load or its context is lost.

**Nerd Font icons.** With the WebGL renderer, `terminal.integrated.customGlyphs` (default `true`) draws a specific set of ranges itself, so these glyphs render even without a patched font in the stack:

- Box Drawing `U+2500`–`U+257F`
- Block Elements `U+2580`–`U+259F`
- Braille Patterns `U+2800`–`U+28FF`
- Powerline `U+E0A0`–`U+E0D4`
- Progress `U+EE00`–`U+EE0B`
- Git Branch `U+F5D0`–`U+F60D`
- Symbols for Legacy Computing `U+1FB00`–`U+1FBFF`

All other Nerd Font private-use-area icons need a patched font in the font stack. Setting `terminal.integrated.gpuAcceleration` to `off` disables the custom-glyph path entirely, so the ranges above also require a patched font.

## Restricted Mode

This extension declares `untrustedWorkspaces: { supported: false }`, so it is disabled while the workspace is in Restricted Mode (Workspace Trust has not been granted). Agents run commands inside your workspace, so the extension does not activate until you trust the folder. Trust the workspace or add it to your trusted folders to enable the icons, commands and terminals.

It also declares `virtualWorkspaces: { supported: false }`, so it remains disabled in virtual workspaces (for example GitHub Repositories), where spawning a local CLI process is not possible.

## Requirements

- **VS Code 1.67.0 or newer** (`engines.vscode: ^1.67.0`). The extension uses `TerminalOptions.location` / `TerminalLocation` (stable since 1.64), `isTransient` (stable since 1.65) and `window.tabGroups` with `TabInputTerminal` (stable since 1.67).
- **A trusted, non-virtual workspace.** Because of the two capability declarations above, the extension does not activate in Restricted Mode or in virtual workspaces.
- `extensionKind: ["workspace"]` — it runs in the workspace extension host, where the terminal API is available.
- No runtime dependencies, and no Node.js/npm needed just to use the extension.

## Known limitations

- **Stale `PATH`.** The extension host does not source your shell rc files, so a CLI installed *after* VS Code started may not be on `PATH` in that window. That is why the extension looks for the agent executable beyond `PATH`:
  - `<workspace>/node_modules/.bin`, then
  - on Windows `%APPDATA%\npm` and `%LOCALAPPDATA%\pnpm`, and
  - on POSIX `~/.bun/bin`, `~/.local/bin` and `~/.npm-global/bin`,
  - before finally falling back to `PATH`.

  If an agent still is not found, set `multiHarness.<id>.executablePath` explicitly, or reload the VS Code window after installing the CLI.
- **No shell-integration status tracking in v0.1.** The extension does not read shell-integration data, so there is no per-agent "running / idle / needs input" indicator on the icons.
- **Icon buttons are off by default.** After installing, no icon appears until you enable the matching `multiHarness.show<Id>Icon` setting (or use `multiHarness.openAgentPicker`).

## Installation

### From the Marketplace

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for **Multi-Harness Terminal Editor** and check the publisher shown on the result.
3. Click **Install**, then reload the window if prompted.
4. Enable the agents you want with the `multiHarness.show<Id>Icon` settings.

### From a VSIX file

1. Open the Extensions view and open the `…` (Views and More Actions) menu.
2. Choose **Install from VSIX…** and select the downloaded `.vsix` file.
3. Alternatively, from a terminal: `code --install-extension multi-harness-terminal-editor-0.1.0.vsix`.

VSIX files are produced by `npm run package` (see [PUBLISHING.md](PUBLISHING.md)).

## Development

```bash
npm ci          # install dev dependencies from the lockfile
npm run check   # type check (tsc --noEmit)
npm run build   # bundle src/extension.ts to dist/extension.js with esbuild
npm run test    # unit tests plus manifest validation
npm run compile # check + build + test
npm run package # compile, then produce a .vsix with @vscode/vsce
```

Then press <kbd>F5</kbd> in VS Code to launch the **Extension Development Host** with the extension loaded.

`.github/workflows/ci.yml` runs `npm run check`, `npm run build`, `npm run test` and `npm run package` on every push and pull request; `.github/workflows/release.yml` packages and publishes on `v*` tags, attaching the VSIX to a draft GitHub release.

## License

MIT. See [LICENSE](LICENSE).
