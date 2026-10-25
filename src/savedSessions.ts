import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

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

export interface SessionScanOptions {
    readonly signal?: AbortSignal;
    readonly maxEntries?: number;
}

async function canonicalDirectory(directory: string): Promise<string> {
    const resolved = await fs.realpath(directory).catch(() => path.resolve(directory));
    const normalized = path.normalize(resolved);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

const WINDOW_BYTES = 256 * 1024;
const ZSTD_READ_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATES = 1000;
const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MAGIC_MASK = 0xfffffff0;
const SKIPPABLE_MAGIC_BASE = 0x184d2a50;
const DSH_GENERATION_FILE = /^session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$/;

export interface ZstdFrameScan {
    readonly frames: { start: number; end: number }[];
    readonly completePrefixLength: number;
    readonly error?: "invalidMagic" | "corruptHeader" | "corruptBlock";
}

/**
 * DeepSeek Harness appends each JSONL flush as an independent Zstandard frame,
 * and Node's `zlib.zstdDecompressSync` decodes one frame per call.
 */
export function scanZstdFrames(buffer: Buffer): ZstdFrameScan {
    const frames: { start: number; end: number }[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const frameStart = offset;
        if (offset + 4 > buffer.length) {
            return { frames, completePrefixLength: frameStart };
        }
        const magic = buffer.readUInt32LE(offset);
        offset += 4;
        if ((magic & SKIPPABLE_MAGIC_MASK) === SKIPPABLE_MAGIC_BASE) {
            if (offset + 4 > buffer.length) {
                return { frames, completePrefixLength: frameStart };
            }
            const payloadSize = buffer.readUInt32LE(offset);
            offset += 4;
            if (offset + payloadSize > buffer.length) {
                return { frames, completePrefixLength: frameStart };
            }
            offset += payloadSize;
            continue;
        }
        if (magic !== ZSTD_MAGIC) {
            return { frames, completePrefixLength: frameStart, error: "invalidMagic" };
        }
        if (offset >= buffer.length) {
            return { frames, completePrefixLength: frameStart };
        }
        const fhd = buffer[offset++]!;
        if ((fhd & 0b0001_1000) !== 0) {
            return { frames, completePrefixLength: frameStart, error: "corruptHeader" };
        }
        const singleSegment = (fhd & 0b0010_0000) !== 0;
        const checksumFlag = (fhd & 0b0000_0100) !== 0;
        const dictIdFlag = fhd & 0b0000_0011;
        const fcsFlag = fhd >> 6;
        const windowDescBytes = singleSegment ? 0 : 1;
        const dictIdBytes = dictIdFlag === 0 ? 0 : 1 << (dictIdFlag - 1);
        const fcsBytes = fcsFlag === 0 ? (singleSegment ? 1 : 0) : 1 << fcsFlag;
        const headerExtra = windowDescBytes + dictIdBytes + fcsBytes;
        if (offset + headerExtra > buffer.length) {
            return { frames, completePrefixLength: frameStart };
        }
        offset += headerExtra;
        while (true) {
            if (offset + 3 > buffer.length) {
                return { frames, completePrefixLength: frameStart };
            }
            const blockHeader = buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
            offset += 3;
            const lastBlock = (blockHeader & 1) !== 0;
            const blockType = (blockHeader >> 1) & 0b11;
            const blockSize = blockHeader >> 3;
            if (blockType === 3) {
                return { frames, completePrefixLength: frameStart, error: "corruptBlock" };
            }
            const payloadBytes = blockType === 1 ? 1 : blockSize;
            if (offset + payloadBytes > buffer.length) {
                return { frames, completePrefixLength: frameStart };
            }
            offset += payloadBytes;
            if (lastBlock) {
                break;
            }
        }
        if (checksumFlag) {
            if (offset + 4 > buffer.length) {
                return { frames, completePrefixLength: frameStart };
            }
            offset += 4;
        }
        frames.push({ start: frameStart, end: offset });
    }
    return { frames, completePrefixLength: offset };
}

/** SQLite histories require provider-specific deletion beyond the JSONL trash workflow. */
export function supportsSessionDeletion(harnessId: string): boolean {
    return ["codex", "claudeCode", "pi", "ohMyPi", "primeAgent", "deepseek"].includes(harnessId);
}

/** Native session stores only; unsupported agents are deliberately not inferred. */
export function sessionRoots(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): SessionRoot[] {
    const expand = (value: string): string => value.replace(/^~(?=$|[/\\])/, home);
    const base = (key: string, fallback: string): string => expand(env[key] || path.join(home, fallback));
    const primeSessionDirectory = env.PRIME_AGENT_SESSION_DIR ?? env.PRIME_AGENT_CODING_AGENT_SESSION_DIR;
    return [
        { harnessId: "codex", directory: path.join(base("CODEX_HOME", ".codex"), "sessions") },
        { harnessId: "claudeCode", directory: path.join(base("CLAUDE_CONFIG_DIR", ".claude"), "projects") },
        { harnessId: "pi", directory: env.PI_CODING_AGENT_SESSION_DIR ? expand(env.PI_CODING_AGENT_SESSION_DIR) : path.join(base("PI_CODING_AGENT_DIR", ".pi/agent"), "sessions") },
        { harnessId: "ohMyPi", directory: path.join(base("PI_CONFIG_DIR", ".omp"), "agent", "sessions") },
        { harnessId: "primeAgent", directory: primeSessionDirectory ? expand(primeSessionDirectory) : path.join(base("PRIME_AGENT_CODING_AGENT_DIR", ".prime/agent"), "sessions") },
        { harnessId: "antigravity", directory: path.join(home, ".gemini", "antigravity-cli") },
        { harnessId: "deepseek", directory: path.join(base("DSH_HOME", ".dsh"), "sessions") },
        { harnessId: "openCode", directory: path.join(base("XDG_DATA_HOME", ".local/share"), "opencode") },
    ];
}

/** Antigravity timestamps look like `2026-10-16 16:50:09.831811299+00:00`. */
function parseTimestamp(value: unknown): number {
    if (typeof value !== "string") {
        return 0;
    }
    const iso = value.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : 0;
}

function workspacePaths(value: unknown): string[] {
    let uris: unknown;
    try {
        uris = typeof value === "string" ? JSON.parse(value) : undefined;
    } catch {
        return [];
    }
    if (!Array.isArray(uris)) {
        return [];
    }
    const result: string[] = [];
    for (const uri of uris) {
        if (typeof uri !== "string" || !uri.startsWith("file:")) {
            continue;
        }
        try {
            const directory = fileURLToPath(uri);
            if (path.isAbsolute(directory) && !directory.includes("\0")) {
                result.push(directory);
            }
        } catch {
            // Non-local workspace URIs cannot be resumed from this host.
        }
    }
    return result;
}

/**
 * Antigravity CLI indexes top-level conversations in `conversation_summaries.db`
 * and keeps each trajectory in `conversations/<id>.db`. The index is opened
 * read-only; subagent and empty conversations are skipped like `/resume` does.
 */
async function scanAntigravity(root: SessionRoot, matches: (directory: string) => Promise<boolean>, signal?: AbortSignal): Promise<SavedSession[]> {
    const index = path.join(root.directory, "conversation_summaries.db");
    try {
        if (!(await fs.stat(index)).isFile()) {
            return [];
        }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
            return [];
        }
        throw error;
    }
    // Loaded lazily: older extension hosts without node:sqlite only lose this store.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(index, { readOnly: true });
    let rows: Record<string, unknown>[];
    try {
        rows = db.prepare(
            "SELECT conversation_id, title, preview, last_modified_time, workspace_uris FROM conversation_summaries "
            + "WHERE parent_conversation_id = '' AND nesting_depth = 0 AND step_count > 0 "
            + "ORDER BY last_modified_time DESC LIMIT 5000"
        ).all() as Record<string, unknown>[];
    } finally {
        db.close();
    }
    const sessions: SavedSession[] = [];
    for (const row of rows) {
        if (signal?.aborted) {
            return [];
        }
        const id = row.conversation_id;
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) {
            continue;
        }
        let cwd: string | undefined;
        for (const directory of workspacePaths(row.workspace_uris)) {
            if (await matches(directory)) {
                cwd = directory;
                break;
            }
        }
        if (!cwd) {
            continue;
        }
        const file = path.join(root.directory, "conversations", `${id}.db`);
        let modified = parseTimestamp(row.last_modified_time);
        try {
            const stat = await fs.stat(file);
            if (!stat.isFile()) {
                continue;
            }
            modified ||= stat.mtimeMs;
        } catch {
            // The index can outlive a deleted trajectory; it cannot be resumed.
            continue;
        }
        sessions.push({ harnessId: root.harnessId, id, cwd, file, modified, title: clean(row.title) || clean(row.preview) || id });
    }
    return sessions;
}

/** OpenCode v1.2+ uses SQLite; older releases store individual session metadata JSON. */
async function scanOpenCode(root: SessionRoot, matches: (directory: string) => Promise<boolean>, options: SessionScanOptions): Promise<SavedSession[]> {
    const index = path.join(root.directory, "opencode.db");
    const sessions: SavedSession[] = [];
    async function add(row: Record<string, any>, file: string): Promise<void> {
        if (options.signal?.aborted || typeof row.id !== "string" || !/^ses_[a-zA-Z0-9]+$/.test(row.id)
            || typeof row.directory !== "string" || !path.isAbsolute(row.directory) || !await matches(row.directory)) return;
        const modified = row.time_updated ?? row.time?.updated;
        if (typeof modified !== "number" || !Number.isFinite(modified)) return;
        sessions.push({ harnessId: root.harnessId, id: row.id, cwd: row.directory, file,
            modified, title: clean(row.title) || row.id });
    }
    let exists = false;
    try {
        if (!(await fs.stat(index)).isFile()) throw new Error("OpenCode database is not a regular file");
        exists = true;
    } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    if (exists) {
        // Optional on older extension hosts: static loading would break JSON session providers too.
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(index, { readOnly: true });
        try {
            const rows = db.prepare("SELECT id, directory, title, time_updated FROM session "
                + "WHERE parent_id IS NULL AND time_archived IS NULL ORDER BY time_updated DESC LIMIT 5000").all();
            for (const row of rows) await add(row, index);
        } finally {
            db.close();
        }
        return sessions;
    }
    let visited = 0;
    async function walk(directory: string, depth: number): Promise<void> {
        try {
            const entries = await fs.opendir(directory);
            for await (const entry of entries) {
                if (options.signal?.aborted) return;
                if (++visited > (options.maxEntries ?? 20_000)) throw new Error("OpenCode metadata scan limit exceeded");
                const file = path.join(directory, entry.name);
                if (entry.isDirectory() && depth === 0) await walk(file, depth + 1);
                else if (entry.isFile() && depth === 1 && entry.name.endsWith(".json")) {
                    try {
                        const stat = await fs.stat(file);
                        if (stat.size > WINDOW_BYTES) continue;
                        const row = JSON.parse(await fs.readFile(file, "utf8"));
                        if (row && !row.parentID && row.time?.archived == null) await add(row, file);
                    } catch (error) {
                        if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                    }
                }
            }
        } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        }
    }
    await walk(path.join(root.directory, "storage", "session"), 0);
    return sessions;
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
        if (file.endsWith(".jsonl.zstd")) {
            const buffer = Buffer.alloc(Math.min(size, ZSTD_READ_BYTES));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            const { frames } = scanZstdFrames(buffer.subarray(0, bytesRead));
            const headChunks: string[] = [];
            let headBytes = 0;
            let headEndIndex = 0;
            for (; headEndIndex < frames.length && headBytes < WINDOW_BYTES; headEndIndex++) {
                try {
                    const frame = frames[headEndIndex]!;
                    const chunk = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end));
                    headChunks.push(chunk.toString("utf8"));
                    headBytes += chunk.length;
                } catch {
                    break;
                }
            }
            const result = records(headChunks.join(""));
            if (headEndIndex < frames.length) {
                const tailChunks: string[] = [];
                let tailBytes = 0;
                for (let i = frames.length - 1; i >= headEndIndex && tailBytes < WINDOW_BYTES; i--) {
                    try {
                        const frame = frames[i]!;
                        const chunk = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end));
                        tailChunks.unshift(chunk.toString("utf8"));
                        tailBytes += chunk.length;
                    } catch {
                        break;
                    }
                }
                result.push(...records(tailChunks.join("")));
            }
            return result;
        }
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
    if (harnessId === "ohMyPi") {
        const name = path.basename(file);
        if (name === "__advisor.jsonl" || (name.startsWith("__advisor.") && name.endsWith(".jsonl"))) {
            return undefined;
        }
        const firstUserMessage = rows.find((row) => row.type === "message" && row.message?.role === "user");
        if (firstUserMessage?.message.attribution === "agent") {
            return undefined;
        }
    }
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
        if (harnessId === "primeAgent" && typeof header?.rlmDepth === "number" && header.rlmDepth > 0) {
            return undefined;
        }
        if (harnessId === "ohMyPi" && typeof header?.parentSession === "string"
            && path.isAbsolute(header.parentSession) && header.parentSession.endsWith(".jsonl")) {
            // Task transcripts live under their parent's artifact directory even
            // after its JSONL disappears. Sibling forks also have parentSession.
            const relative = path.relative(header.parentSession.slice(0, -".jsonl".length), file);
            if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
                return undefined;
            }
        }
        if (harnessId === "deepseek" && (header?.origin === "subagent" || (typeof header?.delegationDepth === "number" && header.delegationDepth > 0))) {
            return undefined;
        }
    }
    if (!header || typeof header.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(header.id) || typeof header.cwd !== "string" || header.cwd.includes("\0") || !path.isAbsolute(header.cwd)) {
        return undefined;
    }
    let title = clean(header.title);
    let lastMessage = 0;
    for (const row of rows) {
        const isMessage = harnessId === "codex"
            ? (row.type === "event_msg" && (row.payload?.type === "user_message" || row.payload?.type === "agent_message"))
                || (row.type === "response_item" && row.payload?.type === "message" && (row.payload.role === "user" || row.payload.role === "assistant"))
            : row.type === "user" || row.type === "assistant"
                || (row.type === "message" && (row.message?.role === "user" || row.message?.role === "assistant"))
                || row.type === "user/message" || row.type === "assistant/message";
        if (isMessage && !row.isMeta && !row.isSidechain) {
            const timestamp = row.timestamp ?? row.message?.timestamp ?? row.data?.timestamp;
            const parsed = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : parseTimestamp(timestamp);
            lastMessage = Math.max(lastMessage, parsed);
        }
        if (row.type === "title" || row.type === "custom-title") {
            title = clean(row.title ?? row.customTitle) || title;
        } else if (row.type === "session_info" || row.type === "sessionInfo") {
            // Prime persists a null/empty name when the user clears a rename.
            title = harnessId === "primeAgent" ? clean(row.name) : clean(row.name) || title;
        } else if (row.type === "session/title") {
            title = clean(row.data?.title) || title;
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
            const message = row.type === "user" || row.type === "message"
                ? row.message
                : row.type === "user/message" && (!row.data?.source || row.data.source.kind === "user")
                    ? { role: "user", content: row.data?.content }
                    : undefined;
            if (message && (message.role === "user" || row.type === "user") && !row.isMeta) {
                const content = message.content;
                title = clean(typeof content === "string" ? content : Array.isArray(content)
                    ? content.filter((part: unknown): part is { type: "text"; text: string } =>
                        part !== null && typeof part === "object" && "type" in part && part.type === "text"
                        && "text" in part && typeof part.text === "string").map((part) => part.text).join(" ") : "");
                if (title) {
                    break;
                }
            }
        }
    }
    return { harnessId, id: header.id, cwd: header.cwd, file, modified: lastMessage || modified, title: title || header.id };
}

export async function scanSavedSessions(roots = sessionRoots(), limit = 100, filter?: SessionFilter, options: SessionScanOptions = {}): Promise<SessionScan> {
    const empty = { sessions: [], unreadable: [] };
    if (options.signal?.aborted || limit <= 0) {
        return empty;
    }
    if (filter) {
        roots = roots.filter((root) => root.harnessId === filter.harnessId);
    }
    const scopePath = filter ? await canonicalDirectory(filter.cwd) : undefined;
    const canonicalPaths = new Map<string, string>();
    async function matches(directory: string): Promise<boolean> {
        if (scopePath === undefined) return true;
        let canonical = canonicalPaths.get(directory);
        if (!canonical) {
            canonical = await canonicalDirectory(directory);
            canonicalPaths.set(directory, canonical);
        }
        return canonical === scopePath;
    }
    const indexedSessions: SavedSession[] = [];
    const unreadable = new Set<string>();
    const candidates: { root: SessionRoot; file: string; modified: number; size: number }[] = [];
    let visited = 0;
    const maxEntries = options.maxEntries ?? 20_000;
    async function walk(root: SessionRoot, directory: string, depth: number): Promise<void> {
        try {
            if (options.signal?.aborted) {
                return;
            }
            const entries = await fs.opendir(directory);
            let bestGeneration: { version: number; zstd: boolean; candidate: { root: SessionRoot; file: string; modified: number; size: number } } | undefined;
            for await (const entry of entries) {
                if (options.signal?.aborted) {
                    return;
                }
                if (++visited > maxEntries) {
                    unreadable.add(root.harnessId);
                    return;
                }
                const file = path.join(directory, entry.name);
                if (entry.isDirectory() && depth < 4 && !entry.name.startsWith(".") && !["subagents", "session-artifacts"].includes(entry.name)) {
                    // OMP stores advisor/subagent transcripts beside the owning JSONL,
                    // inside a directory with the same stem. They are not resumable peers.
                    if (root.harnessId === "ohMyPi") {
                        try {
                            if ((await fs.stat(`${file}.jsonl`)).isFile()) {
                                continue;
                            }
                        } catch (error) {
                            const code = (error as NodeJS.ErrnoException).code;
                            if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
                        }
                    }
                    await walk(root, file, depth + 1);
                } else if (entry.isFile() && (entry.name.endsWith(".jsonl") || (root.harnessId === "deepseek" && entry.name.endsWith(".jsonl.zstd")))) {
                    try {
                        const stat = await fs.stat(file);
                        if (stat.isFile()) {
                            const candidate = { root, file, modified: stat.mtimeMs, size: stat.size };
                            const match = root.harnessId === "deepseek" ? DSH_GENERATION_FILE.exec(entry.name) : null;
                            if (match) {
                                const version = match[1] ? Number(match[1]) : 0;
                                const zstd = entry.name.endsWith(".zstd");
                                if (!bestGeneration || version > bestGeneration.version || (version === bestGeneration.version && zstd && !bestGeneration.zstd)) {
                                    bestGeneration = { version, zstd, candidate };
                                }
                            } else {
                                candidates.push(candidate);
                            }
                        }
                    } catch {
                        // A session may disappear while the list is being refreshed.
                    }
                }
            }
            if (bestGeneration) {
                candidates.push(bestGeneration.candidate);
            }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "ENOTDIR") {
                unreadable.add(root.harnessId);
            }
        }
    }
    await Promise.all(roots.map(async (root) => {
        if (!path.isAbsolute(root.directory)) {
            unreadable.add(root.harnessId);
            return Promise.resolve();
        }
        if (root.harnessId === "openCode") {
            try {
                indexedSessions.push(...await scanOpenCode(root, matches, options));
            } catch {
                unreadable.add(root.harnessId);
            }
            return;
        }
        if (root.harnessId === "antigravity") {
            try {
                indexedSessions.push(...await scanAntigravity(root, matches, options.signal));
            } catch {
                unreadable.add(root.harnessId);
            }
            return;
        }
        return walk(root, root.directory, 0);
    }));
    const codexTitles = new Map<string, string>();
    for (const root of roots.filter((candidate) => candidate.harnessId === "codex")) {
        if (options.signal?.aborted) {
            return empty;
        }
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
    const sessions: SavedSession[] = [...indexedSessions];
    const seen = new Set<string>();
    for (const candidate of filter ? candidates : candidates.slice(0, MAX_CANDIDATES)) {
        if (options.signal?.aborted) {
            return empty;
        }
        try {
            const session = parseSession(candidate.root.harnessId, candidate.file, candidate.modified,
                await readWindows(candidate.file, candidate.size));
            if (session && !await matches(session.cwd)) {
                continue;
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
    if (options.signal?.aborted) return empty;
    sessions.sort((a, b) => b.modified - a.modified);
    return { sessions: sessions.slice(0, limit), unreadable: [...unreadable] };
}

export function resumeArguments(session: SavedSession): string[] {
    switch (session.harnessId) {
        case "openCode": return ["--session", session.id];
        case "antigravity": return ["--conversation", session.id];
        case "codex": return ["resume", session.id];
        case "claudeCode":
        case "deepseek": return ["--resume", session.id];
        case "pi": return ["--session", session.file];
        case "ohMyPi":
        case "primeAgent": return ["--resume", session.file];
        default: throw new Error(`Unsupported session provider: ${session.harnessId}`);
    }
}
