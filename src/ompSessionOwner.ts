import { readdir, readFile, readlink, realpath } from "node:fs/promises";

/** Other editor windows have separate terminal lists but share native OMP stores. */
export async function ompSessionHasWriter(file: string): Promise<boolean> {
    if (process.platform !== "linux") return false;
    try {
        const target = await realpath(file);
        const processes = await readdir("/proc");
        for (const pid of processes) {
            if (!/^\d+$/.test(pid)) continue;
            try {
                const base = `/proc/${pid}`;
                const command = (await readFile(`${base}/comm`, "utf8")).trim();
                if (command !== "omp") continue;
                const descriptors = (await readdir(`${base}/fd`)).slice(0, 1024);
                for (const descriptor of descriptors) {
                    try {
                        if (await readlink(`${base}/fd/${descriptor}`) !== target) continue;
                        const info = await readFile(`${base}/fdinfo/${descriptor}`, "utf8");
                        const flags = /^flags:\s+([0-7]+)$/m.exec(info)?.[1];
                        if (flags && (Number.parseInt(flags, 8) & 3) !== 0) return true;
                    } catch { /* Descriptors may close during inspection. */ }
                }
            } catch { /* Processes may exit or deny access. */ }
        }
    } catch { /* Optional /proc inspection must not break ordinary resume. */ }
    return false;
}
