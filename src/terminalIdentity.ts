import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { grokOwners, grokSessionForProcess } from "./grokSessions";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES, harnessForTerminalName, type Harness } from "./harnesses";
import { inspectWindowsSessionProcesses, windowsCodexUsesSession } from "./windowsSessionProcesses";

// Environment metadata stays with the process across browser reconnections.
// Keep identity separate from the editable title and do not store conversation text.
const restoredIdentities = new WeakMap<vscode.Terminal, TerminalIdentity>();
const TERMINAL_IDENTITY_ENV = "MULTI_HARNESS_TERMINAL_IDENTITY";

export interface TerminalIdentity {
    readonly version: 1;
    readonly harnessId: string;
    readonly launchMode: "direct" | "shell";
    readonly sessionId?: string;
    readonly projectPath?: string;
    readonly terminalSessionId?: string;
    readonly startedAt?: number;
}

export function terminalIdentityEnv(
    harness: Harness,
    launchMode: TerminalIdentity["launchMode"],
    sessionId?: string,
    projectPath?: string
): Record<string, string> {
    if (projectPath !== undefined && !validProjectPath(projectPath)) {
        throw new TypeError("Terminal projectPath must be an absolute path without NUL characters");
    }
    const terminalSessionId = harness.id === "ohMyPi" && (process.platform === "win32" || process.platform === "darwin") ? randomUUID() : undefined;
    return {
        [TERMINAL_IDENTITY_ENV]: JSON.stringify({ version: 1, harnessId: harness.id, launchMode, sessionId, projectPath, terminalSessionId, startedAt: Date.now() }),
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

function validProjectPath(value: unknown): value is string {
    return typeof value === "string" && path.isAbsolute(value) && !value.includes("\0");
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
            || ("projectPath" in identity && !validProjectPath(identity.projectPath))
            || ("terminalSessionId" in identity && (typeof identity.terminalSessionId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(identity.terminalSessionId)))
            || ("startedAt" in identity && (typeof identity.startedAt !== "number" || !Number.isFinite(identity.startedAt) || identity.startedAt <= 0))
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
    let startedAt = identity.startedAt;
    if (process.platform === "linux") {
        try {
            const pid = await terminal.processId;
            if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
            startedAt ??= (await stat(`/proc/${pid}`)).mtimeMs;
            const tty = await readlink(`/proc/${pid}/fd/0`);
            if (tty.startsWith("/dev/")) terminalId = tty.slice(5).replace(/\//g, "-");
        } catch { return undefined; }
    } else if ((process.platform === "win32" || process.platform === "darwin") && identity.terminalSessionId) {
        terminalId = `apple-${identity.terminalSessionId}`;
    }
    if (!terminalId || !/^[a-zA-Z0-9_-]+$/.test(terminalId)) return undefined;
    try {
        const breadcrumbPath = path.join(sessionsRoot, "..", "terminal-sessions", terminalId);
        const [breadcrumb, metadata] = await Promise.all([readFile(breadcrumbPath, "utf8"), stat(breadcrumbPath)]);
        // PTY numbers are reused; an old process's breadcrumb is not live identity.
        if (process.platform === "linux" && startedAt !== undefined && metadata.mtimeMs < startedAt) return undefined;
        const file = breadcrumb.split("\n")[1]?.trim();
        return file && path.isAbsolute(file) ? file : undefined;
    } catch { return undefined; }
}

/** Find live Codex rollouts, including a CLI below a shell or Node launcher. */
export async function codexTerminalSessionFiles(terminal: vscode.Terminal, sessionsRoot: string): Promise<string[]> {
    if (process.platform !== "linux" || terminal.exitStatus
        || (await restoreTerminalIdentity(terminal))?.harnessId !== "codex") return [];
    try {
        const pid = await terminal.processId;
        if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return [];
        const root = await realpath(sessionsRoot);
        const pending = [pid];
        const visited = new Set<number>();
        const files = new Set<string>();
        let remainingDescriptors = 1024;
        while (pending.length && visited.size < 64 && remainingDescriptors > 0) {
            const current = pending.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);
            const base = `/proc/${current}`;
            try {
                const command = (await readFile(`${base}/comm`, "utf8")).trim();
                if (/^codex(?:-|$)/.test(command)) {
                    const descriptors = (await readdir(`${base}/fd`)).slice(0, Math.min(256, remainingDescriptors));
                    remainingDescriptors -= descriptors.length;
                    for (const descriptor of descriptors) {
                        try {
                            const file = await readlink(`${base}/fd/${descriptor}`);
                            const relative = path.relative(root, file);
                            if (!file.endsWith(".jsonl") || !relative || relative === ".."
                                || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
                            const info = await readFile(`${base}/fdinfo/${descriptor}`, "utf8");
                            const flags = /^flags:\s+([0-7]+)$/m.exec(info)?.[1];
                            // Reading history must not identify it as the active session.
                            if (flags && (Number.parseInt(flags, 8) & 3) !== 0) files.add(file);
                        } catch { /* Processes can close descriptors during discovery. */ }
                    }
                    // A Codex launched by a tool belongs to a separate conversation.
                    continue;
                }
                const children = await readFile(`${base}/task/${current}/children`, "utf8");
                for (const child of children.trim().split(/\s+/)) {
                    const childPid = Number(child);
                    if (Number.isSafeInteger(childPid) && childPid > 0 && pending.length < 64) pending.push(childPid);
                }
            } catch { /* A process may exit or restrict access to /proc. */ }
        }
        return [...files];
    } catch {
        return [];
    }
}

/** Windows has no /proc: match writable file owners to marked terminal trees. */
export async function windowsCodexSessionMatches(terminals: readonly vscode.Terminal[], file: string): Promise<Map<vscode.Terminal, boolean>> {
    const matches = new Map<vscode.Terminal, boolean>();
    if (process.platform !== "win32") return matches;
    const candidates = await Promise.all(terminals.map(async (terminal) => {
        if (terminal.exitStatus || terminalIdentity(terminal)?.harnessId !== "codex") return undefined;
        try {
            const pid = await terminal.processId;
            return pid && Number.isSafeInteger(pid) && pid > 0 ? { terminal, pid } : undefined;
        } catch { return undefined; }
    }));
    if (!candidates.some(Boolean)) return matches;
    const snapshot = await inspectWindowsSessionProcesses(file);
    if (!snapshot) return matches;
    for (const candidate of candidates) {
        if (!candidate) continue;
        const result = windowsCodexUsesSession(candidate.pid, snapshot);
        if (result !== undefined) matches.set(candidate.terminal, result);
    }
    return matches;
}

/** Null means live identity could not be proven; callers must avoid stale resume IDs. */
export async function grokTerminalSessionId(terminal: vscode.Terminal, sessionsRoot: string): Promise<string | null | undefined> {
    if ((await restoreTerminalIdentity(terminal))?.harnessId !== "grokBuild") return undefined;
    if (process.platform !== "linux") return undefined;
    if (terminal.exitStatus) return null;
    try {
        const owners = await grokOwners(sessionsRoot);
        const pid = await terminal.processId;
        return pid ? await grokSessionForProcess(pid, owners) ?? null : null;
    } catch {
        return null;
    }
}
