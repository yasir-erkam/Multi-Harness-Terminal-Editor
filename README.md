# Multi-Harness Terminal Editor

Run sixteen AI coding-agent CLIs in native editor-area terminals. Select an agent to browse its saved conversations for your project, resume a session, and keep your favorite agents within reach.

[Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yasir-erkam-ozdemir.multi-harness-terminal-editor) · [Install from Open VSX](https://open-vsx.org/extension/yasir-erkam-ozdemir/multi-harness-terminal-editor) · [Download a VSIX](https://github.com/yasir-erkam/Multi-Harness-Terminal-Editor/releases/latest)

![Workflow overview: select an agent, open a new terminal or resume a supported saved session, and switch between editor-area terminal tabs.](media/readme-overview.png)

![Demo: single-click an agent to list its saved sessions for the project, then select a session to resume it in an editor-area terminal tab.](docs/images/demo.gif)

<!-- Screenshot placeholder: uncomment once a clean capture exists in docs/images/ (see docs/images/README.md).
![Several agent CLIs running side by side as editor-area terminal tabs.](docs/images/editor-terminals.png)
-->

## Quick start

1. Install the extension and the agent CLI you want to use in the environment where the extension runs. For code-server or a Dev Container, install the CLI inside the container; for Remote-SSH, install it on the remote host. Complete the CLI’s own authentication setup. If it cannot be found automatically, set `multiHarness.<id>.executablePath` to its absolute path.
2. Open a trusted project folder and select **Multi-Harness YEÖ** in the Activity Bar.
3. **Single-click an agent** to show its saved conversations for the current project.
4. **Double-click the agent** to open its editor-area terminal, or select a saved conversation to resume it.
5. Use the star to favorite an agent and the gear to open extension settings.

Saved conversations are supported for **Codex, Claude Code, OpenCode, Pi, Oh My Pi, Prime Agent, Antigravity CLI, DeepSeek Harness and Grok Build**. All sixteen agents can open terminals. **Open Terminals** focuses an existing tab; **Sessions** shows saved history, including conversations whose terminal tabs are closed.

The sidebar uses native VS Code lists for agents, saved sessions and open terminals. The selected agent is remembered per workspace.

The [harness feature and session-lifecycle standard (Türkçe)](docs/harness-standard.md) defines required behavior for terminal launch, saved-history listing/resume, safe single/bulk deletion and closing matching tabs. It separates target requirements from the current per-harness support matrix and lists acceptance scenarios and known gaps.

## What it is

Multi-Harness Terminal Editor opens AI coding-agent CLIs — "harnesses" — as **native VS Code terminals in the editor area**. Open any of the sixteen supported agents from the Activity Bar launcher, an optional editor title-bar button, or the agent picker. Editor title-bar buttons ship **off by default** and are toggled on per agent. The terminals are ordinary editor-area terminals: they can be split, moved, reordered and closed like any other tab.

## Features

- **Native sidebar.** Agents, saved sessions and open terminals appear in native VS Code lists with favorites, project and location filters, settings and launch commands.

- **Activity Bar launcher.** The Multi-Harness YEÖ sidebar lists all sixteen agents and includes a gear button for extension settings. Click an agent once to select it and show its saved sessions for the current project; double-click to open its terminal.
- **Favorite agents.** Hover over an agent and click the star to keep it at the top of the sidebar. Click the filled star to remove it. Favorites persist across window reloads and workspaces in the same VS Code profile.
- **Saved sessions.** The Sessions view lists up to 100 recent conversations for the selected agent whose recorded working directory matches the current project folder. Launch an agent, focus its terminal, or use Select Session Agent in the Sessions header to change the agent filter. In multi-root workspaces the folder follows the active editor and stays selected while focus moves to the sidebar or terminal. Symlink aliases match the same directory. This preview supports Codex, Claude Code, OpenCode, Pi, Oh My Pi, Prime Agent, Antigravity CLI, DeepSeek Harness and Grok Build. Click a conversation to resume its exact record; closed tabs do not remove saved history. The selected agent's history is checked automatically every three seconds after each scan finishes; new records, title changes and external deletions update the list without manual refresh. Use Refresh Sessions for an immediate rescan. Unsupported agents show an explanation instead of another agent's history.
- **Planned saved-session integrations.** Saved-session support for Gemini CLI, Goose, Aider, Crush, Qwen Code, Copilot CLI and Cursor Agent is planned for future work; it is not available yet.
- **Session location scope.** Use the globe button in the Sessions header to switch between **Current location** and **All locations**. All locations removes only the project-folder filter: the selected agent and 100-conversation limit remain unchanged, and no open folder is required. The choice is remembered per workspace. Changing location scope clears deletion selections; resumed conversations still open in their recorded directory.
- **Open terminals.** The Open Terminals view lists open agent terminal tabs, including resumed sessions, using their current terminal titles. Conversations with the same title remain separate by their saved identity. Click a row to focus that exact terminal, or its close (×) button to close it and stop its running process. A dot marks the active terminal. Saved conversation files are kept; this view is separate from saved history and does not claim to track agent process state.
- **Delete saved conversations.** Available for Codex, Claude Code, Pi, Oh My Pi, Prime Agent, DeepSeek Harness, OpenCode and Grok Build. Antigravity history is read-only. Use a session's trash button or right-click menu for one conversation. Choose Select Sessions in the Sessions header to enter selection mode, mark conversations with checkboxes, then Delete Selected Sessions. Select All Listed Sessions selects the currently listed agent/location results (up to 100). Selections survive refreshes and title changes, and clear when you change agents, projects or location scope. The confirmation lists the selected titles. For JSONL providers the extension first tries Trash / Recycle Bin; if that fails, permanent deletion requires a separate explicit confirmation. OpenCode instead requires explicit permanent-deletion approval and removes the selected conversation and its descendants, messages and parts through its native storage layout, never by deleting the shared database. Unsuccessful deletions remain selected. The selected conversation's JSONL record is removed; for DeepSeek, matching sibling `session[.v<N>].jsonl[.zstd]` generations are validated and removed first so old migrations cannot reappear. Auxiliary indexes, artifacts and unrelated history are preserved. Files containing multiple conversation identities are refused. Terminals linked by their saved conversation identity close after successful deletion, including renamed terminals and reconnected terminals whose identity can be recovered. OMP also follows live terminal breadcrumbs for fresh and switched conversations on Linux, Windows and macOS. On Linux/code-server, Codex also matches fresh and switched conversations through writable live rollout files, including shell/Node launchers and reconnection. On Windows desktop VS Code, Codex deletion also matches writable session-file handles to the terminal's Codex process tree, including PowerShell/Node launchers and in-process switches. Read-only handles do not identify the active conversation. This requires Windows PowerShell, CIM and native process-handle access; if inspection is restricted, saved resume identity remains the fallback. Outside those Codex deletion paths, the remaining providers identify resumed conversations only: fresh sessions and in-process conversation switches cannot be tracked reliably, so a tab may remain open or retain its original resume identity. Close such a terminal through Open Terminals before deleting its history. Canceled or failed deletions keep their terminals open. A terminal-close failure is reported separately from file deletion and does not trigger a permanent-deletion prompt. Resuming is disabled while deletion is in progress. On older VS Code builds without native tree checkboxes, selection uses check marks and row clicks.

  **Windows Codex and the shared daemon:** New local interactive Codex launches (including resume, shell mode and terminal profiles) probe the configured executable's `--help` and add `--no-daemon` only when supported. This keeps the writable rollout in that terminal's process tree instead of a shared background server. Common local model/sandbox/profile options are supported; explicit `--no-daemon`, remote routing, custom subcommands/prompts and unrecognized arguments are left untouched. Older CLIs or failed capability probes also retain their original arguments. With custom arguments, add `--no-daemon` yourself if your CLI supports it and you want per-terminal deletion matching. Existing daemon-connected tabs must be closed and freshly launched to gain this ownership behavior; a shared daemon's file handles cannot safely identify a tab, so those tabs may remain open after history deletion. Linux/macOS launch behavior is unchanged; daemon-backed Codex on those platforms has the same file-ownership limitation. The extension does not record prompts or alter/stop the shared daemon.

- **Sixteen agents.** Each agent has an id (for example `claudeCode`, `openCode`, `ohMyPi`) that drives its command, settings and icon.
- **New conversations.** Opening an agent from Agents, the picker or its command starts a new terminal each time. Use **Open Terminals** to focus an existing tab. Saved conversations reuse terminals by conversation identity, so resuming the same conversation does not start a duplicate process.
  Concurrent requests to resume the same conversation share one pending launch. Different conversations remain independent; closing a terminal or a failed launch does not prevent a later resume.
  On Linux/code-server, Oh My Pi resumes also check writable session descriptors in other OMP processes. If the conversation is already being written outside this window, a warning replaces the second launch; switch to its existing terminal or close it before resuming here. This best-effort check requires readable `/proc` and is not an atomic cross-window launch lock. Windows/macOS retain same-window terminal reuse only.
- **Session topic tab titles.** The active terminal follows its saved conversation title in the form `omp - 🏷️ SEKME: Sekmede ajan yerine oturum konusunu göster`. Titles are checked every three seconds and when terminal focus changes, without focusing another tab. OMP uses its terminal/session breadcrumb, including new conversations and session switches; other supported history providers use the saved identity of resumed conversations. Emoji and title text are preserved. Without a matching saved record, the CLI/process title remains unchanged. Existing OMP terminals created before terminal identity tracking must be reopened once.
  Resumed terminals receive the saved topic immediately at creation in both launch modes; later topic changes continue to use the periodic refresh.
- **Sessions use the full editor area by default.** Opening or focusing an agent terminal joins split editor groups into a single group, preserving all open tabs. Set `multiHarness.useFullEditorArea` to `false` to keep your split layout. Terminal profiles open in the active editor group without adding a split.
- **Terminal persistence.** Agent terminals allow VS Code/code-server to reconnect after a window reload or reopening the browser tab in the same workspace when `terminal.integrated.enablePersistentSessions` is enabled. This applies to direct launches, shell launches, resumed conversations and terminal profiles. Conversation identity survives reloads even when terminal titles change (Linux/code-server also recovers identity from the running process if restored launch options are unavailable), and restored shell terminals regain status tracking without rerunning the agent command. Commands started before the reload show an unknown duration if their start event was missed. Existing terminals created by older extension versions must be reopened once to use persistence and identity tracking. After a server/container restart, restoring a terminal may start a new process; it does not guarantee that an agent conversation resumes. Shell mode may restore only the shell after a process restart; use Saved Sessions to resume a recorded conversation.
- **Agent picker.** `multiHarness.openAgentPicker` — **Multi-Harness: Open Agent...** in the Command Palette — shows a Quick Pick over all sixteen harnesses and opens the one you choose; handy when you keep the title-bar icons hidden.
- **Optional shell launch mode with live status.** `multiHarness.launchMode: "shell"` runs agents through your shell so a status-bar item can report running/finished state, duration and exit code; the default `direct` mode is unchanged. See [Launch modes](#launch-modes).
- **Terminal profile dropdown.** Every agent is also contributed as a VS Code terminal profile (`multiHarness.<id>`), so you can start one from the terminal panel's `+` dropdown; a profile cannot launch if its executable cannot be resolved.
- **Per-agent editor title-bar icons.** Every agent has its own toggle, `multiHarness.show<Id>Icon` (boolean, default `false`). Enable only the agents you want in the editor title bar.
- **Exit notifications.** With `multiHarness.notifyOnExit` enabled (default `false`), the extension shows a notification containing the exit code when an agent terminal closes, so a crashed or non-zero CLI does not pass unnoticed.
- **Automatic exit cleanup.** New direct-mode terminals (including resumes and terminal profiles) close automatically only when the CLI exits successfully (`0`). Failed, signaled and unknown exits keep their output open until you press a key or close the tab. Set `multiHarness.autoCloseOnExit` to `never` to retain every exit, or `always` to close every exit, including errors. The policy is captured at launch; existing terminals are unchanged. Shell-mode terminals keep their shell open when the agent command finishes. Saved conversations are never deleted by this policy. Direct terminals use a small inherited-stdio Node launcher so the real terminal/TTY stays available to the CLI; closing a retained tab reports the original CLI exit code where available.
  A retained output tab is not a running conversation: resume starts a new CLI rather than reusing that tab, and saved-history deletion does not close its retained error output. Exit markers survive window reloads and are removed when the terminal tab closes.
  Linux/code-server also recovers the validated exit-marker path from the wrapper process when restored launch options are missing, so a reconnected retained tab is not mistaken for a running CLI.
- **Multi-root workspaces.** Agent terminals use a workspace folder as their working directory; the extension does not assume a single-folder workspace.
- **Configurable launch.** For each agent you can override the executable with `multiHarness.<id>.executablePath` and add extra CLI flags with `multiHarness.<id>.arguments`.
- **No production npm dependencies.** Terminal launch uses the extension-host Node runtime; agent CLIs remain separately installed.

## Other ways to open an agent

- Run **Multi-Harness: Open Agent...** in the Command Palette, or one of the **Multi-Harness: Open &lt;Agent&gt;** commands.
- Choose an agent from the terminal profile dropdown.
- Enable its `multiHarness.show<Id>Icon` setting to add an editor title-bar button. These buttons are off by default; the Activity Bar launcher is always available.

## Supported agents

The default order follows descending GitHub repository star counts from a fixed **2026-10-20** snapshot (with Grok Build added using its **2026-10-28** count). Favorites stay first; both favorite and other agents follow the default order. Agents without a verified product-specific repository appear last alphabetically, not as zero-star entries. This is not a live ranking or a measure of CLI usage. See [exact counts, sources and limitations](docs/agent-order.md).

| Harness id | Display name | Open command | Default executable |
| --- | --- | --- | --- |
| `deepseek` | DeepSeek Harness | `multiHarness.openDeepseek` | `dsh` |
| `openCode` | OpenCode | `multiHarness.openOpenCode` | `opencode` |
| `claudeCode` | Claude Code | `multiHarness.openClaudeCode` | `claude` |
| `codex` | Codex | `multiHarness.openCodex` | `codex` |
| `pi` | Pi Agent | `multiHarness.openPi` | `pi` |
| `gemini` | Gemini CLI | `multiHarness.openGemini` | `gemini` |
| `goose` | Goose | `multiHarness.openGoose` | `goose` |
| `aider` | Aider | `multiHarness.openAider` | `aider` |
| `ohMyPi` | Oh My Pi | `multiHarness.openOhMyPi` | `omp` |
| `crush` | Crush | `multiHarness.openCrush` | `crush` |
| `qwen` | Qwen Code | `multiHarness.openQwen` | `qwen` |
| `grokBuild` | Grok Build | `multiHarness.openGrokBuild` | `grok` |
| `primeAgent` | Prime Agent | `multiHarness.openPrimeAgent` | `prime-agent` |
| `copilot` | Copilot CLI | `multiHarness.openCopilot` | `copilot` |
| `antigravity` | Antigravity CLI | `multiHarness.openAntigravity` | `agy` |
| `cursorAgent` | Cursor Agent | `multiHarness.openCursorAgent` | `cursor-agent` |

Install [Grok Build](https://github.com/xai-org/grok-build#installing-the-released-binary) separately in the environment where the extension runs and complete its own authentication. Official releases use the `grok` command with no required startup arguments. The default `~/.grok/bin` installer directory is discovered automatically on Linux, macOS and Windows. Custom `GROK_BIN_DIR` installs must be on PATH or configured explicitly. Set `multiHarness.grokBuild.executablePath` if it is not found, and `multiHarness.grokBuild.arguments` for custom flags. A source build produces `xai-grok-pager` instead; point the executable setting at that binary. Grok Build supports terminal launch, favorites, terminal profiles and an optional editor title-bar icon (`multiHarness.showGrokBuildIcon`); saved-history listing and resume are supported. Grok session dates use the latest user/assistant message timestamp found in bounded head/tail reads of `updates.jsonl`; opening, resuming, renaming and mode changes do not advance them. When no valid message timestamp is found in those windows, the creation date is used. Saved sessions are read from `~/.grok/sessions`, or `$GROK_HOME/sessions` when `GROK_HOME` is set. Override this with `multiHarness.grokBuild.sessionDirectory`. To resume from a custom store, select `<GROK_HOME>/sessions`; the terminal receives its parent as `GROK_HOME`, which also selects that home’s authentication and configuration. Other directory layouts show an error when resumed. Grok Build supports confirmed single and bulk deletion through Trash, with a separate permanent-deletion confirmation if Trash fails. The whole validated session directory is removed. Unknown files, links and nonempty nested data are refused; use Grok’s own deletion for those records. On Linux, verified `active_sessions.json` process-start identities track fresh/switched conversations and prevent resuming a conversation already open elsewhere. A process holding multiple conversations remains ambiguous. Registry-disabled/headless sessions can be absent. macOS and Windows retain saved resume identity; live ownership tracking is unavailable there.

Install [Antigravity CLI](https://antigravity.google/download#antigravity-cli) in the environment where the extension runs (the code-server container for remote development). Its command is `agy`; default locations are `~/.local/bin/agy` on Linux/macOS and `%LOCALAPPDATA%\agy\bin` on Windows. Both are discovered automatically. Saved sessions are read from `~/.gemini/antigravity-cli/conversation_summaries.db` and resumed with `agy --conversation <id>`. This requires an extension host with `node:sqlite` (Node.js 22.13+); unavailable SQLite support appears as an unreadable-store notice. Antigravity history is read-only: deletion is not supported.

OpenCode saved history is read locally from `~/.local/share/opencode/opencode.db` (also under the user's home directory on Windows), or `$XDG_DATA_HOME/opencode/opencode.db` when `XDG_DATA_HOME` is set. SQLite history requires an extension host with `node:sqlite` support (Node.js 22.13+). When the database is absent, older JSON records under `storage/session/<projectID>/<id>.json` are supported; an existing database is authoritative, so legacy files are not mixed into its results. Only top-level, non-archived sessions are listed. Selecting one resumes it with `opencode --session <id>` in its recorded project directory. OpenCode deletion requires explicit permanent-deletion confirmation. SQLite deletion runs in a transaction and keeps the shared database and unrelated conversations. Legacy deletion validates the selected session family and related files before removing them. Session identity, project directory and canonical store boundaries are rechecked; symlinks and unsupported schemas are refused.
Deletion affects local history only; it does not revoke externally published OpenCode shares. Stop fresh or switched OpenCode conversations before deleting them, because only resumed terminal identities can be matched reliably.

## Commands

The following commands appear in the Command Palette under the `Multi-Harness` category and can be assigned keyboard shortcuts. Session-row actions such as resume, close and delete are available through the sidebar and are hidden from the palette.

| Command ID | Palette label | Description |
| --- | --- | --- |
| `multiHarness.openAgentPicker` | Open Agent... | Quick Pick over all sixteen harnesses. |
| `multiHarness.openSettings` | Open Settings | Open settings filtered to this extension. |
| `multiHarness.refreshSessions` | Refresh Sessions | Reload saved conversations for the selected agent and project. |
| `multiHarness.selectSessionAgent` | Select Session Agent | Choose the agent whose saved conversations are shown. |
| `multiHarness.toggleSessionLocationScope` | Switch Sessions: Current Location / All Locations | Toggle the project-folder filter while keeping the selected agent. |
| `multiHarness.openDeepseek` | Open DeepSeek Harness | Open a DeepSeek Harness terminal. |
| `multiHarness.openOpenCode` | Open OpenCode | Open an OpenCode terminal. |
| `multiHarness.openClaudeCode` | Open Claude Code | Open a Claude Code terminal. |
| `multiHarness.openCodex` | Open Codex | Open a Codex terminal. |
| `multiHarness.openPi` | Open Pi Agent | Open a Pi Agent terminal. |
| `multiHarness.openGemini` | Open Gemini CLI | Open a Gemini CLI terminal. |
| `multiHarness.openGoose` | Open Goose | Open a Goose terminal. |
| `multiHarness.openAider` | Open Aider | Open an Aider terminal. |
| `multiHarness.openOhMyPi` | Open Oh My Pi | Open an Oh My Pi terminal. |
| `multiHarness.openCrush` | Open Crush | Open a Crush terminal. |
| `multiHarness.openQwen` | Open Qwen Code | Open a Qwen Code terminal. |
| `multiHarness.openGrokBuild` | Open Grok Build | Open a Grok Build terminal. |
| `multiHarness.openPrimeAgent` | Open Prime Agent | Open a Prime Agent terminal. |
| `multiHarness.openCopilot` | Open Copilot CLI | Open a Copilot CLI terminal. |
| `multiHarness.openAntigravity` | Open Antigravity CLI | Open an Antigravity CLI terminal. |
| `multiHarness.openCursorAgent` | Open Cursor Agent | Open a Cursor Agent terminal. |

## Settings

Every setting lives under the `multiHarness` section.

For the nine supported session providers, `multiHarness.<id>.sessionDirectory`
can override the session storage root with an absolute path (or a path starting
with `~/`). Leave it empty to use the agent's default store. Conversation metadata
is read locally; JSONL reads are bounded, and missing or malformed records are
skipped, and directory access failures appear in the session list. A saved
session cannot resume if its file or original project directory is unavailable.

If an agent moves its session store or changes to an unrecognized file format,
Sessions stays empty and the terminal launcher remains usable. Set
`multiHarness.<id>.sessionDirectory` to the new storage directory when known,
then refresh Sessions. A path override supports a moved store; a changed file
format may require an extension update.

Agent or project changes cancel outdated scans. JSONL directory traversal is
limited to 20,000 entries and four directory levels below the storage root; a
notice indicates the entry limit or access failures. Antigravity and OpenCode
SQLite scans read up to 5,000 recent index entries before filtering by project. Only the latest 100
matching conversations are displayed.
After fixing a path or permission, use **Refresh Sessions** to try again.
Resumed conversations use their recorded project's CLI settings and directory.

### Full settings reference

**Launch mode**

| Setting | Type / values | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.launchMode` | `"direct"` or `"shell"` | `"direct"` | `window` |

See [Launch modes](#launch-modes) for shell integration and status tracking.

**Session storage overrides — `multiHarness.<id>.sessionDirectory`**

All nine settings are strings, default to `""` (use the default store), and have
`machine-overridable` scope. Set the directory containing the agent’s history,
not an individual conversation file.

| Setting | Default storage directory |
| --- | --- |
| `multiHarness.codex.sessionDirectory` | `~/.codex/sessions` |
| `multiHarness.claudeCode.sessionDirectory` | `~/.claude/projects` |
| `multiHarness.openCode.sessionDirectory` | `~/.local/share/opencode` |
| `multiHarness.pi.sessionDirectory` | `~/.pi/agent/sessions` |
| `multiHarness.ohMyPi.sessionDirectory` | `~/.omp/agent/sessions` |
| `multiHarness.primeAgent.sessionDirectory` | `~/.prime/agent/sessions` |
| `multiHarness.antigravity.sessionDirectory` | `~/.gemini/antigravity-cli` |
| `multiHarness.deepseek.sessionDirectory` | `~/.dsh/sessions` |
| `multiHarness.grokBuild.sessionDirectory` | `~/.grok/sessions` |

These defaults use the extension host’s home directory. When no setting override
is provided, discovery also honors `CODEX_HOME`, `CLAUDE_CONFIG_DIR`,
`PI_CODING_AGENT_SESSION_DIR` / `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`,
`PRIME_AGENT_SESSION_DIR` / `PRIME_AGENT_CODING_AGENT_DIR`, `DSH_HOME`,
`GROK_HOME` (with a `sessions` subdirectory), and
`XDG_DATA_HOME` (with an `opencode` subdirectory) for their respective agents.
Prime also honors the legacy `PRIME_AGENT_CODING_AGENT_SESSION_DIR` when
`PRIME_AGENT_SESSION_DIR` is unset. Recursive Prime subagent records (`rlmDepth > 0`)
are excluded from saved history; root forks remain visible. Clearing a Prime
session name restores the first user message as its display title.
For Codex, point to the `sessions` directory; its optional title index is read
from the parent directory. For OpenCode, point to the data root containing
`opencode.db` or the legacy `storage/` directory, not to the database file or
an individual session record.

**Editor layout**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.useFullEditorArea` | `boolean` | `true` | `window` |

Enabled: opening, resuming or focusing an agent terminal joins editor groups,
preserving all open tabs. Disabled: terminals use their existing group or open
in the active group, keeping the split layout. The setting applies on the next
interaction without reloading; disabling it does not restore previously joined
groups. Terminal profile launches always use the active group.

**Icon toggles — `multiHarness.show<Id>Icon`**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.showDeepseekIcon` | `boolean` | `false` | `window` |
| `multiHarness.showOpenCodeIcon` | `boolean` | `false` | `window` |
| `multiHarness.showClaudeCodeIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCodexIcon` | `boolean` | `false` | `window` |
| `multiHarness.showPiIcon` | `boolean` | `false` | `window` |
| `multiHarness.showGeminiIcon` | `boolean` | `false` | `window` |
| `multiHarness.showGooseIcon` | `boolean` | `false` | `window` |
| `multiHarness.showAiderIcon` | `boolean` | `false` | `window` |
| `multiHarness.showOhMyPiIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCrushIcon` | `boolean` | `false` | `window` |
| `multiHarness.showQwenIcon` | `boolean` | `false` | `window` |
| `multiHarness.showPrimeAgentIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCopilotIcon` | `boolean` | `false` | `window` |
| `multiHarness.showAntigravityIcon` | `boolean` | `false` | `window` |
| `multiHarness.showCursorAgentIcon` | `boolean` | `false` | `window` |

**Executable overrides — `multiHarness.<id>.executablePath`** (machine-overridable; reset the setting to use the default executable)

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.deepseek.executablePath` | `string` | `"dsh"` | machine-overridable |
| `multiHarness.openCode.executablePath` | `string` | `"opencode"` | machine-overridable |
| `multiHarness.claudeCode.executablePath` | `string` | `"claude"` | machine-overridable |
| `multiHarness.codex.executablePath` | `string` | `"codex"` | machine-overridable |
| `multiHarness.pi.executablePath` | `string` | `"pi"` | machine-overridable |
| `multiHarness.gemini.executablePath` | `string` | `"gemini"` | machine-overridable |
| `multiHarness.goose.executablePath` | `string` | `"goose"` | machine-overridable |
| `multiHarness.aider.executablePath` | `string` | `"aider"` | machine-overridable |
| `multiHarness.ohMyPi.executablePath` | `string` | `"omp"` | machine-overridable |
| `multiHarness.crush.executablePath` | `string` | `"crush"` | machine-overridable |
| `multiHarness.qwen.executablePath` | `string` | `"qwen"` | machine-overridable |
| `multiHarness.primeAgent.executablePath` | `string` | `"prime-agent"` | machine-overridable |
| `multiHarness.copilot.executablePath` | `string` | `"copilot"` | machine-overridable |
| `multiHarness.antigravity.executablePath` | `string` | `"agy"` | machine-overridable |
| `multiHarness.cursorAgent.executablePath` | `string` | `"cursor-agent"` | machine-overridable |

**Extra arguments — `multiHarness.<id>.arguments`**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.deepseek.arguments` | `array` of `string` | `["--profile", "tui"]` | `resource` |
| `multiHarness.openCode.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.claudeCode.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.codex.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.pi.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.gemini.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.goose.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.aider.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.ohMyPi.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.crush.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.qwen.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.primeAgent.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.copilot.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.antigravity.arguments` | `array` of `string` | `[]` | `resource` |
| `multiHarness.cursorAgent.arguments` | `array` of `string` | `[]` | `resource` |

**Exit policy and notifications**

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `multiHarness.notifyOnExit` | `boolean` | `false` | `window` |
| `multiHarness.autoCloseOnExit` | `success` / `never` / `always` | `success` | `window` |

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

The extension adds no default keyboard shortcuts. Terminal key handling follows
VS Code settings, your keybindings and, in code-server, the browser’s shortcuts.

To forward Quick Open’s shortcut to the terminal, add this to `settings.json`:

```json
{
  "terminal.integrated.commandsToSkipShell": ["-workbench.action.quickOpen"]
}
```

Commands in `terminal.integrated.commandsToSkipShell` are handled by VS Code;
a leading `-` removes a command from that set. For broader forwarding, enable
`terminal.integrated.sendKeybindingsToShell`; terminal Find shortcuts will then
also be forwarded. Set `terminal.integrated.allowChords` to `false` if a chord
prefix such as Ctrl+K needs to reach the CLI. These settings are explained in
[VS Code’s terminal keyboard documentation](https://code.visualstudio.com/docs/terminal/advanced#_keyboard-shortcuts-and-the-shell).

Closing a terminal editor tab stops its process. Check **Preferences: Open
Keyboard Shortcuts** for the active close binding on your platform. For copy,
use Ctrl+Shift+C on Linux/Windows or Cmd+C on macOS; Ctrl+C normally interrupts
the CLI, although Windows can use it to copy selected text.

## Fonts & icons (Nerd Font, ligatures)

Terminal appearance is controlled by VS Code’s `terminal.integrated.*` settings.
For missing Nerd Font symbols, install a patched font and set
`terminal.integrated.fontFamily` to its family name. In browser-based
code-server, the font must be available to the browser on your local machine.

Ligatures can be enabled with `terminal.integrated.fontLigatures.enabled` on
builds that support it. The WebGL renderer draws some symbols itself when
`terminal.integrated.customGlyphs` is enabled, but it does not replace a full
Nerd Font. Setting `terminal.integrated.gpuAcceleration` to `off` disables that
custom rendering. Available options vary by VS Code/code-server version; see
[VS Code’s terminal appearance reference](https://code.visualstudio.com/docs/terminal/appearance).

## Restricted Mode

This extension declares `untrustedWorkspaces: { supported: false }`, so it is disabled while the workspace is in Restricted Mode (Workspace Trust has not been granted). Agents run commands inside your workspace, so the extension does not activate until you trust the folder. Trust the workspace or add it to your trusted folders to enable the icons, commands and terminals.

It also declares `virtualWorkspaces: { supported: false }`, so it remains disabled in virtual workspaces (for example GitHub Repositories), where spawning a local CLI process is not possible.

## Launch modes

`multiHarness.launchMode` (default `direct`) picks how an agent terminal starts:

- **`direct`** — the agent CLI *is* the terminal process: the extension passes its path as `shellPath`. This is the default launch mode.
- **`shell`** — the user's default shell profile starts instead, and the agent is run as a command inside it. That indirection is what makes command-level reporting possible, so shell mode is the only mode with the live status-bar readout: `$(sync~spin) <Agent>` while a command runs, then `$(check) <Agent> — <seconds>s (exit <code>)` (or `$(error) …`, and `exit ?` when the shell reports no code). The item hides itself ~30 s after the last command.

Status tracking is best-effort by design. Within 10 s of creating the terminal the extension waits for shell integration and then runs the agent with `executeCommand(executable, args)`, letting VS Code handle quoting. If integration never activates, it falls back to a quoted command line (`sendText`) and says so once in a non-blocking message — with a POSIX single-quote rule (`'` becomes `'\''`), or double quotes with doubled `"` on Windows.

Shell mode limitations:

- `cmd.exe` on Windows has no shell integration, so it always takes the quoted-command fallback. That fallback uses platform-based quoting and may not suit every shell; on Windows, `cmd.exe` can still expand `%VAR%` inside quoted arguments.
- A complex `PROMPT_COMMAND`, a non-standard shell prompt, or a subshell opened by your shell rc can prevent activation.
- Commands inside a plain `ssh` session may not emit shell-integration events in the local terminal. Use a Remote-SSH workspace to run the extension on the remote host.
- If shell integration injection is disabled in your VS Code settings, activation never happens.
- Terminal profiles from the profile dropdown always use direct mode: a profile has to return a runnable terminal, and the profile API offers no hook to await shell integration.

The shell-integration API is stable since VS Code 1.93. The extension still declares `engines.vscode: ^1.67.0`, feature-detects the API at runtime, and falls back to a direct-mode terminal when it is unavailable — so nothing breaks on older VS Code, shell mode simply behaves as `direct` there.

## Requirements

- **VS Code 1.67.0 or newer** (`engines.vscode: ^1.67.0`). The extension uses `TerminalOptions.location` / `TerminalLocation` (stable since 1.64), `isTransient` (stable since 1.65) and `window.tabGroups` with `TabInputTerminal` (stable since 1.67). Shell mode additionally needs the shell-integration API from **1.93+**; on older builds it degrades to direct launching (feature-detected at runtime).
- **A trusted, non-virtual workspace.** Because of the two capability declarations above, the extension does not activate in Restricted Mode or in virtual workspaces.
- `extensionKind: ["workspace"]` — it runs in the workspace extension host, where the terminal API is available.
- **An installed agent CLI and its own prerequisites.** The extension does not install or authenticate agents. No separate Node.js/npm installation is required by the extension itself; individual CLIs may require one. Antigravity saved history and OpenCode SQLite history additionally require an extension host with `node:sqlite` support (Node.js 22.13+).

## Known limitations

- **Stale `PATH`.** The extension host does not source your shell rc files, so a CLI installed *after* VS Code started may not be on `PATH` in that window. That is why the extension looks for the agent executable beyond `PATH`:
  - `<workspace>/node_modules/.bin`, then
  - on Windows `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm` and `%LOCALAPPDATA%\agy\bin`, and
  - on POSIX `~/.bun/bin`, `~/.local/bin` and `~/.npm-global/bin`,
  - before finally falling back to `PATH`.

  On Windows, if those lookups fail, fnm installations are also searched: `FNM_DIR`, `%APPDATA%\fnm`, `%LOCALAPPDATA%\fnm` and `~/.fnm`. The default Node alias is tried first, followed by installed Node versions from newest to oldest. This finds npm-installed agents even when PowerShell's temporary `fnm_multishells` path is absent from the extension host. Existing workspace, user-directory and `PATH` matches retain precedence. Installations are checked again on each launch, so a CLI installed later can be discovered without reloading.

  If an agent still is not found, set `multiHarness.<id>.executablePath` to its full path in the environment where the extension runs. For fnm, use the permanent `node-versions/<version>/installation/<agent>.cmd` path rather than a temporary `fnm_multishells` path.
- **Status reporting requires shell mode.** Direct mode does not report agent process state. Shell mode reports command start and finish when shell integration is available; it does not detect when an agent needs input.
- **Editor title-bar buttons are off by default.** Enable the matching `multiHarness.show<Id>Icon` setting to show them. The Multi-Harness Activity Bar launcher is available by default; you can also use `multiHarness.openAgentPicker`.

## Installation

### From the Marketplace

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for **Multi-Harness Terminal Editor** and verify the publisher is `yasir-erkam-ozdemir`.
3. Click **Install**, then reload the window if prompted.
4. Open **Multi-Harness YEÖ** in the Activity Bar. Optionally enable editor title-bar buttons with the `multiHarness.show<Id>Icon` settings.

For code-server and other Open VSX clients, install from [Open VSX](https://open-vsx.org/extension/yasir-erkam-ozdemir/multi-harness-terminal-editor), or use the VSIX below.

### From a VSIX file

1. Open the Extensions view and open the `…` (Views and More Actions) menu.
2. Choose **Install from VSIX…** and select the downloaded `.vsix` file.
3. Alternatively, run `code --install-extension /path/to/downloaded.vsix`, replacing the path with the actual file. For code-server, use `code-server --install-extension /path/to/downloaded.vsix` when its CLI is on `PATH`.

Get the current VSIX from [GitHub Releases](https://github.com/yasir-erkam/Multi-Harness-Terminal-Editor/releases/latest).

VSIX files are produced in `artifacts/` by `npm run package` (see [PUBLISHING.md](PUBLISHING.md)).

## Development

Use Node.js 22, matching CI, and install the locked development dependencies:

```bash
npm ci          # install dev dependencies from the lockfile
npm run check   # type check (tsc --noEmit)
npm run build   # bundle src/extension.ts to dist/extension.js with esbuild
npm run test    # unit tests plus manifest validation
npm run compile # check + build + test
npm run package # check + build + test, then artifacts/<name>-<version>.vsix
npm run dev:install # same validation and packaging, then install into local code-server
npm run icons   # regenerate all themed harness icons from vendored sources
```

For browser-based code-server (including Docker on Ubuntu Server), use
`npm run dev:install`, then run **Developer: Reload Window** in the Command
Palette. Enable the desired `multiHarness.show<Id>Icon` settings, check the icons
in light/dark themes and click a button to verify its terminal opens. Installation
uses `/usr/local/bin/install-extension` when available, otherwise the bundled
`/app/code-server/bin/code-server` CLI. These commands only install locally.

If Node/npm are not on PATH in the container, run the same workflow directly:

```bash
/app/code-server/lib/node scripts/dev.mjs install
```

The workflow reports its actual Node version. Node 22 remains the CI standard.
Build output belongs in `dist/`, temporary test bundles in `.build/`, and VSIX
packages in `artifacts/`. These directories are ignored by Git; old packages can
be retained in `artifacts/`, and rebuilding the same version replaces its package.

For desktop VS Code, press <kbd>F5</kbd> to launch the **Extension Development Host**.

`.github/workflows/ci.yml` runs `npm run package` (including check, build and tests)
on every push and pull request. `.github/workflows/release.yml` uses the same
package command on `v*` tags and publishes the exact versioned file from
`artifacts/`, attaching it to the GitHub release.

### Source repository

Source, issues and contributions are hosted at
[Multi-Harness-Terminal-Editor on GitHub](https://github.com/yasir-erkam/Multi-Harness-Terminal-Editor).
See [PUBLISHING.md](PUBLISHING.md) for release procedures.

## License

MIT. See [LICENSE](LICENSE).

## Icon credits

Editor title-bar and terminal icons use the harnesses' application marks,
including Claude Code's mascot, GitHub Copilot's robot, Gemini CLI's terminal
mark, and Crush's pixel heart. Eleven use upstream website or application assets;
Claude Code, Codex, GitHub Copilot and DeepSeek Harness use the corresponding LobeHub brand marks.
Brand colors are preserved; monochrome foregrounds adapt to light/dark themes.
Sources and licenses are recorded in
[media/THIRD_PARTY_NOTICES.md](media/THIRD_PARTY_NOTICES.md).
Regenerate all 30 themed harness icons offline with `node scripts/gen-icons.mjs`.
