import { execFile } from "node:child_process";
import * as path from "node:path";

// Do not reinterpret custom commands, prompts or remote routing. These options
// configure the local interactive TUI without selecting a different command.
const LOCAL_FLAGS: Record<string, true | undefined> = { "--no-alt-screen": true, "--search": true, "--oss": true, "--approve-for-me": true, "--dangerously-bypass-approvals-and-sandbox": true, "--dangerously-bypass-hook-trust": true, "--worktree": true, "--strict-config": true };
const LOCAL_VALUES: Record<string, true | undefined> = { "-c": true, "--config": true, "--enable": true, "--disable": true, "-m": true, "--model": true, "-p": true, "--profile": true, "-s": true, "--sandbox": true, "-a": true, "--ask-for-approval": true, "-C": true, "--cd": true, "--add-dir": true, "--local-provider": true };

function localInteractiveArgs(args: readonly string[]): boolean {
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (LOCAL_FLAGS[arg] === true) continue;
        const option = arg.split("=", 1)[0];
        if (LOCAL_VALUES[option] !== true) return false;
        if (arg === option && ++index >= args.length) return false;
    }
    return true;
}

async function supportsNoDaemon(executable: string): Promise<boolean> {
    // Windows npm .cmd shims cannot be passed directly to execFile. PowerShell
    // receives the executable as environment data, never as source text.
    const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const command = "& $env:MULTI_HARNESS_CODEX_EXECUTABLE --help; exit $LASTEXITCODE";
    try {
        const help = await new Promise<string>((resolve, reject) => {
            execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
                env: { ...process.env, MULTI_HARNESS_CODEX_EXECUTABLE: executable },
                windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024, encoding: "utf8",
            }, (error, stdout) => error ? reject(error) : resolve(stdout));
        });
        return /^\s+--no-daemon(?:\s|$)/m.test(help);
    } catch {
        return false;
    }
}

/** Keep local Windows TUI rollouts owned by the terminal, not a shared daemon. */
export async function codexLaunchArgs(
    executable: string,
    args: string[] | undefined,
    platform: NodeJS.Platform = process.platform,
    probe: (executable: string) => Promise<boolean> = supportsNoDaemon
): Promise<string[] | undefined> {
    if (platform !== "win32" || !localInteractiveArgs(args ?? []) || !await probe(executable)) return args;
    return ["--no-daemon", ...(args ?? [])];
}
