# Repository Guidelines

## Project Structure & Module Organization

This VS Code extension opens coding-agent CLIs in editor-area terminals. `src/extension.ts` handles activation; `harnesses.ts` defines agents; launch, profile, status, and executable-resolution modules handle terminals. Session modules and `*View.ts` files manage history and sidebar views.

`package.json` declares commands, settings, and profiles. English and Turkish strings live in `package.nls.json` and `package.nls.tr.json`. Assets live in `media/`; preserve `media/THIRD_PARTY_NOTICES.md`. Tests and generators live in `scripts/`. Keep generated `dist/`, `.build/`, and `artifacts/` untracked; never create VSIX files at the repository root.

## Build, Test, and Development Commands

Use Node.js 22, matching CI, and install dependencies with `npm ci`.

- `npm run check`: strict TypeScript checking without emitting files.
- `npm run build`: bundle into `dist/extension.js` with esbuild.
- `npm test`: regression, sidebar, workflow, and manifest checks.
- `npm run compile`: checking, building, and tests together.
- `npm run package`: validate and create `artifacts/<name>-<version>.vsix`.
- `npm run dev:install`: validate, package, and install into local code-server.
- `npm run icons`: regenerate themed icons from vendored sources.

## Local Development Workflow

The development environment is browser-based code-server in Docker on Ubuntu Server. After extension changes, run `npm run compile` and `npm run dev:install`; routine local installation is authorized. If Node/npm are absent from PATH, use `/app/code-server/lib/node scripts/dev.mjs install`. Report actual checks and runtime, then tell the user to run **Developer: Reload Window** and specify behavior to test. Documentation-only changes need no installation. Do not publish to the Marketplace; see `PUBLISHING.md` for release procedures.

## Coding Style & Naming Conventions

Use four-space TypeScript indentation, double quotes, semicolons, camelCase functions and variables, PascalCase interfaces, and uppercase constants such as `HARNESSES`. JSON uses two spaces. No dedicated formatter or linter is configured. Keep agent IDs, commands, settings, localization keys, and `<agentId>-light.svg` / `<agentId>-dark.svg` synchronized.

## Testing Guidelines

Tests use `node:assert/strict`, esbuild bundles, and VS Code stubs in `scripts/test*.mjs`; manifest checks use `scripts/validate-manifest.mjs`. Add descriptive behavior-based regressions for changed functionality. No numeric coverage threshold is configured. Run `npm run compile` before submitting and manually exercise affected terminal behavior.

## Commit & Pull Request Guidelines

Follow history's `feat:`, `fix:`, `docs:`, and `ci:` prefixes with concise descriptions. Keep commits focused. PRs should describe behavior changes, link relevant issues, report validation, and include screenshots for visible changes. Update documentation and localization with user-facing changes.
