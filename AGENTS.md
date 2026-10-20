# Repository Guidelines

## Project Overview

VS Code workspace extension that opens separately installed/authenticated AI coding-agent CLIs in native editor-area terminal tabs. Provides agent selection/favorites, live terminals, and provider-native saved-session history with resume and supported deletion. CLIs run in the extension-host environment (local, code-server/container, or Remote-SSH), not necessarily on the client machine. Trusted, non-virtual workspaces only.

## Architecture & Data Flow

- `src/extension.ts` is the composition root: creates shared services/models and registers commands, terminal profiles, native trees, and the cards webview. `src/harnesses.ts` owns the ordered `HARNESSES` registry and ID/settings/icon helpers.
- Launch commands → `sessionContext.ts` selection → `launch.ts` resource-scoped configuration/project resolution → `resolveExecutable.ts` lookup → direct or shell terminal creation. `profiles.ts` reuses launch resolution but always creates direct-mode profiles. `status.ts` observes shell execution events, not conversation progress.
- `sessionsView.ts` models live terminals; `savedSessions.ts` reads provider-native stores; `savedSessionsView.ts` adds scoped caching, cancellation, resume and deletion orchestration. `deleteSession.ts` validates live identity and store boundaries before destructive operations.
- Native trees and `cardsView.ts` share models and commands. `media/sidebar.js` receives full state snapshots and sends action IDs; the extension resolves IDs against current models. Keep authoritative paths/terminal objects out of webview requests.
- `terminalIdentity.ts` stores versioned launch metadata in terminal environment variables; identity must survive editable titles and reconnection. `terminalTitles.ts` updates display names separately. VS Code owns terminal/process persistence; deactivation must not kill sessions.

## Key Directories

- `src/`: TypeScript extension host code; Node-only executable/session/deletion logic is separated from VS Code-facing modules.
- `media/`: cards UI, themed icons and vendored sources under `media/sources/`. Preserve `media/THIRD_PARTY_NOTICES.md`.
- `scripts/`: Node-based tests, validation, development/package orchestration and asset generators.
- `docs/`: supporting documentation and README images; `docs/agent-order.md` records the fixed ranking snapshot.
- `.github/workflows/`: CI packaging and release automation. `dist/`, `.build/`, and `artifacts/` are generated/ignored; never place VSIX files at the repository root.

## Development Commands

Use the repository root and install dependencies with `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run check` | Strict TypeScript checking, no emission. |
| `npm run build` | esbuild bundle to `dist/extension.js`; does not typecheck or test. |
| `npm test` | Terminal-title, main regression (including sidebar/manifest), and workflow checks. |
| `npm run compile` | Typecheck → bundle → all tests via `scripts/dev.mjs`. |
| `npm run package` | Full validation, then `artifacts/<name>-<version>.vsix`. |
| `npm run dev:install` | Validate, package, and install into local code-server. |
| `npm run icons` | Regenerate themed icons from vendored sources. |
| `node scripts/gen-icons.mjs --check` | Check generated icons without writing. |

No dedicated lint, formatter, start, or watch scripts. Use **F5 / Run Extension** for a desktop Extension Development Host; its prelaunch task only bundles.

## Code Conventions & Common Patterns

- Four-space TypeScript indentation, double quotes, semicolons; two-space JSON. Use `camelCase` functions/variables, `PascalCase` types/interfaces and uppercase constants such as `HARNESSES`.
- Stable harness IDs connect registry entries, `multiHarness` commands/profiles/settings, localization and `<agentId>-light.svg` / `<agentId>-dark.svg`. Keep these synchronized. Use `settingKey()` for section-relative configuration and `fullSettingKey()` for full settings IDs.
- Prefer function-based registration with explicit dependencies and narrow returned interfaces (`SessionContext`, `SavedSessions`, etc.), not a DI container. Reuse shared models across both sidebar layouts; expose changes through `onDidChange`.
- Persist favorites in `context.globalState`; selected agent/location scope in `context.workspaceState`; layout in configuration. Keep live-terminal identities in weak collections and scans in memory rather than serializing VS Code objects.
- Async reads use cancellation plus revision/generation, liveness and disposal checks. Preserve stale-result guards and bounded filesystem scans. Register commands/listeners/timers for cleanup through `context.subscriptions` or owning disposables.
- Missing optional stores/metadata are expected; surface unreadable providers without breaking other histories. Launch failures use localized messages; missing executables offer settings. Reset busy state in `finally`. Preserve deletion confirmation, live-file revalidation and trash-first behavior.
- Update both `package.nls.json` and `package.nls.tr.json` with matching keys for user-facing strings. Update README/changelog for user-facing behavior changes. Use `npm run icons`, not legacy `scripts/gen-media.py`, which overwrites current artwork with placeholders.

## Important Files

- `package.json`: extension contributions, activation events, commands, settings, profiles and npm scripts; `package-lock.json` pins npm dependencies.
- `tsconfig.json`: strict/no-unused checking; `esbuild.mjs`: CommonJS Node-targeted bundle with `vscode` external and source maps.
- `src/extension.ts`, `src/harnesses.ts`, `src/launch.ts`, `src/savedSessions.ts`: entry point, agent registry, terminal lifecycle and history formats.
- `scripts/dev.mjs`: shared validation/package/install pipeline; `scripts/validate-manifest.mjs`: manifest/localization/icon contract checks.
- `README.md`: behavior/settings/development instructions; `PUBLISHING.md`: release constraints. Do not publish to Marketplace or Open VSX as part of routine development.

## Runtime/Tooling Preferences

Use **Node.js 22 and npm**, matching CI; no Bun workflow. Use a current Node 22 release supporting the tests' `node:sqlite` and `node:zlib` Zstandard APIs. The extension has no production npm dependencies. Preserve VS Code `^1.67.0` compatibility and esbuild's Node 16 target: build-tool runtime requirements are not extension-host requirements. Feature-detect newer VS Code APIs and keep SQLite history optional on older hosts.

The documented local workflow is browser-based code-server in Docker on Ubuntu Server. After extension changes, run `npm run compile` and `npm run dev:install`; routine local installation is authorized. If Node/npm are absent from PATH, use `/app/code-server/lib/node scripts/dev.mjs install`. Report actual runtime/check results, then ask the user to run **Developer: Reload Window** with specific behavior to verify. Documentation-only changes need no installation. If no code-server installer exists, use manual **Install from VSIX** rather than assuming installation succeeded.

## Testing & QA

- Tests are plain `.mjs` scripts using `node:assert/strict`, not Jest/Vitest or `node:test`. `scripts/test.mjs` bundles TypeScript with esbuild into `.build/`, uses temporary real stores and recording VS Code stubs, and includes Windows-defined variants. Keep tests deterministic and clean fixtures in `finally`.
- `scripts/test-sidebar.mjs` runs the actual sidebar script in a VM with a lightweight DOM stub, not a browser. `scripts/test-terminal-titles.mjs` controls timers; `scripts/test-workflow.mjs` checks pipeline sequencing/failure propagation. `scripts/test.mjs` also imports sidebar and manifest checks.
- Add descriptive behavior-based regressions for changed functionality: launch/resume, reconnection, workspace scope, cancellation/stale reads, provider parsing, deletion safety and platform differences. Reuse injectable roots/environment/platform inputs instead of coupling tests to the developer's machine.
- No numeric coverage threshold is configured. Run `npm run compile` before submitting extension changes and manually exercise affected terminal/sidebar behavior; stubs do not prove actual VS Code interactions. Report only checks actually performed and include screenshots for visible UI changes.
