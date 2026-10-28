import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface GrokOwner {
    readonly sessionId: string;
    readonly pid: number;
}

/** The native registry's Linux start ticks prevent PID reuse from claiming a session. */
export async function grokOwners(sessionsRoot: string, procRoot = "/proc", platform = process.platform): Promise<GrokOwner[]> {
    if (platform !== "linux") return [];
    const file = path.join(sessionsRoot, "..", "active_sessions.json");
    try {
        await fs.lstat(`${file}.corrupt`);
        throw new Error("Grok active-session registry has an unresolved corrupt backup");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const handle = await fs.open(file, "r").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
    });
    if (!handle) return [];
    let rows: unknown;
    try {
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024 * 1024) throw new Error("Grok active-session registry exceeds scan limit");
        rows = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    } finally {
        await handle.close();
    }
    if (!Array.isArray(rows)) throw new Error("Invalid Grok active-session registry");
    const result: GrokOwner[] = [];
    for (const row of rows) {
        if (!row || typeof row.session_id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(row.session_id)
            || !Number.isSafeInteger(row.pid) || row.pid <= 0 || !Number.isSafeInteger(row.pid_start) || row.pid_start <= 0) {
            throw new Error("Invalid Grok active-session identity");
        }
        try {
            const text = await fs.readFile(path.join(procRoot, String(row.pid), "stat"), "utf8");
            const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
            if (Number(fields[19]) === row.pid_start) result.push({ sessionId: row.session_id, pid: row.pid });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    }
    return result;
}

/** A shared daemon holding several sessions cannot identify one terminal's conversation. */
export async function grokSessionForProcess(pid: number, owners: readonly GrokOwner[], procRoot = "/proc"): Promise<string | undefined> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
    const pending = [pid];
    const visited = new Set<number>();
    const sessions = new Set<string>();
    while (pending.length && visited.size < 64) {
        const current = pending.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const own = owners.filter((owner) => owner.pid === current);
        if (own.length) {
            for (const owner of own) sessions.add(owner.sessionId);
            continue;
        }
        try {
            const children = await fs.readFile(path.join(procRoot, String(current), "task", String(current), "children"), "utf8");
            for (const child of children.trim().split(/\s+/)) {
                const childPid = Number(child);
                if (Number.isSafeInteger(childPid) && childPid > 0 && pending.length < 64) pending.push(childPid);
            }
        } catch { /* Closed or restricted processes cannot prove live identity. */ }
    }
    return sessions.size === 1 ? [...sessions][0] : undefined;
}
