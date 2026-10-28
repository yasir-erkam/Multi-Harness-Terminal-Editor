export interface Harness {
    /** Stable, machine-safe identifier (also used in setting keys). */
    readonly id: string;
    /** User-facing name, used as the terminal name and command title suffix. */
    readonly displayName: string;
    /** Default command name if no explicit path is configured. */
    readonly defaultExecutable: string;
    /** Default CLI arguments if no explicit arguments setting is configured. */
    readonly defaultArgs?: readonly string[];
    /** Contributed command id, spelled out so the bundle stays greppable. */
    readonly commandId: string;
}

/** Descending GitHub stars snapshot; sources and unranked-agent fallback: docs/agent-order.md. */
export const HARNESSES: readonly Harness[] = [
    { id: "deepseek", displayName: "DeepSeek Harness", defaultExecutable: "dsh", defaultArgs: ["--profile", "tui"], commandId: "multiHarness.openDeepseek" },
    { id: "openCode", displayName: "OpenCode", defaultExecutable: "opencode", commandId: "multiHarness.openOpenCode" },
    { id: "claudeCode", displayName: "Claude Code", defaultExecutable: "claude", commandId: "multiHarness.openClaudeCode" },
    { id: "codex", displayName: "Codex", defaultExecutable: "codex", commandId: "multiHarness.openCodex" },
    { id: "pi", displayName: "Pi Agent", defaultExecutable: "pi", commandId: "multiHarness.openPi" },
    { id: "gemini", displayName: "Gemini CLI", defaultExecutable: "gemini", commandId: "multiHarness.openGemini" },
    { id: "goose", displayName: "Goose", defaultExecutable: "goose", commandId: "multiHarness.openGoose" },
    { id: "aider", displayName: "Aider", defaultExecutable: "aider", commandId: "multiHarness.openAider" },
    { id: "ohMyPi", displayName: "Oh My Pi", defaultExecutable: "omp", commandId: "multiHarness.openOhMyPi" },
    { id: "crush", displayName: "Crush", defaultExecutable: "crush", commandId: "multiHarness.openCrush" },
    { id: "qwen", displayName: "Qwen Code", defaultExecutable: "qwen", commandId: "multiHarness.openQwen" },
    { id: "grokBuild", displayName: "Grok Build", defaultExecutable: "grok", commandId: "multiHarness.openGrokBuild" },
    { id: "primeAgent", displayName: "Prime Agent", defaultExecutable: "prime-agent", commandId: "multiHarness.openPrimeAgent" },
    { id: "copilot", displayName: "Copilot CLI", defaultExecutable: "copilot", commandId: "multiHarness.openCopilot" },
    { id: "antigravity", displayName: "Antigravity CLI", defaultExecutable: "agy", commandId: "multiHarness.openAntigravity" },
    { id: "cursorAgent", displayName: "Cursor Agent", defaultExecutable: "cursor-agent", commandId: "multiHarness.openCursorAgent" },
];

export function harnessForTerminalName(name: string): Harness | undefined {
    return HARNESSES.find((harness) => name === harness.displayName || name.startsWith(`${harness.displayName} — `));
}

/**
 * Key for reading a harness setting from a configuration object obtained via
 * `getConfiguration("multiHarness")`. Keys passed to `WorkspaceConfiguration.get`
 * are resolved *relative* to that section, so this must NOT carry the prefix.
 */
export function settingKey(harness: Harness, setting: "executablePath" | "arguments"): string {
    return `${harness.id}.${setting}`;
}

/**
 * Fully-qualified setting id, e.g. `multiHarness.claudeCode.executablePath`.
 * Use for the `workbench.action.openSettings` argument and user-facing text —
 * that API expects the complete id, not a section-relative key.
 */
export function fullSettingKey(harness: Harness, setting: "executablePath" | "arguments"): string {
    return `multiHarness.${settingKey(harness, setting)}`;
}

/** Filename of a harness icon evenly themed for the given scheme. */
export function iconFile(harness: Harness, theme: "light" | "dark"): string {
    return `${harness.id}-${theme}.svg`;
}
