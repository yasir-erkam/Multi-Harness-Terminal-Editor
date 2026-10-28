# Default agent order

The default order is a fixed snapshot of descending GitHub repository stars,
fetched on **2026-10-20 UTC**, from `2026-10-20T04:53:56.012Z` to
`2026-10-20T04:54:57.202Z` (client timestamps). Counts below are the exact GitHub
REST API `stargazers_count` values, not rounded display counts.
The extension makes no network requests to calculate the order at runtime.

## Star snapshot and sources

Each repository link identifies the upstream product; each count links to the
GitHub API endpoint used to fetch it.

| Order | Agent | GitHub repository | Stars |
| --- | --- | --- | ---: |
| 1 | DeepSeek Harness | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | [254,720](https://api.github.com/repos/deepseek-ai/deepseek-harness) |
| 2 | OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | [218,004](https://api.github.com/repos/anomalyco/opencode) |
| 3 | Claude Code | [anthropics/claude-code](https://github.com/anthropics/claude-code) | [152,745](https://api.github.com/repos/anthropics/claude-code) |
| 4 | Codex | [openai/codex](https://github.com/openai/codex) | [129,970](https://api.github.com/repos/openai/codex) |
| 5 | Pi Agent | [earendil-works/pi](https://github.com/earendil-works/pi) | [116,475](https://api.github.com/repos/earendil-works/pi) |
| 6 | Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | [107,459](https://api.github.com/repos/google-gemini/gemini-cli) |
| 7 | Goose | [aaif-goose/goose](https://github.com/aaif-goose/goose) | [55,451](https://api.github.com/repos/block/goose) |
| 8 | Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | [49,648](https://api.github.com/repos/Aider-AI/aider) |
| 9 | Oh My Pi | [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) | [35,981](https://api.github.com/repos/can1357/oh-my-pi) |
| 10 | Crush | [charmbracelet/crush](https://github.com/charmbracelet/crush) | [28,713](https://api.github.com/repos/charmbracelet/crush) |
| 11 | Qwen Code | [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | [28,587](https://api.github.com/repos/QwenLM/qwen-code) |
| 12 | Prime Agent | [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) | [22,186](https://api.github.com/repos/PrimeIntellect-ai/prime-agent) |
| 13 | Copilot CLI | [github/copilot-cli](https://github.com/github/copilot-cli) | [11,276](https://api.github.com/repos/github/copilot-cli) |
| 14 | Antigravity CLI | [google-antigravity/antigravity-cli](https://github.com/google-antigravity/antigravity-cli) | [2,604](https://api.github.com/repos/google-antigravity/antigravity-cli) |
| Unranked tail | Cursor Agent | No verified CLI-specific upstream repository | Unknown |

## Grok Build addition

Grok Build was added on **2026-10-28** using the GitHub REST API
[`xai-org/grok-build`](https://api.github.com/repos/xai-org/grok-build):
**27,586** stars (response Date: `Wed, 28 Oct 2026 10:12:43 GMT`).
The other counts above retain their original snapshot; they were not refreshed.
Grok Build is inserted between Qwen Code and Prime Agent, making it the 12th
ranked agent and shifting later agents down one position. Its upstream is
[xai-org/grok-build](https://github.com/xai-org/grok-build).
This mixed-date insertion is a fixed ordering aid, not a current comparison
of all repositories.

## Repository mapping and limitations

- [Pi's official site](https://pi.dev) links to `earendil-works/pi`. Its stars
  cover the containing agent toolkit repository, not just the coding-agent CLI.
- The existing `block/goose` upstream URL redirects to `aaif-goose/goose`;
  the API response identifies that canonical repository.
- Antigravity's repository documents the `agy` command and links to its
  [official CLI documentation](https://antigravity.google/docs/cli/overview).
  Its installer matches the [official download page](https://antigravity.google/download#antigravity-cli).
- A product-specific public repository can hold documentation, issues and
  releases rather than the product's implementation source. Its stars still
  count here; this policy does not rank source-code openness.
- No CLI-specific official repository was verified for
  [Cursor Agent](https://cursor.com/docs/cli/overview).
  [cursor/cursor](https://github.com/cursor/cursor) covers the broader Cursor
  product and community, so its stars are not substituted for the CLI's.

Agents without a verified product-specific repository follow the measured
group alphabetically by display name. Unknown does not mean zero stars or
lower actual adoption. Cursor Agent is currently the only such agent. Stars
measure repository interest, not active users, CLI usage or product quality;
counts change after this snapshot and are not refreshed automatically.

## Applying and maintaining the order

`src/harnesses.ts` defines the shared order for native and card views and agent
pickers. Terminal profile contributions and optional editor buttons match it.
VS Code may apply its own sorting to profile and Command Palette menus.

Favorite agents remain first and retain the same relative order within their
group. Existing favorites and the selected agent are preserved. This applies
to existing installations as well as first installations.

When refreshing the snapshot, update `HARNESSES`, the manifest, the manifest
validator's expected order, the README tables and this document together.
