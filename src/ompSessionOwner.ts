import { readdir, readFile, readlink, realpath } from "node:fs/promises";
import * as path from "node:path";
import { processStartTime, type SessionOwner } from "./sessionTakeover";

/** Other editor windows have separate terminal lists but share native OMP stores. */
export async function ompSessionOwners(file: string, procRoot = "/proc", platform = process.platform): Promise<SessionOwner[]> {
    if (platform !== "linux") return [];
    let target: string;
    try {
        target = await realpath(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    // Native OMP advisor/task transcripts live below the main JSONL's stem.
    // Compare canonical paths so a symlink cannot disguise another conversation.
    const artifacts = target.endsWith(".jsonl") ? target.slice(0, -".jsonl".length) : undefined;
    const result: SessionOwner[] = [];
    for (const pid of await readdir(procRoot)) {
        if (!/^\d+$/.test(pid)) continue;
        const base = path.join(procRoot, pid);
        let command: string;
        try {
            command = (await readFile(`${base}/comm`, "utf8")).trim();
        } catch (error) {
            if (["ENOENT", "ESRCH", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
            throw error;
        }
        if (command !== "omp") continue;
        try {
            const startTime = await processStartTime(Number(pid), procRoot);
            const descriptors = await readdir(`${base}/fd`);
            let ownsTarget = false;
            let ownsOtherSession = false;
            for (const descriptor of descriptors) {
                try {
                    const destination = await readlink(`${base}/fd/${descriptor}`);
                    const info = await readFile(`${base}/fdinfo/${descriptor}`, "utf8");
                    const flags = /^flags:\s+([0-7]+)$/m.exec(info)?.[1];
                    if (!flags) throw new Error("Cannot inspect OMP descriptor access");
                    if ((Number.parseInt(flags, 8) & 3) === 0) continue;
                    if (destination === target) ownsTarget = true;
                    else if (destination.endsWith(".jsonl")) {
                        const canonical = await realpath(destination);
                        const relative = artifacts ? path.relative(artifacts, canonical) : "..";
                        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                            ownsOtherSession = true;
                        }
                    }
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
            }
            if (ownsTarget) {
                if (ownsOtherSession) throw new Error("OMP process owns another session");
                if (await processStartTime(Number(pid), procRoot) !== startTime) throw new Error("OMP process identity changed");
                result.push({ pid: Number(pid), startTime });
            }
        } catch (error) {
            if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        }
    }
    return result;
}
