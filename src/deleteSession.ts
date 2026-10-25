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

/** Validate the live file, never a path supplied by a view or webview. */
export async function validateSessionDeletion(session: SavedSession, roots: readonly SessionRoot[]): Promise<void> {
    if (!supportsSessionDeletion(session.harnessId) || session.harnessId === "openCode") {
        throw new SessionDeletionError("invalidFile", "This provider requires its native deletion workflow.");
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
