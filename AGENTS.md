# Repository Guidelines

## Project Structure & Module Organization

This repository contains a VS Code extension that opens coding-agent CLIs in editor-area terminals. `src/extension.ts` handles activation; `harnesses.ts` defines agents and identifiers; `launch.ts`, `profiles.ts`, `status.ts`, and `resolveExecutable.ts` handle launching, terminal profiles, status, and executable discovery.

`package.json` declares commands, settings, and profiles. `package.nls.json` and `package.nls.tr.json` hold English and Turkish strings. `media/` contains icons and artwork; preserve attribution in `media/THIRD_PARTY_NOTICES.md`. `scripts/` contains tests, manifest validation, and asset generators. Build output goes to `dist/`; temporary test bundles go to `.build/`.

## Build, Test, and Development Commands

Use Node.js 22, matching CI, and install dependencies with `npm ci`.

- `npm run check`: run strict TypeScript checking without emitting files.
- `npm run build`: bundle the extension into `dist/extension.js` with esbuild.
- `npm test`: run regression tests and manifest validation.
- `npm run compile`: run checking, building, and tests together.
- `npm run package`: run compilation checks and create a VSIX.

Press F5 in VS Code to launch the configured Extension Development Host. See `PUBLISHING.md` for release procedures.

## Development Test Reminders

After completing changes that affect the extension, prepare and run the development validation for the user rather than only reminding them to do it. Run `npm run compile` when the environment supports it. If IDE control is available, launch or restart the Extension Development Host using the configured pre-launch build. The user has authorized this routine development workflow; do not ask for confirmation each time. If the environment lacks the required runtime or IDE access, state the limitation clearly and give only the remaining manual steps: press F5 to start the host, or stop an existing session and press F5 again so the configured pre-launch build runs. Mention the specific command, setting, or interaction needed to verify the change. Report which checks actually ran, and do not claim that manual IDE testing was performed unless it actually was. Prefer this workflow over packaging and installing a VSIX unless the user asks to test an installed package. Documentation-only changes do not require a restart reminder.

## Coding Style & Naming Conventions

Follow existing TypeScript style: four-space indentation, double quotes, semicolons, camelCase functions and variables, PascalCase interfaces, and uppercase shared constants such as `HARNESSES`. Use descriptive module filenames such as `resolveExecutable.ts`. JSON uses two-space indentation. No dedicated formatter or linter is configured; `npm run check` enforces compiler rules, including unused declarations.

Keep agent IDs, contributed command IDs, settings, localization keys, and `<agentId>-light.svg` / `<agentId>-dark.svg` icons synchronized when adding agents.

## Testing Guidelines

Tests live in `scripts/test.mjs` and use `node:assert/strict`, esbuild bundles, and VS Code stubs. Add descriptive behavior-based regression cases for executable resolution, activation, configuration, or shell launching. Manifest checks live in `scripts/validate-manifest.mjs`. No numeric coverage threshold is configured. Run `npm run compile` before submitting and manually exercise affected terminal behavior in the development host.

## Commit & Pull Request Guidelines

Follow the history's prefixes, such as `fix:`, `feat:`, and `ci:`, with a concise description. Keep commits focused. Pull requests should explain the behavior change, link relevant issues, and report validation commands and results. Include screenshots for visible icon or status changes. Update documentation and localization when changing user-facing behavior; ensure CI passes.
