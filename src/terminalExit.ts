import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const EXIT_FILE_ENV = "MULTI_HARNESS_LAUNCHER_EXIT_FILE";
const userNamespace = typeof process.getuid === "function"
    ? String(process.getuid())
    : createHash("sha256").update(os.userInfo().username).digest("hex");
const markerDirectory = path.join(os.tmpdir(), `multi-harness-terminal-editor-${userNamespace}`, "terminal-exits");
const restoredExitFiles = new WeakMap<vscode.Terminal, string>();

function validatedExitFile(file: unknown): string | undefined {
    if (typeof file !== "string" || path.dirname(file) !== markerDirectory
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(path.basename(file))) {
        return undefined;
    }
    return file;
}

async function terminalExitFile(terminal: vscode.Terminal): Promise<string | undefined> {
    const cached = restoredExitFiles.get(terminal);
    if (cached) return cached;
    const options = terminal.creationOptions;
    let file = validatedExitFile(options && "env" in options ? options.env?.[EXIT_FILE_ENV] : undefined);
    if (!file && process.platform === "linux" && !terminal.exitStatus) {
        try {
            const pid = await terminal.processId;
            if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
            const environment = await fs.readFile(`/proc/${pid}/environ`, "utf8");
            const prefix = `${EXIT_FILE_ENV}=`;
            file = validatedExitFile(environment.split("\0").find((entry) => entry.startsWith(prefix))?.slice(prefix.length));
        } catch {
            // Reconnected processes can exit or restrict access during recovery.
        }
    }
    if (file) restoredExitFiles.set(terminal, file);
    return file;
}

/** Retained launcher terminals have no VS Code exit status until their tab closes. */
export async function terminalHasExited(terminal: vscode.Terminal): Promise<boolean> {
    if (terminal.exitStatus) return true;
    const file = await terminalExitFile(terminal);
    if (!file) return false;
    try {
        await fs.access(file);
        return true;
    } catch {
        // Missing or unreadable markers must not interrupt session resume.
        return false;
    }
}

/** Only terminal closure owns cleanup; reload/deactivation must preserve markers. */
export async function cleanupTerminalExit(terminal: vscode.Terminal): Promise<void> {
    const file = await terminalExitFile(terminal);
    if (!file) return;
    try {
        await fs.unlink(file);
    } catch {
        // An unstarted launcher or a previous cleanup may leave no marker.
    }
}

/**
 * Electron is a GUI-subsystem process and is not attached to the pseudo
 * console, so it cannot hand a console stdin handle to an agent CLI. Batch
 * shims still need the Electron launcher because VS Code cannot execute them.
 */
export function usesDirectWindowsTerminal(
    platform: NodeJS.Platform = process.platform,
    electronVersion: string | undefined = process.versions.electron,
    executable = ""
): boolean {
    return platform === "win32" && Boolean(electronVersion) && !/\.(?:cmd|bat)$/i.test(executable);
}

/** Keep a real inherited terminal; the launcher only owns exit retention. */
export function terminalExitOptions(
    context: vscode.ExtensionContext,
    executable: string,
    args: readonly string[] | undefined,
    env: Record<string, string>
): Pick<vscode.TerminalOptions, "shellPath" | "shellArgs" | "env"> {
    if (usesDirectWindowsTerminal(process.platform, process.versions.electron, executable)) {
        if (/\.ps1$/i.test(executable)) {
            return {
                shellPath: "powershell.exe",
                shellArgs: [
                    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                    executable, ...(args ?? []),
                ],
                env,
            };
        }
        return {
            shellPath: executable,
            shellArgs: args ? [...args] : undefined,
            env,
        };
    }
    const configured = vscode.workspace.getConfiguration("multiHarness").get<string>("autoCloseOnExit", "success");
    const mode = configured === "never" || configured === "always" ? configured : "success";
    mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
    const exitFile = path.join(markerDirectory, `${randomUUID()}.json`);
    return {
        shellPath: process.execPath,
        shellArgs: [
            vscode.Uri.joinPath(context.extensionUri, "media", "terminal-launcher.cjs").fsPath,
            mode,
            executable,
            ...(args ?? []),
        ],
        env: {
            ...env,
            ELECTRON_RUN_AS_NODE: "1",
            ...(process.env.ELECTRON_RUN_AS_NODE !== undefined
                ? { MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE: JSON.stringify(process.env.ELECTRON_RUN_AS_NODE) } : {}),
            MULTI_HARNESS_LAUNCHER_LANGUAGE: vscode.env.language.toLowerCase().startsWith("tr") ? "tr" : "en",
            [EXIT_FILE_ENV]: exitFile,
        },
    };
}
