# Changelog

## 0.8.17

- Clarify that saved-session integrations for Gemini CLI, Goose, Aider, Crush, Qwen Code, Copilot CLI and Cursor Agent are future plans, not currently supported saved-session features.

## 0.8.16

- Order agents by descending GitHub repository stars from a documented 2026-10-20 snapshot instead of adoption surveys. Keep favorites first and agents without a verified product-specific repository in an alphabetical tail; preserve favorite and selected-agent settings. Include exact counts, upstream mappings and API sources in the ordering documentation.
- Support OpenCode saved conversations from its local SQLite database, with legacy JSON history when no database exists. List top-level, non-archived sessions in native and card layouts and resume the selected session with `opencode --session <id>` in its recorded project directory. Keep OpenCode history read-only; add a data-root override and honor `XDG_DATA_HOME`, with English and Turkish setting descriptions. SQLite history requires `node:sqlite` in the extension host.

## 0.8.15

- Group saved sessions by the local calendar day of their last user or assistant message, newest days and conversations first, in both card and list views. Creation and title-update timestamps do not move conversations between days. Stores without readable message timestamps retain their file/index modification-time fallback.
- Make Windows regression fixtures use native path separators, junctions and executable suffixes; report file-symlink scenarios as skipped only when Windows denies symlink creation. Compare generated SVGs independently of checkout line endings.
- Hide OMP helper-agent conversations by their first user message's agent attribution, including copied task transcripts whose parent path is stale. Preserve real user conversations and forks.

## 0.8.14

- Require successful validation and an existing VSIX output before any gallery publish or GitHub release. Both galleries receive the same validated package.
- Restore explicit project scope in the cross-platform OMP deletion regression. Includes session-topic tab titles.

## 0.8.13

- Correct the card-view regression fixture to reopen a previously closed terminal before testing its actions. Includes the session-topic tab titles from 0.8.12.

## 0.8.12

- Show the saved session topic in the active terminal tab as `<agent command> - <session title>`, preserving emoji. Follow OMP terminal/session breadcrumbs and resumed conversation identities; refresh on focus and every three seconds without stealing focus.
- Keep a regression for OMP title changes, session switches and focus changes during history reads.

## 0.8.11

- Agents, agent commands and the picker now open a fresh terminal instead of revealing the agent's previous default terminal. Saved conversations still focus the terminal matching their conversation identity.
- Let fresh terminal and profile titles follow CLI title updates instead of pinning the agent name. Keep agent selection, open-terminal lists, status and exit notifications independent of editable terminal titles.
- Remove the fixed title from resumed terminals in both direct and shell modes so agent-assigned session names can update the tab. Conversation reuse still follows saved identity after a title change.
- OMP oturumu başarıyla silindiğinde açık sekmesini kapatmak için güncel terminal–oturum eşlemesini kullan. Windows'ta yeni açılan OMP terminallerine benzersiz terminal kimliği ver; oturum terminal içinde değiştirildiğinde eski konuşmanın silinmesi yanlış sekmeyi kapatmasın.
- Ana dosyası silinmiş OMP advisor ve alt-agent kayıtlarını da Sessions listesinden dışla. Gerçek dallanmış konuşmaları ve kullanıcının “session update” başlıklı oturumlarını koru.
- Kapanma bildirimi gelen veya işlemi bitmiş terminalleri açık oturum listesinden çıkar; VS Code terminal listesini henüz güncellememiş olsa da OMP'nin “Session updated” satırı açık oturum olarak kalmasın. Kayıtlı konuşma geçmişi korunur.

## 0.8.10

- Sessions altında mevcut konum ve tüm konumlar arasında geçiş ekle. Seçili ajan korunur; kapsam çalışma alanı başına hatırlanır ve kart/liste görünümleri arasında paylaşılır. Tüm konumlar açık klasör olmadan da çalışır.

## 0.8.9

- OMP kayıtlı konuşma taramasında ana oturuma ait yardımcı kayıt klasörlerini dışla; advisor ve iç içe alt ajan geçmişlerini bağımsız, yinelenen konuşmalar olarak gösterme. Ana konuşmalar ve yardımcı kayıt dosyaları korunur.

## 0.8.8

- Support DeepSeek Harness saved sessions (`~/.dsh/sessions`, `DSH_HOME`, and `multiHarness.deepseek.sessionDirectory`), including Zstandard-compressed (`session.v<N>.jsonl.zstd`) and plain JSONL records, `session/title` and user prompt titles, subagent filtering, safe deletion, and resumption with `dsh --profile tui --resume <id>`.

## 0.8.7

- Add DeepSeek Harness (`dsh`) to the agent list, cards, picker, favorites, terminal profiles and optional editor title-bar buttons, with English and Turkish settings and themed icons.
- Default `multiHarness.deepseek.arguments` to `["--profile", "tui"]` while preserving custom executable paths and argument overrides in launch commands and terminal profiles.
- Keep DeepSeek Harness saved-session history isolated from other agents, and add regression checks for executable discovery, default and overridden arguments, picker actions, and profile contributions.

## 0.8.6

- Close terminals linked to successfully deleted saved conversations in both native and card layouts, including renamed and reconnected terminals. Match agent and saved conversation identity so unrelated terminals stay open.
- Keep linked terminals open when deletion is canceled or fails, including declined permanent deletion after Trash is unavailable.

## 0.8.5

- Allow agent terminals to persist across window reloads and browser reconnections when terminal persistence is enabled, including direct launches, shell launches, saved conversations and terminal profiles.
- Preserve saved-conversation identity independently of terminal titles so restored sessions reuse the correct terminal. On Linux/code-server, recover identity from the running process when restored launch options are unavailable.
- Restore shell status tracking for terminals present at startup or reconnected later without rerunning agent commands. Commands whose start event was missed show an unknown duration. Existing terminals must be reopened once to receive the new persistence and identity options.

## 0.8.4

- Show Antigravity CLI saved conversations for the current project in native and card layouts, reading its SQLite summary index locally and resuming the selected conversation with `agy --conversation <id>`.
- Add an Antigravity session directory setting with English and Turkish descriptions. Skip subagent, empty, malformed and missing conversations; resolve encoded workspace paths and symlink aliases.
- Keep Antigravity history read-only and disable its deletion controls. Other session providers retain their existing deletion workflow. Antigravity history requires `node:sqlite` in the extension host.

## 0.8.3

- Show saved conversation titles in resumed terminal tabs instead of session IDs, while reusing terminals by saved identity so duplicate titles stay separate.

## 0.8.2

- Close individual Open Terminals directly from list and card layouts, with English and Turkish labels. Closing a terminal stops its running process and keeps saved conversation files.

## 0.8.1

- Order agents by a documented adoption snapshot across the native list, cards, pickers, terminal profile contributions and optional editor buttons. Keep favorites first and place agents without comparable usage data last alphabetically.

## 0.8.0

- Added Antigravity CLI (`agy`) to the agent list, cards, picker, favorites, terminal profiles and optional editor buttons, with English/Turkish settings and themed icons.
- Discover Antigravity in conventional Linux/macOS and Windows installation directories without PATH. Preserve custom executable paths and arguments in commands and profiles.
- Keep Antigravity saved-session history unsupported and isolated from other agents. Add Linux regression checks for executable discovery, custom launch settings, picker and card actions.
- Added a README workflow overview graphic.

## 0.7.0

- Delete individual saved conversations from Sessions using the trash button or native context menu. Select multiple conversations with checkboxes and delete them together in native and card layouts; card Select All respects search results.
- Keep selections across refreshes and title changes, share them between layouts, and clear them when the agent or project changes. Open terminals keep running.
- Confirm before moving conversation files to Trash / Recycle Bin, and require separate explicit approval for permanent deletion if Trash fails. Keep unsuccessful deletions selected and report errors. Revalidate file identity and store boundaries before deleting, refusing files shared by different conversations.

## 0.6.4

- Fixed Windows npm/pnpm directory discovery when launch commands use the host platform implicitly.
- Discover npm-installed agents in permanent Windows fnm installations when the extension host does not inherit PowerShell's temporary multishell PATH. Prefer existing PATH matches and the fnm default alias before trying other installed versions; detect later installations on the next launch.

## 0.6.3

- Added `multiHarness.useFullEditorArea` (enabled by default). Disable it to preserve split editor groups when opening, resuming or focusing agent terminals. Setting changes apply on the next interaction without reloading.

## 0.6.2

- Opening or focusing an agent terminal joins existing split editor groups into one group, preserving all open tabs so the session uses the full editor area. Terminal profiles open in the active editor group without creating a new split.

## 0.6.1

- Keep agent commands, terminal profiles and saved-session filtering on the last focused project when switching from a text editor to a terminal in a multi-root workspace.
- Resume saved conversations using their recorded project's executable path, arguments and local CLI lookup, even when another project's editor is active.
- Ignore malformed message content blocks while retaining valid saved conversations and readable titles.
- Keep missing or relocated session stores and unrecognized formats empty without breaking the extension. Recover from scan failures, ignore invalid directory setting types, cancel outdated scans, and bound archive traversal to 20,000 entries with a notice when results are incomplete.
- Report terminal creation failures without rejecting agent commands, allowing a later retry.

## 0.6.0

- Added two sidebar layouts: native VS Code lists by default, or cards with search, larger agent icons and integrated session lists. Switch layouts from the view header or extension settings; both share favorites, selected agent and project scope.
- Click an agent once to show its saved conversations for the current project; double-click to open its terminal. The selected agent is remembered per workspace.
- Added separate Sessions and Open Terminals views. Sessions reads saved conversations for Codex, Claude Code, Pi, Oh My Pi and Prime Agent independently of open terminals, and resumes the exact conversation in its original project.
- Filter saved conversations by agent and project, including directory aliases and multi-root workspaces. Added session refresh, custom storage-directory settings, and handling for deleted session files and unavailable projects.
- Open Terminals focuses the exact existing terminal and marks the active one. The card panel uses a vector settings gear and keeps layout switching in the view header without a duplicate List/Cards selector.

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
