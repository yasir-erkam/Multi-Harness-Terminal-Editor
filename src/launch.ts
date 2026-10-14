import * as os from "node:os";
import * as vscode from "vscode";
import { fullSettingKey, iconFile, settingKey, type Harness } from "./harnesses";
import { resolveExecutable } from "./resolveExecutable";
import { hasShellIntegrationApi, type AgentStatus } from "./status";
import { workspaceFolder } from "./workspaceContext";

/** How long shell mode waits for shell integration before degrading. */
export const SHELL_INTEGRATION_TIMEOUT_MS = 10_000;

export type LaunchMode = "direct" | "shell";

export interface AgentLaunch {
    name: string;
    executable: string;
    args: string[] | undefined;
    cwd: string;
    launchMode: LaunchMode;
    iconPath: { light: vscode.Uri; dark: vscode.Uri };
}

export interface ResumeLaunch {
    readonly terminalName: string;
    readonly cwd: string;
    readonly args: readonly string[];
}

/**
 * Shared resolution for a harness launch: settings (path + arguments + launch
 * mode), the workspace-aware cwd and the themed icon paths. Used by the open
 * command and the terminal profile provider so both stay on one code path.
 */
export function resolveAgentLaunch(context: vscode.ExtensionContext, harness: Harness, projectDirectory?: string): AgentLaunch {
    const resource = projectDirectory ? vscode.Uri.file(projectDirectory) : workspaceFolder()?.uri;
    const cwd = resource?.fsPath ?? os.homedir();
    const config = vscode.workspace.getConfiguration("multiHarness", resource);
    const configuredPath = config.get<string>(settingKey(harness, "executablePath"), harness.defaultExecutable);
    const args: readonly string[] = config.get<string[]>(settingKey(harness, "arguments"), []);
    const configuredMode = config.get<string>("launchMode", "direct");

    return {
        name: harness.displayName,
        executable: configuredPath,
        args: args.length > 0 ? [...args] : undefined,
        cwd,
        launchMode: configuredMode === "shell" ? "shell" : "direct",
        iconPath: {
            light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
            dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
        },
    };
}

async function offerOpenSettings(displayName: string, configuredPath: string, harness: Harness): Promise<void> {
    const message = `Multi-Harness: could not find an executable for ${displayName} ('${configuredPath}'). Install the CLI or set ${fullSettingKey(harness, "executablePath")}.`;
    const openSettings = "Open Settings";
    const picked = await vscode.window.showErrorMessage(message, openSettings);
    if (picked === openSettings) {
        await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            fullSettingKey(harness, "executablePath")
        );
    }
}

/**
 * Best-effort quoting for the degraded shell-mode fallback, which has to build a
 * single command line because no shell integration means no `executeCommand`.
 * POSIX shells get single quotes with `'` escaped as `'\''`; on win32 the
 * command is wrapped in double quotes with `"` doubled (cmd.exe still expands
 * `%VAR%`, which is one of the documented reasons shell mode is opt-in).
 */
export function quoteForShell(value: string, platform: NodeJS.Platform = process.platform): string {
    if (platform === "win32") {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return `'${value.replace(/'/g, "'\\''")}'`;
}

function fallbackCommandLine(executable: string, args: string[] | undefined): string {
    return [executable, ...(args ?? [])].map((part) => quoteForShell(part)).join(" ");
}

function waitForShellIntegration(
    terminal: vscode.Terminal,
    timeoutMs: number
): Promise<vscode.TerminalShellIntegration | undefined> {
    if (terminal.shellIntegration) {
        return Promise.resolve(terminal.shellIntegration);
    }
    const subscribe = vscode.window.onDidChangeTerminalShellIntegration;
    if (typeof subscribe !== "function") {
        return Promise.resolve(undefined);
    }

    // Hand-rolled deferred on purpose: Promise.withResolvers only exists from
    // Node 22 / V8 12.4 onwards, while VS Code 1.93 — the first release with
    // shell integration — ships Electron 30.4.0 (Node 20.15.1), the very
    // runtime where this code runs. Using the newer helper would throw a
    // TypeError at launch time on exactly the supported versions.
    let resolve!: (integration: vscode.TerminalShellIntegration | undefined) => void;
    const promise = new Promise<vscode.TerminalShellIntegration | undefined>((resolveFn) => {
        resolve = resolveFn;
    });
    let settled = false;
    const finish = (integration: vscode.TerminalShellIntegration | undefined): void => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        subscription.dispose();
        resolve(integration);
    };
    const subscription = subscribe((event) => {
        if (event.terminal === terminal) {
            finish(event.shellIntegration);
        }
    });
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    return promise;
}

async function openShellMode(
    harness: Harness,
    launch: AgentLaunch,
    executable: string,
    status: AgentStatus | undefined
): Promise<void> {
    // No shellPath override: the user's default profile is the shell that runs
    // the agent, which is what makes shell integration reporting possible.
    const terminal = vscode.window.createTerminal({
        name: launch.name,
        cwd: launch.cwd,
        location: { viewColumn: vscode.ViewColumn.Beside },
        isTransient: true,
        iconPath: launch.iconPath,
    });
    status?.track(terminal, harness);
    terminal.show(false);

    const integration = await waitForShellIntegration(terminal, SHELL_INTEGRATION_TIMEOUT_MS);
    if (integration) {
        integration.executeCommand(executable, launch.args ?? []);
        return;
    }

    terminal.sendText(fallbackCommandLine(executable, launch.args));
    void vscode.window.showInformationMessage(
        `Multi-Harness: status tracking is unavailable in this terminal (shell integration did not activate within ${SHELL_INTEGRATION_TIMEOUT_MS / 1000}s). ` +
            `${harness.displayName} was started with a quoted command line instead.`
    );
}

/** Open (or reveal) the harness terminal from the command. */
export async function openAgentTerminal(
    context: vscode.ExtensionContext,
    harness: Harness,
    status?: AgentStatus,
    resume?: ResumeLaunch
): Promise<void> {
    const existing = vscode.window.terminals.find((terminal) => terminal.name === (resume?.terminalName ?? harness.displayName));
    if (existing) {
        existing.show(false);
        return;
    }

    const launch = resolveAgentLaunch(context, harness, resume?.cwd);
    if (resume) {
        launch.name = resume.terminalName;
        launch.args = [...resume.args, ...(launch.args ?? [])];
    }
    const executable = resolveExecutable(launch.executable, { rootFolder: launch.cwd });
    if (!executable) {
        await offerOpenSettings(launch.name, launch.executable, harness);
        return;
    }

    // Shell mode needs the 1.93 shell-integration API; without it, falling back
    // to a direct-mode terminal keeps the CLI usable on older VS Code.
    if (launch.launchMode === "shell" && hasShellIntegrationApi()) {
        await openShellMode(harness, launch, executable, status);
        return;
    }

    const terminal = vscode.window.createTerminal({
        name: launch.name,
        shellPath: executable,
        shellArgs: launch.args,
        cwd: launch.cwd,
        location: { viewColumn: vscode.ViewColumn.Beside },
        isTransient: true,
        iconPath: launch.iconPath,
    });
    terminal.show(false);
}
