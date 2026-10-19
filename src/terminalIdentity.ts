import { readFile, readlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES, harnessForTerminalName, type Harness } from "./harnesses";

// Environment metadata stays with the process across browser reconnections.
// Keep identity separate from the editable title and do not store conversation text.
const restoredIdentities = new WeakMap<vscode.Terminal, TerminalIdentity>();
const TERMINAL_IDENTITY_ENV = "MULTI_HARNESS_TERMINAL_IDENTITY";

export interface TerminalIdentity {
    readonly version: 1;
    readonly harnessId: string;
    readonly launchMode: "direct" | "shell";
    readonly sessionId?: string;
    readonly terminalSessionId?: string;
}

export function terminalIdentityEnv(
    harness: Harness,
    launchMode: TerminalIdentity["launchMode"],
    sessionId?: string
): Record<string, string> {
    const terminalSessionId = harness.id === "ohMyPi" && process.platform === "win32" ? randomUUID() : undefined;
    return {
        [TERMINAL_IDENTITY_ENV]: JSON.stringify({ version: 1, harnessId: harness.id, launchMode, sessionId, terminalSessionId }),
        ...(terminalSessionId ? { TERM_SESSION_ID: terminalSessionId } : {}),
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

/** Durable launch metadata takes precedence over the legacy editable title. */
export function harnessForTerminal(terminal: vscode.Terminal): Harness | undefined {
    const identity = terminalIdentity(terminal);
    return identity
        ? HARNESSES.find((harness) => harness.id === identity.harnessId)
        : harnessForTerminalName(terminal.name);
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
            || ("terminalSessionId" in identity && (typeof identity.terminalSessionId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(identity.terminalSessionId)))
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

/** OMP updates its terminal breadcrumb when a fresh session starts or switches. */
export async function ompTerminalSessionFile(terminal: vscode.Terminal, sessionsRoot: string): Promise<string | undefined> {
    const identity = await restoreTerminalIdentity(terminal);
    if (identity?.harnessId !== "ohMyPi" || terminal.exitStatus) return undefined;
    let terminalId: string | undefined;
    if (process.platform === "linux") {
        try {
            const pid = await terminal.processId;
            if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
            const tty = await readlink(`/proc/${pid}/fd/0`);
            if (tty.startsWith("/dev/")) terminalId = tty.slice(5).replace(/\//g, "-");
        } catch { return undefined; }
    } else if (process.platform === "win32" && identity.terminalSessionId) {
        terminalId = `apple-${identity.terminalSessionId}`;
    }
    if (!terminalId || !/^[a-zA-Z0-9_-]+$/.test(terminalId)) return undefined;
    try {
        const breadcrumb = await readFile(path.join(sessionsRoot, "..", "terminal-sessions", terminalId), "utf8");
        const file = breadcrumb.split("\n")[1]?.trim();
        return file && path.isAbsolute(file) ? file : undefined;
    } catch { return undefined; }
}
