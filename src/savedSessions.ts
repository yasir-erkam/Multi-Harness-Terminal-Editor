import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface SavedSession {
    readonly harnessId: string;
    readonly id: string;
    readonly title: string;
    readonly cwd: string;
    readonly file: string;
    readonly modified: number;
}

export interface SessionRoot {
    readonly harnessId: string;
    readonly directory: string;
}

export interface SessionScan {
    readonly sessions: SavedSession[];
    readonly unreadable: string[];
}

export interface SessionFilter {
    readonly harnessId: string;
    readonly cwd: string;
}

async function canonicalDirectory(directory: string): Promise<string> {
    const resolved = await fs.realpath(directory).catch(() => path.resolve(directory));
    const normalized = path.normalize(resolved);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

const WINDOW_BYTES = 256 * 1024;
const MAX_CANDIDATES = 1000;

/** Native JSONL stores only; unsupported agents are deliberately not inferred. */
export function sessionRoots(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): SessionRoot[] {
    const expand = (value: string): string => value.replace(/^~(?=$|[/\\])/, home);
    const base = (key: string, fallback: string): string => expand(env[key] || path.join(home, fallback));
    return [
        { harnessId: "codex", directory: path.join(base("CODEX_HOME", ".codex"), "sessions") },
        { harnessId: "claudeCode", directory: path.join(base("CLAUDE_CONFIG_DIR", ".claude"), "projects") },
        { harnessId: "pi", directory: env.PI_CODING_AGENT_SESSION_DIR ? expand(env.PI_CODING_AGENT_SESSION_DIR) : path.join(base("PI_CODING_AGENT_DIR", ".pi/agent"), "sessions") },
        { harnessId: "ohMyPi", directory: path.join(base("PI_CONFIG_DIR", ".omp"), "agent", "sessions") },
        { harnessId: "primeAgent", directory: env.PRIME_AGENT_SESSION_DIR ? expand(env.PRIME_AGENT_SESSION_DIR) : path.join(base("PRIME_AGENT_CODING_AGENT_DIR", ".prime/agent"), "sessions") },
    ];
}

function records(text: string): Record<string, any>[] {
    const result: Record<string, any>[] = [];
    for (const line of text.split("\n")) {
        try {
            const value: unknown = JSON.parse(line);
            if (value && typeof value === "object" && !Array.isArray(value)) {
                result.push(value as Record<string, any>);
            }
        } catch {
            // Partial last lines and malformed records must not hide other sessions.
        }
    }
    return result;
}

function clean(value: unknown): string {
    return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) : "";
}

/** Bounded metadata reads: never load a full conversation into the extension host. */
async function readWindows(file: string, size: number): Promise<Record<string, any>[]> {
    const handle = await fs.open(file, "r");
    try {
        const head = Buffer.alloc(Math.min(size, WINDOW_BYTES));
        await handle.read(head, 0, head.length, 0);
        const result = records(head.toString("utf8"));
        if (size > WINDOW_BYTES) {
            const offset = Math.max(WINDOW_BYTES, size - WINDOW_BYTES);
            const tail = Buffer.alloc(size - offset);
            await handle.read(tail, 0, tail.length, offset);
            result.push(...records(tail.toString("utf8")));
        }
        return result;
    } finally {
        await handle.close();
    }
}

function parseSession(harnessId: string, file: string, modified: number, rows: Record<string, any>[]): SavedSession | undefined {
    let header: Record<string, any> | undefined;
    if (harnessId === "codex") {
        header = rows.find((row) => row.type === "session_meta")?.payload;
        if (header?.source && typeof header.source === "object" && header.source.subagent) {
            return undefined;
        }
    } else if (harnessId === "claudeCode") {
        const row = rows.find((candidate) => typeof candidate.sessionId === "string" && typeof candidate.cwd === "string" && !candidate.isSidechain);
        if (row) {
            header = { id: row.sessionId, cwd: row.cwd };
        }
    } else {
        header = rows.find((row) => row.type === "session");
    }
    if (!header || typeof header.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(header.id) || typeof header.cwd !== "string" || !path.isAbsolute(header.cwd)) {
        return undefined;
    }
    let title = clean(header.title);
    for (const row of rows) {
        if (row.type === "title" || row.type === "custom-title") {
            title = clean(row.title ?? row.customTitle) || title;
        } else if (row.type === "session_info" || row.type === "sessionInfo") {
            title = clean(row.name) || title;
        }
    }
    if (!title) {
        if (harnessId === "codex") {
            title = clean(rows.find((row) => row.type === "event_msg" && row.payload?.type === "user_message")?.payload?.message);
        }
        for (const row of rows) {
            if (title) {
                break;
            }
            const message = row.type === "user" || row.type === "message" ? row.message : undefined;
            if (message && (message.role === "user" || row.type === "user") && !row.isMeta) {
                const content = message.content;
                title = clean(typeof content === "string" ? content : Array.isArray(content)
                    ? content.filter((part: any) => part.type === "text").map((part: any) => part.text).join(" ") : "");
                if (title) {
                    break;
                }
            }
        }
    }
    return { harnessId, id: header.id, cwd: header.cwd, file, modified, title: title || header.id };
}

export async function scanSavedSessions(roots = sessionRoots(), limit = 100, filter?: SessionFilter): Promise<SessionScan> {
    if (filter) {
        roots = roots.filter((root) => root.harnessId === filter.harnessId);
    }
    const scopePath = filter ? await canonicalDirectory(filter.cwd) : undefined;
    const canonicalPaths = new Map<string, string>();
    const unreadable = new Set<string>();
    const candidates: { root: SessionRoot; file: string; modified: number; size: number }[] = [];
    async function walk(root: SessionRoot, directory: string, depth: number): Promise<void> {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                unreadable.add(root.harnessId);
            }
            return;
        }
        for (const entry of entries) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory() && depth < 4 && !entry.name.startsWith(".") && !["subagents", "session-artifacts"].includes(entry.name)) {
                await walk(root, file, depth + 1);
            } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                try {
                    const stat = await fs.stat(file);
                    candidates.push({ root, file, modified: stat.mtimeMs, size: stat.size });
                } catch {
                    // A session may disappear while the list is being refreshed.
                }
            }
        }
    }
    await Promise.all(roots.map((root) => {
        if (!path.isAbsolute(root.directory)) {
            unreadable.add(root.harnessId);
            return Promise.resolve();
        }
        return walk(root, root.directory, 0);
    }));
    const codexTitles = new Map<string, string>();
    for (const root of roots.filter((candidate) => candidate.harnessId === "codex")) {
        const index = path.join(root.directory, "..", "session_index.jsonl");
        try {
            const stat = await fs.stat(index);
            for (const row of await readWindows(index, stat.size)) {
                if (typeof row.id === "string" && clean(row.thread_name)) {
                    codexTitles.set(row.id, clean(row.thread_name));
                }
            }
        } catch {
            // Titles are optional; a missing index must not hide valid rollouts.
        }
    }
    candidates.sort((a, b) => b.modified - a.modified);
    const sessions: SavedSession[] = [];
    const seen = new Set<string>();
    for (const candidate of filter ? candidates : candidates.slice(0, MAX_CANDIDATES)) {
        if (sessions.length >= limit) {
            break;
        }
        try {
            const session = parseSession(candidate.root.harnessId, candidate.file, candidate.modified,
                await readWindows(candidate.file, candidate.size));
            if (session && scopePath !== undefined) {
                let sessionPath = canonicalPaths.get(session.cwd);
                if (!sessionPath) {
                    sessionPath = await canonicalDirectory(session.cwd);
                    canonicalPaths.set(session.cwd, sessionPath);
                }
                if (sessionPath !== scopePath) {
                    continue;
                }
            }
            if (session && !seen.has(`${session.harnessId}:${session.id}`)) {
                seen.add(`${session.harnessId}:${session.id}`);
                sessions.push(session.harnessId === "codex" && codexTitles.has(session.id)
                    ? { ...session, title: codexTitles.get(session.id)! } : session);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                unreadable.add(candidate.root.harnessId);
            }
        }
    }
    return { sessions, unreadable: [...unreadable] };
}

export function resumeArguments(session: SavedSession): string[] {
    switch (session.harnessId) {
        case "codex": return ["resume", session.id];
        case "claudeCode": return ["--resume", session.id];
        case "pi": return ["--session", session.file];
        case "ohMyPi":
        case "primeAgent": return ["--resume", session.file];
        default: throw new Error(`Unsupported session provider: ${session.harnessId}`);
    }
}
