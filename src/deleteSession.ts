import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import * as zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { scanZstdFrames, supportsSessionDeletion, type SavedSession, type SessionRoot } from "./savedSessions";

export class SessionDeletionError extends Error {
    constructor(readonly reason: "invalidFile" | "outsideStore" | "sharedFile" | "changedFile", message: string) {
        super(message);
    }
}

/** DeepSeek migrations leave older generations that would otherwise reappear. */
export async function sessionDeletionFiles(session: SavedSession, roots: readonly SessionRoot[]): Promise<SavedSession[]> {
    const files: SavedSession[] = [];
    const generation = /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/;
    if (session.harnessId === "deepseek" && generation.test(path.basename(session.file))) {
        for (const entry of await fs.readdir(path.dirname(session.file), { withFileTypes: true })) {
            const file = path.join(path.dirname(session.file), entry.name);
            if (generation.test(entry.name) && file !== session.file) files.push({ ...session, file });
        }
    }
    // Keep the listed generation until all its older records have been removed.
    files.push(session);
    for (const file of files) await validateSessionDeletion(file, roots);
    return files;
}

/** Return the validated deletion path; Grok requires recursive directory deletion. */
export async function sessionDeletionTarget(session: SavedSession, roots: readonly SessionRoot[]): Promise<string> {
    await validateSessionDeletion(session, roots);
    return session.harnessId === "grokBuild" ? path.dirname(path.resolve(session.file)) : session.file;
}

async function validateGrokDeletion(session: SavedSession, roots: readonly SessionRoot[]): Promise<void> {
    const file = path.resolve(session.file);
    const directory = path.dirname(file);
    if (!path.isAbsolute(session.file) || path.basename(file) !== "summary.json"
        || !/^[a-zA-Z0-9_-]{1,160}$/.test(session.id) || path.basename(directory) !== session.id) {
        throw new SessionDeletionError("invalidFile", "The Grok session path is invalid.");
    }
    // Check every ancestor, including ancestors above the configured store.
    let ancestor = directory;
    while (true) {
        const stat = await fs.lstat(ancestor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new SessionDeletionError("invalidFile", "The Grok session has a linked or invalid ancestor.");
        }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
    }
    const canonicalDirectory = await fs.realpath(directory);
    let contained = false;
    for (const root of roots.filter((candidate) => candidate.harnessId === "grokBuild")) {
        if (!path.isAbsolute(root.directory)) continue;
        const canonicalRoot = await fs.realpath(root.directory).catch(() => undefined);
        if (!canonicalRoot) continue;
        const relative = path.relative(canonicalRoot, canonicalDirectory);
        const parts = relative.split(path.sep);
        contained ||= !path.isAbsolute(relative) && parts.length === 2
            && parts.every((part) => part !== "" && part !== "." && part !== "..") && parts[1] === session.id;
    }
    if (!contained) {
        throw new SessionDeletionError("outsideStore", "The Grok session is outside its configured store layout.");
    }
    const nativeFiles = new Set([
        "summary.json", "updates.jsonl", "chat_history.jsonl", "events.jsonl", "system_prompt.txt",
        "prompt_context.json", "tool_definitions.json", "plan.json", "plan_mode.json", "signals.json",
        "resources_state.json", "rewind_points.jsonl", "usage.json", "title_refresh_idx",
        "last_recap_main_turn", "last_recap", "feedback_drafts.json",
    ]);
    const entries = await fs.readdir(directory);
    if (!entries.includes("summary.json") || !entries.includes("updates.jsonl")) {
        throw new SessionDeletionError("changedFile", "The Grok session records are missing.");
    }
    for (const name of entries) {
        const content = path.join(directory, name);
        const stat = await fs.lstat(content);
        if (stat.isSymbolicLink()) throw new SessionDeletionError("invalidFile", "The Grok session contains linked files.");
        if (stat.isDirectory() && ["terminal", "recap_requests", "subagents"].includes(name)) {
            const validateContents = async (parent: string, kind: string): Promise<void> => {
                const canonicalParent = await fs.realpath(parent);
                if (path.relative(canonicalDirectory, canonicalParent).split(path.sep).includes("..")) {
                    throw new SessionDeletionError("outsideStore", "The Grok auxiliary data is outside its session.");
                }
                for (const child of await fs.readdir(parent)) {
                    const childFile = path.join(parent, child);
                    const childStat = await fs.lstat(childFile);
                    if (childStat.isSymbolicLink()) {
                        throw new SessionDeletionError("invalidFile", "The Grok session contains linked files.");
                    }
                    if (kind === "subagents" && childStat.isDirectory() && /^[a-zA-Z0-9_-]{1,160}$/.test(child)) {
                        await validateContents(childFile, "subagentMetadata");
                        continue;
                    }
                    const recognized = kind === "terminal" ? /^call_[a-zA-Z0-9_-]+\.log$/.test(child)
                        : kind === "recap_requests" ? /^[a-zA-Z0-9_-]{1,160}\.json$/.test(child)
                        : kind === "subagentMetadata" && ["meta.json", "output.json"].includes(child);
                    if (!recognized) {
                        throw new SessionDeletionError("sharedFile", "The Grok session contains unrecognized nested data.");
                    }
                    if (!childStat.isFile() || childStat.nlink !== 1) {
                        throw new SessionDeletionError("invalidFile", "The Grok session contains linked or non-regular files.");
                    }
                    if (path.dirname(await fs.realpath(childFile)) !== canonicalParent) {
                        throw new SessionDeletionError("outsideStore", "The Grok auxiliary file is outside its directory.");
                    }
                }
            };
            await validateContents(content, name);
            continue;
        }
        const base = name.endsWith(".lock") ? name.slice(0, -5) : name;
        if (!nativeFiles.has(base)) throw new SessionDeletionError("sharedFile", "The Grok session contains unrecognized data.");
        if (!stat.isFile() || stat.nlink !== 1) throw new SessionDeletionError("invalidFile", "The Grok session contains linked or non-regular files.");
        if (path.dirname(await fs.realpath(content)) !== canonicalDirectory) {
            throw new SessionDeletionError("outsideStore", "The Grok session content is outside its directory.");
        }
    }
    let row: any;
    try {
        row = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code) throw error;
        throw new SessionDeletionError("changedFile", "The Grok session summary is invalid; refresh the session list.");
    }
    if (typeof row?.info?.id !== "string" || row.info.id !== session.id
        || typeof row.info.cwd !== "string" || !path.isAbsolute(row.info.cwd) || row.info.cwd.includes("\u0000")
        || !path.isAbsolute(session.cwd) || session.cwd.includes("\u0000")
        || row.session_kind === "subagent" || row.session_kind === "chat") {
        throw new SessionDeletionError("changedFile", "The Grok session identity changed; refresh the session list.");
    }
    const normalize = async (value: string): Promise<string> => {
        const resolved = await fs.realpath(value).catch(() => path.resolve(value));
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    if (await normalize(row.info.cwd) !== await normalize(session.cwd)) {
        throw new SessionDeletionError("changedFile", "The Grok session project changed; refresh the session list.");
    }
}

/** Validate the live file, never a path supplied by a view or webview. */
export async function validateSessionDeletion(session: SavedSession, roots: readonly SessionRoot[]): Promise<void> {
    if (!supportsSessionDeletion(session.harnessId) || session.harnessId === "openCode") {
        throw new SessionDeletionError("invalidFile", "This provider requires its native deletion workflow.");
    }
    if (session.harnessId === "grokBuild") {
        await validateGrokDeletion(session, roots);
        return;
    }
    const stat = await fs.lstat(session.file);
    const isZstd = session.harnessId === "deepseek" && session.file.endsWith(".jsonl.zstd");
    if (!stat.isFile() || stat.isSymbolicLink() || (!session.file.endsWith(".jsonl") && !isZstd)) {
        throw new SessionDeletionError("invalidFile", "The session record is not a regular JSONL file.");
    }
    const file = await fs.realpath(session.file);
    let contained = false;
    for (const root of roots.filter((candidate) => candidate.harnessId === session.harnessId)) {
        const directory = await fs.realpath(root.directory).catch(() => undefined);
        if (directory) {
            const relative = path.relative(directory, file);
            contained ||= relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        }
    }
    if (!contained) {
        throw new SessionDeletionError("outsideStore", "The session record is outside its configured store.");
    }
    let identified = false;
    const normalize = async (value: string): Promise<string> => {
        const resolved = await fs.realpath(value).catch(() => path.resolve(value));
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    const inspectLine = async (line: string): Promise<void> => {
        let row: any;
        try { row = JSON.parse(line); } catch { return; }
        if (!row || typeof row !== "object") return;
        const id = session.harnessId === "codex" ? (row.type === "session_meta" ? row.payload?.id : undefined)
            : session.harnessId === "claudeCode" ? row.sessionId
            : row.type === "session" ? row.id : undefined;
        if (typeof id === "string") {
            if (id !== session.id) {
                throw new SessionDeletionError("sharedFile", "The file contains another conversation; it cannot be deleted safely.");
            }
            if (!identified) {
                const cwd = session.harnessId === "codex" ? row.payload?.cwd : row.cwd;
                // Claude queue/metadata rows can carry an ID without a cwd.
                if (typeof cwd !== "string") return;
                if (await normalize(cwd) !== await normalize(session.cwd)) {
                    throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
                }
            }
            identified = true;
        }
    };
    if (isZstd) {
        const buffer = await fs.readFile(file);
        const scan = scanZstdFrames(buffer);
        if (scan.error || scan.completePrefixLength !== buffer.length || scan.frames.length === 0) {
            throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
        }
        const decoder = new StringDecoder("utf8");
        let partial = "";
        for (const frame of scan.frames) {
            let chunk: Buffer;
            try {
                chunk = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end));
            } catch {
                throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
            }
            const lines = (partial + decoder.write(chunk)).split("\n");
            partial = lines.pop()!;
            for (const line of lines) {
                await inspectLine(line);
            }
        }
        await inspectLine(partial + decoder.end());
    } else {
        const stream = createReadStream(file, { encoding: "utf8" });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
            for await (const line of lines) {
                await inspectLine(line);
            }
        } finally {
            lines.close();
            stream.destroy();
        }
    }
    if (!identified) {
        throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
    }
}
