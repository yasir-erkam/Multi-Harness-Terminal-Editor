import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import { HARNESSES, type Harness } from "./harnesses";

// Environment metadata stays with the process across browser reconnections.
// Keep identity separate from the editable title and do not store conversation text.
const restoredIdentities = new WeakMap<vscode.Terminal, TerminalIdentity>();
const TERMINAL_IDENTITY_ENV = "MULTI_HARNESS_TERMINAL_IDENTITY";

export interface TerminalIdentity {
    readonly version: 1;
    readonly harnessId: string;
    readonly launchMode: "direct" | "shell";
    readonly sessionId?: string;
}

export function terminalIdentityEnv(
    harness: Harness,
    launchMode: TerminalIdentity["launchMode"],
    sessionId?: string
): Record<string, string> {
    return {
        [TERMINAL_IDENTITY_ENV]: JSON.stringify({ version: 1, harnessId: harness.id, launchMode, sessionId }),
    };
}

export function terminalIdentity(terminal: vscode.Terminal): TerminalIdentity | undefined {
    const cached = restoredIdentities.get(terminal);
    if (cached) {
        return cached;
    }
    const options = terminal.creationOptions;
    const value = options && "env" in options ? options.env?.[TERMINAL_IDENTITY_ENV] : undefined;
    return parseIdentity(value);
}

function parseIdentity(value: string | null | undefined): TerminalIdentity | undefined {
    if (!value) {
        return undefined;
    }
    try {
        const identity: unknown = JSON.parse(value);
        if (!identity || typeof identity !== "object" || !("version" in identity) || identity.version !== 1
            || !("harnessId" in identity) || !HARNESSES.some((harness) => harness.id === identity.harnessId)
            || !("launchMode" in identity) || (identity.launchMode !== "direct" && identity.launchMode !== "shell")
            || ("sessionId" in identity && (typeof identity.sessionId !== "string" || !identity.sessionId))) {
            return undefined;
        }
        return identity as TerminalIdentity;
    } catch {
        return undefined;
    }
}

/** Reattached Linux/code-server terminals may omit the original env options. */
export async function restoreTerminalIdentity(terminal: vscode.Terminal): Promise<TerminalIdentity | undefined> {
    const identity = terminalIdentity(terminal);
    if (identity || process.platform !== "linux" || terminal.exitStatus) {
        return identity;
    }
    try {
        const pid = await terminal.processId;
        if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
            return undefined;
        }
        const environment = await readFile(`/proc/${pid}/environ`, "utf8");
        const prefix = `${TERMINAL_IDENTITY_ENV}=`;
        const value = environment.split("\0").find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
        const restored = parseIdentity(value);
        if (restored && !terminal.exitStatus) {
            restoredIdentities.set(terminal, restored);
            return restored;
        }
    } catch {
        // A closed process or restricted /proc must not prevent normal launches.
    }
    return undefined;
}
