# Changelog

## 0.6.0

- Added separate Sessions and Open Terminals views. Sessions shows saved conversations for Codex, Claude Code, Pi, Oh My Pi and Prime Agent and resumes the selected record in its original project. Open Terminals focuses existing terminal tabs and marks the active terminal.
- Added session refresh, custom storage-directory settings, and handling for deleted session files and unavailable projects.

## 0.5.0

- Added Prime Agent (`prime-agent`) to the sidebar, agent picker, editor buttons and terminal profiles, including configurable executable paths, arguments, favorites and themed Prime Intellect icons.
- Mark agents as favorites with the star button in the sidebar. Favorites appear first, retain the original harness order within each group, and persist across window reloads and workspaces in the same VS Code profile.

## 0.4.0

- Added a Multi-Harness Activity Bar launcher listing all twelve agents with their themed icons. Click an agent to open its editor-area terminal using the existing executable, arguments, launch mode and workspace selection.
- Added a gear button in the Agents view header and an Open Settings command to open settings filtered to this extension.
- Added the YEÖ mark to the Activity Bar terminal icon and the Multi-Harness YEÖ panel title, with English and Turkish localization.
- Editor title-bar buttons, the agent picker and terminal profiles remain available alongside the sidebar launcher.

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
