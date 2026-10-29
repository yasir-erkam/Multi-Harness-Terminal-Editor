import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface SessionOwner {
    readonly pid: number;
    readonly startTime: string;
}

/** Linux start ticks identify a process independently of reusable PIDs. */
export async function processStartTime(pid: number, procRoot = "/proc"): Promise<string> {
    const text = await readFile(path.join(procRoot, String(pid), "stat"), "utf8");
    const value = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
    if (!value || !/^\d+$/.test(value)) throw new Error("Invalid process identity");
    return value;
}

export interface TakeoverDependencies {
    readonly owners: () => Promise<readonly SessionOwner[]>;
    readonly startTime?: (pid: number) => Promise<string>;
    readonly terminate?: (pid: number) => void;
    readonly wait?: () => Promise<void>;
    readonly attempts?: number;
}

/** Fail closed if ownership changed during confirmation; never escalate beyond SIGTERM. */
export async function releaseSessionOwners(expected: readonly SessionOwner[], dependencies: TakeoverDependencies): Promise<void> {
    const identity = (owner: SessionOwner): string => `${owner.pid}:${owner.startTime}`;
    const sameOwners = (owners: readonly SessionOwner[]): boolean => {
        const keys = new Set(expected.map(identity));
        return owners.length === expected.length && owners.every((owner) => keys.has(identity(owner)));
    };
    const current = await dependencies.owners();
    if (!sameOwners(current)) throw new Error("Session ownership changed");
    const startTime = dependencies.startTime ?? processStartTime;
    // Validate every owner before sending the first signal.
    for (const owner of current) {
        if (await startTime(owner.pid) !== owner.startTime) throw new Error("Process identity changed");
    }
    const terminate = dependencies.terminate ?? ((pid: number) => { process.kill(pid, "SIGTERM"); });
    for (const owner of current) {
        const live = await dependencies.owners();
        if (live.some((candidate) => !expected.some((known) => identity(known) === identity(candidate)))
            || !live.some((candidate) => identity(candidate) === identity(owner))) throw new Error("Session ownership changed");
        if (await startTime(owner.pid) !== owner.startTime) throw new Error("Process identity changed");
        terminate(owner.pid);
    }
    const wait = dependencies.wait ?? (() => delay(100));
    for (let attempt = 0; attempt < (dependencies.attempts ?? 50); attempt++) {
        if ((await dependencies.owners()).length === 0) return;
        await wait();
    }
    if ((await dependencies.owners()).length !== 0) throw new Error("Session ownership was not released");
}
