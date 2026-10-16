import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { supportsSessionDeletion, type SavedSession, type SessionRoot } from "./savedSessions";

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
    if (!stat.isFile() || stat.isSymbolicLink() || !session.file.endsWith(".jsonl")) {
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
    const stream = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let identified = false;
    try {
        for await (const line of lines) {
            let row: any;
            try { row = JSON.parse(line); } catch { continue; }
            if (!row || typeof row !== "object") continue;
            const id = session.harnessId === "codex" ? (row.type === "session_meta" ? row.payload?.id : undefined)
                : session.harnessId === "claudeCode" ? row.sessionId
                : row.type === "session" ? row.id : undefined;
            if (typeof id === "string") {
                if (id !== session.id) {
                    throw new SessionDeletionError("sharedFile", "The file contains another conversation; it cannot be deleted safely.");
                }
                if (!identified) {
                    const cwd = session.harnessId === "codex" ? row.payload?.cwd : row.cwd;
                    const normalize = async (value: string): Promise<string> => {
                        const resolved = await fs.realpath(value).catch(() => path.resolve(value));
                        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
                    };
                    if (typeof cwd !== "string" || await normalize(cwd) !== await normalize(session.cwd)) {
                        throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
                    }
                }
                identified = true;
            }
        }
    } finally {
        lines.close();
        stream.destroy();
    }
    if (!identified) {
        throw new SessionDeletionError("changedFile", "The session record changed; refresh the session list.");
    }
}
