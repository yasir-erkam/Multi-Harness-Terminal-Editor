import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SavedSession, SessionRoot } from "./savedSessions";
import { SessionDeletionError } from "./deleteSession";

// Storage layouts and deletion ownership:
// https://github.com/anomalyco/opencode/blob/02b7eb59/packages/opencode/src/session/index.ts
// https://github.com/anomalyco/opencode/blob/02b7eb59/packages/opencode/src/share/share-next.ts
// https://github.com/dmore/opencode-ai-open-source-coding-agent/blob/dev/packages/opencode/src/session/session.sql.ts
// https://github.com/dmore/opencode-ai-open-source-coding-agent/blob/dev/packages/opencode/src/share/share.sql.ts
// https://github.com/dmore/opencode-ai-open-source-coding-agent/blob/dev/packages/opencode/src/sync/event.sql.ts
// This removes local records only; it does not revoke externally published shares.
const sessionID = /^ses_[a-zA-Z0-9]+$/;
const messageID = /^msg_[a-zA-Z0-9]+$/;
const partID = /^prt_[a-zA-Z0-9]+$/;

function fail(reason: "invalidFile" | "outsideStore" | "sharedFile" | "changedFile", message: string): never {
    throw new SessionDeletionError(reason, message);
}

function inside(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Reject links in every store-relative component, including optional metadata. */
async function inspect(root: string, file: string, optional = false): Promise<Stats | undefined> {
    if (!inside(root, file)) fail("outsideStore", "The OpenCode record is outside its configured store.");
    const components = path.relative(root, file).split(path.sep);
    let current = root;
    for (let index = -1; index < components.length; index++) {
        if (index >= 0) current = path.join(current, components[index]);
        let stat;
        try { stat = await fs.lstat(current); } catch (error) {
            if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw error;
        }
        if (stat.isSymbolicLink() || (index < components.length - 1 && !stat.isDirectory())) {
            fail("invalidFile", "OpenCode store paths must not contain symbolic links or non-directories.");
        }
        if (index === components.length - 1) return stat;
    }
    return undefined;
}

async function storeRoot(session: SavedSession, roots: readonly SessionRoot[]): Promise<string> {
    if (session.harnessId !== "openCode" || !sessionID.test(session.id) || !path.isAbsolute(session.cwd)) {
        fail("invalidFile", "The OpenCode session identity is invalid.");
    }
    const file = path.resolve(session.file);
    for (const candidate of roots) {
        if (candidate.harnessId !== "openCode") continue;
        const root = path.resolve(candidate.directory);
        if (!inside(root, file)) continue;
        const stat = await inspect(root, file);
        if (!stat?.isFile()) fail("invalidFile", "The OpenCode record is not a regular file.");
        const canonical = await fs.realpath(root);
        if (!inside(canonical, await fs.realpath(file))) fail("outsideStore", "The OpenCode record escaped its configured store.");
        return root;
    }
    return fail("outsideStore", "The OpenCode record is outside its configured store.");
}

async function sameDirectory(actual: unknown, expected: string): Promise<void> {
    if (typeof actual !== "string" || !path.isAbsolute(actual)) fail("changedFile", "The OpenCode session directory changed; refresh the session list.");
    const normalize = async (value: string) => {
        const resolved = await fs.realpath(value).catch(() => path.resolve(value));
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    if (await normalize(actual) !== await normalize(expected)) fail("changedFile", "The OpenCode session directory changed; refresh the session list.");
}

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/** Only known ownership relationships may participate in a destructive transaction. */
function schema(db: DatabaseSync): Set<string> {
    const tables = new Set<string>();
    const required: Record<string, readonly string[]> = {
        session: ["id", "directory", "parent_id"], message: ["id", "session_id"], part: ["id", "message_id", "session_id"],
        todo: ["session_id"], session_share: ["session_id"], event: ["id", "aggregate_id"], event_sequence: ["aggregate_id"],
    };
    const owned = new Set(Object.keys(required));
    const objects = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    for (const object of objects) {
        const name = String(object.name);
        if (object.type === "trigger") fail("invalidFile", "OpenCode databases with triggers cannot be deleted safely.");
        if (object.type !== "table") continue;
        tables.add(name);
        const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
        const names = new Set(columns.map((column) => String(column.name)));
        if (required[name]?.some((column) => !names.has(column))) fail("invalidFile", "The OpenCode database schema is unsupported.");
        if (["session", "message", "part"].includes(name) && !columns.some((column) => column.name === "id" && Number(column.pk) === 1)) {
            fail("invalidFile", "The OpenCode database lacks a safe primary session/message/part identity.");
        }
        if (!owned.has(name) && ["session_id", "message_id", "part_id", "aggregate_id", "parent_id"].some((column) => names.has(column))) {
            fail("invalidFile", "The OpenCode database contains unknown conversation metadata.");
        }
        for (const fk of db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all()) {
            const target = String(fk.table);
            const known = (name === "message" && target === "session" && fk.from === "session_id" && fk.to === "id")
                || (name === "part" && target === "message" && fk.from === "message_id" && fk.to === "id")
                || (["todo", "session_share"].includes(name) && target === "session" && fk.from === "session_id" && fk.to === "id")
                || (name === "event" && target === "event_sequence" && fk.from === "aggregate_id" && fk.to === "aggregate_id");
            if (owned.has(target) && !known) fail("invalidFile", "The OpenCode database contains an unsupported deletion relationship.");
        }
    }
    if (["session", "message", "part"].some((table) => !tables.has(table))) fail("invalidFile", "The OpenCode database schema is unsupported.");
    if (tables.has("event") !== tables.has("event_sequence")) fail("invalidFile", "The OpenCode event schema is incomplete.");
    return tables;
}

async function sqlite(session: SavedSession, root: string, deleting: boolean): Promise<void> {
    for (const suffix of ["-wal", "-shm", "-journal"]) {
        const stat = await inspect(root, session.file + suffix, true);
        if (stat && !stat.isFile()) fail("invalidFile", "The OpenCode database sidecar is not a regular file.");
    }
    const identity = await inspect(root, session.file);
    // Older extension hosts lack node:sqlite; keep JSON session deletion loadable there.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(session.file, { readOnly: !deleting });
    let transaction = false;
    try {
        db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
        db.exec(deleting ? "BEGIN IMMEDIATE" : "BEGIN");
        transaction = true;
        const tables = schema(db);
        const row = db.prepare("SELECT id, directory FROM session WHERE id = ?").get(session.id);
        if (!row || row.id !== session.id) fail("changedFile", "The OpenCode session changed; refresh the session list.");
        await sameDirectory(row.directory, session.cwd);
        const rows = db.prepare("WITH RECURSIVE descendants(id) AS (SELECT id FROM session WHERE id = ? UNION SELECT s.id FROM session s JOIN descendants d ON s.parent_id = d.id) SELECT id FROM descendants").all(session.id);
        const ids = rows.map((entry) => String(entry.id));
        if (ids.some((id) => !sessionID.test(id))) fail("invalidFile", "An OpenCode descendant has an invalid identity.");
        // A corrupt cross-session part must never cause unrelated records to be removed.
        const selected = new Set(ids);
        const parts = db.prepare("SELECT p.session_id, m.session_id AS message_session FROM part p LEFT JOIN message m ON m.id = p.message_id").all();
        for (const part of parts) {
            if ((selected.has(String(part.session_id)) || selected.has(String(part.message_session))) && part.session_id !== part.message_session) {
                fail("sharedFile", "OpenCode parts have inconsistent conversation ownership.");
            }
        }
        const live = await inspect(root, session.file);
        if (!identity || !live || identity.dev !== live.dev || identity.ino !== live.ino) fail("changedFile", "The OpenCode database changed; refresh the session list.");
        if (deleting) {
            const deleteParts = db.prepare("DELETE FROM part WHERE session_id = ?");
            const deleteMessages = db.prepare("DELETE FROM message WHERE session_id = ?");
            const deleteSession = db.prepare("DELETE FROM session WHERE id = ?");
            const metadataDeletes = ["todo", "session_share"].filter((table) => tables.has(table))
                .map((table) => db.prepare(`DELETE FROM ${quote(table)} WHERE session_id = ?`));
            const deleteEvents = tables.has("event") ? db.prepare("DELETE FROM event WHERE aggregate_id = ?") : undefined;
            const deleteSequence = tables.has("event") ? db.prepare("DELETE FROM event_sequence WHERE aggregate_id = ?") : undefined;
            // Explicit child cleanup also works with old databases lacking FK declarations.
            for (const id of ids) {
                deleteParts.run(id);
                deleteMessages.run(id);
                for (const statement of metadataDeletes) statement.run(id);
                deleteEvents?.run(id);
                deleteSequence?.run(id);
            }
            for (const id of ids.reverse()) deleteSession.run(id);
        }
        db.exec(deleting ? "COMMIT" : "ROLLBACK");
        transaction = false;
    } finally {
        try { if (transaction) db.exec("ROLLBACK"); } finally { db.close(); }
    }
}

type JsonRecord = Record<string, any>;
interface LegacyFile { file: string; content: string; dev: number; ino: number }

async function legacy(session: SavedSession, root: string, deleting: boolean): Promise<void> {
    const project = path.dirname(session.file);
    if (path.dirname(project) !== path.join(root, "storage", "session") || path.basename(session.file) !== `${session.id}.json`) {
        fail("invalidFile", "The OpenCode legacy session path is invalid.");
    }
    const plan: LegacyFile[] = [];
    const read = async (file: string): Promise<JsonRecord> => {
        const stat = await inspect(root, file);
        if (!stat?.isFile()) fail("invalidFile", "OpenCode metadata must be a regular JSON file.");
        const content = await fs.readFile(file, "utf8");
        let row;
        try { row = JSON.parse(content); } catch { return fail("invalidFile", "OpenCode metadata contains invalid JSON."); }
        if (row === null || typeof row !== "object") fail("invalidFile", "OpenCode metadata is invalid.");
        plan.push({ file, content, dev: stat.dev, ino: stat.ino });
        return row;
    };
    const entries = async (directory: string): Promise<string[]> => {
        const stat = await inspect(root, directory, true);
        if (!stat) return [];
        if (!stat.isDirectory()) fail("invalidFile", "The OpenCode metadata directory is invalid.");
        const names = await fs.readdir(directory);
        for (const name of names) {
            const child = await inspect(root, path.join(directory, name));
            if (!child?.isFile() || !name.endsWith(".json")) fail("invalidFile", "The OpenCode metadata layout is unsupported.");
        }
        return names;
    };
    const sessions = new Map<string, { row: JsonRecord; file: string }>();
    // Discover descendants before removing anything, including archived children.
    for (const name of await entries(project)) {
        const file = path.join(project, name);
        const row = await read(file);
        if (typeof row.id !== "string" || !sessionID.test(row.id) || name !== `${row.id}.json`
            || (row.parentID != null && (typeof row.parentID !== "string" || !sessionID.test(row.parentID)))) {
            fail("invalidFile", "The OpenCode legacy session identity is invalid.");
        }
        sessions.set(row.id, { row, file });
    }
    const target = sessions.get(session.id);
    if (!target || target.file !== session.file) fail("changedFile", "The OpenCode session changed; refresh the session list.");
    await sameDirectory(target.row.directory, session.cwd);
    const selected = new Set([session.id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [id, entry] of sessions) if (!selected.has(id) && selected.has(entry.row.parentID)) { selected.add(id); changed = true; }
    }
    const metadata = plan.filter((entry) => selected.has(path.basename(entry.file, ".json")));
    plan.length = 0;
    for (const id of selected) {
        const info = sessions.get(id)!.row;
        if (info.projectID != null && info.projectID !== path.basename(project)) {
            fail("sharedFile", "OpenCode session metadata belongs to another project.");
        }
        const messages = path.join(root, "storage", "message", id);
        for (const name of await entries(messages)) {
            const file = path.join(messages, name);
            const row = await read(file);
            if (typeof row.id !== "string" || !messageID.test(row.id) || name !== `${row.id}.json` || row.sessionID !== id) {
                fail("sharedFile", "OpenCode message ownership is invalid.");
            }
            const messageFile = plan.pop()!;
            for (const part of await entries(path.join(root, "storage", "part", row.id))) {
                const record = await read(path.join(root, "storage", "part", row.id, part));
                if (typeof record.id !== "string" || !partID.test(record.id) || part !== `${record.id}.json` || record.sessionID !== id || record.messageID !== row.id) {
                    fail("sharedFile", "OpenCode part ownership is invalid.");
                }
            }
            plan.push(messageFile);
        }
        for (const category of ["session_diff", "todo", "session_share", "share"]) {
            const file = path.join(root, "storage", category, `${id}.json`);
            if (await inspect(root, file, true)) await read(file);
        }
    }
    // Session metadata last: interrupted filesystem cleanup leaves discoverable records.
    plan.push(...metadata.reverse());
    for (const entry of plan) {
        const stat = await inspect(root, entry.file);
        if (!stat || stat.dev !== entry.dev || stat.ino !== entry.ino || await fs.readFile(entry.file, "utf8") !== entry.content) {
            fail("changedFile", "The OpenCode metadata changed; refresh the session list.");
        }
    }
    if (deleting) for (const entry of plan) {
        const stat = await inspect(root, entry.file);
        if (!stat || stat.dev !== entry.dev || stat.ino !== entry.ino || await fs.readFile(entry.file, "utf8") !== entry.content) {
            fail("changedFile", "The OpenCode metadata changed; refresh the session list.");
        }
        await fs.unlink(entry.file);
    }
}

async function processSession(session: SavedSession, roots: readonly SessionRoot[], deleting: boolean): Promise<void> {
    // Normalize paths once; all subsequent layout comparisons use absolute paths.
    session = { ...session, file: path.resolve(session.file) };
    const root = await storeRoot(session, roots);
    if (session.file === path.join(root, "opencode.db")) await sqlite(session, root, deleting);
    else {
        if (await inspect(root, path.join(root, "opencode.db"), true)) {
            fail("invalidFile", "The OpenCode SQLite store is authoritative; refresh the session list before deleting legacy records.");
        }
        await legacy(session, root, deleting);
    }
}

export async function validateOpenCodeDeletion(session: SavedSession, roots: readonly SessionRoot[]): Promise<void> {
    await processSession(session, roots, false);
}

export async function deleteOpenCodeSession(session: SavedSession, roots: readonly SessionRoot[]): Promise<void> {
    await processSession(session, roots, true);
}
