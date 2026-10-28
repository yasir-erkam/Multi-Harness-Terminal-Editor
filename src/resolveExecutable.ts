import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface LookupOptions {
    /**
     * Injected for testability; defaults to the real platform.
     * Only "win32" (Windows semantics) vs anything else (POSIX semantics) matters.
     */
    platform?: NodeJS.Platform;
    /** Extra directories searched right after the workspace `node_modules/.bin`. */
    user?: {
        home: string;
        appData?: string;
        localAppData?: string;
        fnmDir?: string;
    };
    /** Optional PATH-like directory list one level below the current request. */
    nextPathDirs?: readonly string[];
    /** Workspace root; its `node_modules/.bin` is searched first. */
    rootFolder?: string;
}

const WIN_EXECUTABLE_SUFFIXES = [".cmd", ".exe", ".ps1", ".bat"];

function accessChecker(platform: NodeJS.Platform): (candidate: string) => boolean {
    if (platform === "win32") {
        return (candidate) => {
            try {
                fs.accessSync(candidate, fs.constants.F_OK);
                return true;
            } catch {
                return false;
            }
        };
    }
    return (candidate) => {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    };
}

function suffixCandidates(name: string, platform: NodeJS.Platform): string[] {
    if (platform !== "win32") {
        return [name];
    }
    const ext = path.extname(name);
    if (ext) {
        return [name];
    }
    return [...WIN_EXECUTABLE_SUFFIXES.map((s) => name + s), name];
}

function userDirectories(options: LookupOptions, platform: NodeJS.Platform): string[] {
    const home = options.user?.home ?? os.homedir();
    const dirs: string[] = [path.join(home, ".grok", "bin")];
    if (platform === "win32") {
        const appData = options.user?.appData ?? process.env.APPDATA;
        const localAppData = options.user?.localAppData ?? process.env.LOCALAPPDATA;
        if (appData) {
            dirs.push(path.join(appData, "npm"));
        }
        if (localAppData) {
            dirs.push(path.join(localAppData, "pnpm"));
            dirs.push(path.join(localAppData, "agy", "bin"));
        }
    } else {
        dirs.push(path.join(home, ".bun", "bin"));
        dirs.push(path.join(home, ".local", "bin"));
        dirs.push(path.join(home, ".npm-global", "bin"));
    }
    return dirs;
}

/** Windows npm shims live beside node.exe in fnm's permanent installations. */
function fnmDirectories(options: LookupOptions, platform: NodeJS.Platform): string[] {
    if (platform !== "win32") {
        return [];
    }
    const home = options.user?.home ?? os.homedir();
    const appData = options.user?.appData ?? process.env.APPDATA;
    const localAppData = options.user?.localAppData ?? process.env.LOCALAPPDATA;
    const roots = [
        options.user?.fnmDir ?? process.env.FNM_DIR,
        ...(appData ? [path.join(appData, "fnm")] : []),
        ...(localAppData ? [path.join(localAppData, "fnm")] : []),
        path.join(home, ".fnm"),
    ];
    const dirs: string[] = [];
    for (const root of new Set(roots)) {
        if (!root) {
            continue;
        }
        // Prefer the configured default, resolving its junction to a permanent path.
        try {
            dirs.push(fs.realpathSync(path.join(root, "aliases", "default")));
        } catch {
            // A default alias is optional, and deleted junction targets are harmless.
        }
        const versions = path.join(root, "node-versions");
        try {
            const names = fs.readdirSync(versions).filter((name) => /^v\d+\.\d+\.\d+$/.test(name));
            names.sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
            dirs.push(...names.map((name) => path.join(versions, name, "installation")));
        } catch {
            // fnm may be absent or its installation directory inaccessible.
        }
    }
    return dirs;
}

/**
 * Resolve a command name (e.g. `claude`, `cursor-agent`) or an explicit
 * path to an absolute executable path, or `undefined` when not found.
 *
 * Pure node module: no `vscode` import, directly testable with plain node.
 */
export function resolveExecutable(target: string, options: LookupOptions = {}): string | undefined {
    const trimmed = target.trim();
    if (!trimmed) {
        return undefined;
    }
    const platform = options.platform ?? process.platform;
    const check = accessChecker(platform);
    const suffixes = suffixCandidates(trimmed, platform);

    // Explicit/relative path: resolve (per-suffix on win32 when extension-less).
    if (trimmed.includes("/") || trimmed.includes("\\") || path.isAbsolute(trimmed)) {
        for (const suffix of suffixes) {
            const candidate = path.resolve(suffix);
            if (check(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }

    // Bare command name: node_modules/.bin, then conventional user dirs, then PATH.
    const dirs = [
        ...(options.rootFolder ? [path.join(options.rootFolder, "node_modules", ".bin")] : []),
        ...(options.nextPathDirs ?? []),
        ...userDirectories(options, platform),
        ...(process.env.PATH ?? "").split(path.delimiter),
    ];
    for (const dir of dirs) {
        if (!dir) {
            continue;
        }
        for (const suffix of suffixes) {
            const candidate = path.join(dir, suffix);
            if (check(candidate)) {
                return candidate;
            }
        }
    }
    // Keep the inherited PATH authoritative before trying other fnm versions.
    for (const dir of fnmDirectories(options, platform)) {
        for (const suffix of suffixes) {
            const candidate = path.join(dir, suffix);
            if (check(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}
