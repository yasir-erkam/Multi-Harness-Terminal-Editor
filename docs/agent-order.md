# Default agent order

Reviewed on 2026-10-16. This is a fixed, approximate adoption snapshot, not a
measurement of worldwide CLI users. No usage data is collected by the extension
and no network requests are made to calculate the order at runtime.

## Primary source

The [2026 Stack Overflow Developer Survey: AI coding agents](https://survey.stackoverflow.co/2026/ai/data/ai-code-agent)
reports past-year use among 12,255 respondents to this question. Supported tools
with a matching product entry follow that survey's descending usage order:

Claude Code → Copilot CLI → Codex → Cursor Agent → Antigravity CLI → OpenCode →
Pi Agent → Aider.

Copilot, Codex, Cursor and Antigravity entries cover their broader products;
their CLI variants are mapped to those products as an adoption proxy. This
does not establish the relative number of users of those specific CLIs.

Attribution: Stack Exchange Inc. (2026), “AI coding agents”, Stack Overflow
Developer Survey 2026. Response data is licensed under
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

## Secondary source and agents without data

For agents missing from the primary source, use the
[July 2026 Coding Agent Survey](https://codingagentsurvey.org/reports/2026-07):
Gemini CLI precedes Qwen Code. Its 163 responses are a small, self-selected
sample; its counts are not compared with the larger survey. These two agents
follow the primary-source group. Gemini Code Assist in the primary source is
not treated as Gemini CLI.

Crush, Goose, Oh My Pi and Prime Agent follow alphabetically because neither
source supplies comparable entries for them. Missing data does not imply zero
users or lower actual usage. In particular, the boundaries between these groups
are a presentation fallback, not a measured usage comparison.

## Applying and maintaining the order

`src/harnesses.ts` defines the shared order for native and card views and agent
pickers. Terminal profile contributions and optional editor buttons match it.
VS Code may apply its own sorting to profile and Command Palette menus.

Favorite agents remain first and retain the same relative order within their
group. Existing favorites and the selected agent are preserved. This applies
to existing installations as well as first installations.

When refreshing the snapshot, update `HARNESSES`, the manifest, the manifest
validator's expected order, the README tables and this document together.
