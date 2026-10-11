export interface Harness {
    /** Stable, machine-safe identifier (also used in setting keys). */
    readonly id: string;
    /** User-facing name, used as the terminal name and command title suffix. */
    readonly displayName: string;
    /** Default command name if no explicit path is configured. */
    readonly defaultExecutable: string;
    /** Contributed command id, spelled out so the bundle stays greppable. */
    readonly commandId: string;
}

export const HARNESSES: readonly Harness[] = [
    { id: "claudeCode", displayName: "Claude Code", defaultExecutable: "claude", commandId: "multiHarness.openClaudeCode" },
    { id: "codex", displayName: "Codex", defaultExecutable: "codex", commandId: "multiHarness.openCodex" },
    { id: "openCode", displayName: "OpenCode", defaultExecutable: "opencode", commandId: "multiHarness.openOpenCode" },
    { id: "pi", displayName: "Pi Agent", defaultExecutable: "pi", commandId: "multiHarness.openPi" },
    { id: "ohMyPi", displayName: "Oh My Pi", defaultExecutable: "omp", commandId: "multiHarness.openOhMyPi" },
    { id: "gemini", displayName: "Gemini CLI", defaultExecutable: "gemini", commandId: "multiHarness.openGemini" },
    { id: "copilot", displayName: "Copilot CLI", defaultExecutable: "copilot", commandId: "multiHarness.openCopilot" },
    { id: "cursorAgent", displayName: "Cursor Agent", defaultExecutable: "cursor-agent", commandId: "multiHarness.openCursorAgent" },
    { id: "aider", displayName: "Aider", defaultExecutable: "aider", commandId: "multiHarness.openAider" },
    { id: "crush", displayName: "Crush", defaultExecutable: "crush", commandId: "multiHarness.openCrush" },
    { id: "qwen", displayName: "Qwen Code", defaultExecutable: "qwen", commandId: "multiHarness.openQwen" },
    { id: "goose", displayName: "Goose", defaultExecutable: "goose", commandId: "multiHarness.openGoose" },
];

/** Configuration id for a harness setting, e.g. `multiHarness.claudeCode.executablePath`. */
export function settingKey(harness: Harness, setting: "executablePath" | "arguments"): string {
    return `multiHarness.${harness.id}.${setting}`;
}

/** Filename of a harness icon evenly themed for the given scheme. */
export function iconFile(harness: Harness, theme: "light" | "dark"): string {
    return `${harness.id}-${theme}.svg`;
}
