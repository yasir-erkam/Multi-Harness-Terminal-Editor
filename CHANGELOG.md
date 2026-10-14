# Changelog

## 0.3.0

- Correct application marks for all twelve harnesses, including Claude Code's mascot, GitHub Copilot's robot, Gemini CLI's terminal icon and Crush's pixel heart. Oh My Pi, Aider and Crush no longer use letter placeholders. Brand colors are preserved and monochrome foregrounds adapt to light/dark themes; sources and licenses are included.
- Standardized development packaging: VSIX files are generated in `artifacts/`, and `npm run dev:install` validates, packages and installs the current build into local code-server.
- Optional shell launch mode: `multiHarness.launchMode` (`direct` | `shell`, default `direct`). Shell mode runs the agent as a command in your default shell and, when shell integration is active, shows live per-agent status (running / duration / exit code) in the status bar. It degrades to a quoted command line, or to direct mode on VS Code older than 1.93, where the shell-integration API is unavailable.
- Terminal profiles from the dropdown continue to use direct mode.

## 0.2.2

Fix: per-agent `executablePath` and `arguments` settings were never read (the configuration key was double-prefixed), so custom CLI paths and arguments were silently ignored.

## 0.2.1

Fix: editor title-bar buttons and the agent picker could not open terminals (command id mismatch introduced by the terminal-profile refactor).

## 0.2.0

- Recognizable agent icons on the editor title-bar buttons — LobeHub MIT sources where available; original geometric marks for Oh My Pi, Aider and Crush.
- Terminal-profile support: every agent is also selectable from the terminal profile dropdown (`multiHarness.<id>` profiles; unresolvable executables are omitted).
- Turkish (tr) localization of the manifest strings (command titles, category, configuration title, all setting descriptions).


## 0.1.1

Adds searchable keywords to the extension listing (Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor Agent, Aider, Crush, Qwen Code, Goose).

## 0.1.0

Initial release.

- Opens 12 AI coding-agent CLIs (Claude Code, Codex, OpenCode, Pi Agent, Oh My Pi, Gemini CLI, Copilot CLI, Cursor Agent, Aider, Crush, Qwen Code, Goose) as editor-area terminal tabs.
- Reuses an existing tab for the same harness instead of spawning a duplicate process.
- Per-harness executable-path and argument settings; workspace `node_modules/.bin` lookup, conventional user-tool directories and `PATH`.
- Optional exit notifications (`multiHarness.notifyOnExit`).
- Editor title-bar icon buttons opt-in per harness.
