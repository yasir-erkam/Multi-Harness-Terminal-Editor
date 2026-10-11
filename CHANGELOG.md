# Changelog

## 0.1.1

Adds searchable keywords to the extension listing (Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor Agent, Aider, Crush, Qwen Code, Goose).

## 0.1.0

Initial release.

- Opens 12 AI coding-agent CLIs (Claude Code, Codex, OpenCode, Pi Agent, Oh My Pi, Gemini CLI, Copilot CLI, Cursor Agent, Aider, Crush, Qwen Code, Goose) as editor-area terminal tabs.
- Reuses an existing tab for the same harness instead of spawning a duplicate process.
- Per-harness executable-path and argument settings; workspace `node_modules/.bin` lookup, conventional user-tool directories and `PATH`.
- Optional exit notifications (`multiHarness.notifyOnExit`).
- Editor title-bar icon buttons opt-in per harness.
