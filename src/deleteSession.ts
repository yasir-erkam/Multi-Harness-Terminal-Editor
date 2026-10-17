import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import * as zlib from "node:zlib";
import { scanZstdFrames, supportsSessionDeletion, type SavedSession, type SessionRoot } from "./savedSessions";

export class SessionDeletionError extends Error {
    constructor(readonly reason: "invalidFile" | "outsideStore" | "sharedFile" | "changedFile", message: string) {
        super(message);
    }
}

/** Validate the live file, never a path supplied by a view or webview. */
export async function validateSessionDeletion(session: SavedSession, roots: readonly SessionRoot[]): Promise<void> {
    if (!supportsSessionDeletion(session.harnessId)) {
        throw new SessionDeletionError("invalidFile", "SQLite session deletion is not supported.");
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
                if (typeof cwd !== "string" || await normalize(cwd) !== await normalize(session.cwd)) {
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
        for (const frame of scan.frames) {
            let chunk: Buffer;
            try {
                chunk = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end));
            } catch {
                throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
            }
            for (const line of chunk.toString("utf8").split("\n")) {
                await inspectLine(line);
            }
        }
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
