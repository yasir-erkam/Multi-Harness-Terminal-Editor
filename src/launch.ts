import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { fullSettingKey, iconFile, settingKey, type Harness } from "./harnesses";
import { resolveExecutable } from "./resolveExecutable";
import { hasShellIntegrationApi, type AgentStatus } from "./status";
import { workspaceFolder } from "./workspaceContext";
import { extensionStrings } from "./localization";
import { showEditorTerminal } from "./editorTerminal";
import { grokTerminalSessionId, ompTerminalSessionFile, restoreTerminalIdentity, terminalIdentityEnv } from "./terminalIdentity";
import { codexLaunchArgs } from "./codexLaunch";
import { ompSessionOwners } from "./ompSessionOwner";
import { grokOwners } from "./grokSessions";
import { sessionRoots } from "./savedSessions";
import { terminalExitOptions, terminalHasExited } from "./terminalExit";
import { releaseSessionOwners, type SessionOwner } from "./sessionTakeover";

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
    readonly sessionId?: string;
    readonly sessionFile?: string;
    readonly sessionsRoot?: string;
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
    const args: readonly string[] = config.get<string[]>(settingKey(harness, "arguments"), harness.defaultArgs ? [...harness.defaultArgs] : []);
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

function launchEnvironment(harness: Harness, mode: LaunchMode, projectPath: string, resume?: ResumeLaunch): Record<string, string> {
    const env = terminalIdentityEnv(harness, mode, resume?.sessionId, projectPath);
    if (harness.id === "grokBuild" && resume?.sessionsRoot) {
        const root = path.resolve(resume.sessionsRoot);
        const defaultRoot = sessionRoots().find((candidate) => candidate.harnessId === "grokBuild")!.directory;
        if (path.relative(defaultRoot, root) !== "") {
            // GROK_HOME controls authentication and configuration as well as history.
            env.GROK_HOME = path.dirname(root);
        }
    }
    return env;
}

async function openShellMode(
    harness: Harness,
    launch: AgentLaunch,
    executable: string,
    status: AgentStatus | undefined,
    resume?: ResumeLaunch
): Promise<void> {
    // No shellPath override: the user's default profile is the shell that runs
    // the agent, which is what makes shell integration reporting possible.
    const terminal = vscode.window.createTerminal({
        name: resume?.terminalName,
        cwd: launch.cwd,
        location: { viewColumn: vscode.ViewColumn.Active },
        isTransient: false,
        env: launchEnvironment(harness, "shell", launch.cwd, resume),
        iconPath: launch.iconPath,
    });
    status?.track(terminal, harness);
    await showEditorTerminal(terminal);

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

const pendingResumes = new Map<string, Promise<void>>();

/** Start a fresh terminal, or reveal an explicitly resumed conversation. */
export async function openAgentTerminal(
    context: vscode.ExtensionContext,
    harness: Harness,
    status?: AgentStatus,
    resume?: ResumeLaunch
): Promise<void> {
    const resumeKey = resume ? JSON.stringify([harness.id, resume.sessionId ?? resume.sessionFile ?? resume.terminalName]) : undefined;
    if (resumeKey) {
        const pending = pendingResumes.get(resumeKey);
        if (pending) {
            await pending;
            return;
        }
    }
    const launch = launchAgentTerminal(context, harness, status, resume).catch(async () => {
        const strings = extensionStrings(context);
        await vscode.window.showErrorMessage(`${strings["terminal.openFailed"]} (${harness.displayName})`);
    });
    if (resumeKey) pendingResumes.set(resumeKey, launch);
    try {
        await launch;
    } finally {
        if (resumeKey) pendingResumes.delete(resumeKey);
    }
}

async function launchAgentTerminal(
    context: vscode.ExtensionContext,
    harness: Harness,
    status?: AgentStatus,
    resume?: ResumeLaunch
): Promise<void> {
    if (harness.id === "grokBuild" && resume?.sessionsRoot
        && (!path.isAbsolute(resume.sessionsRoot) || path.basename(path.resolve(resume.sessionsRoot)) !== "sessions")) {
        await vscode.window.showErrorMessage(extensionStrings(context)["savedSessions.grokStoreInvalid"]);
        return;
    }
    if (resume) {
        // Restored terminals are new API objects; their launch metadata is durable.
        const terminals = [...vscode.window.terminals];
        const identities = await Promise.all(terminals.map((terminal) => restoreTerminalIdentity(terminal)));
        const exited = await Promise.all(terminals.map((terminal) => terminalHasExited(terminal)));
        const activeFiles = harness.id === "ohMyPi" && resume.sessionsRoot
            ? await Promise.all(terminals.map((terminal) => ompTerminalSessionFile(terminal, resume.sessionsRoot!))) : [];
        const grokIds = harness.id === "grokBuild" && resume.sessionsRoot
            ? await Promise.all(terminals.map((terminal) => grokTerminalSessionId(terminal, resume.sessionsRoot!))) : [];
        const existing = terminals.find((terminal, index) => {
            if (exited[index] || terminal.exitStatus || !vscode.window.terminals.includes(terminal)) {
                return false;
            }
            const identity = identities[index];
            if (grokIds[index] !== undefined) {
                return identity?.harnessId === harness.id && grokIds[index] === resume.sessionId;
            }
            if (activeFiles[index] && resume.sessionFile) {
                return identity?.harnessId === harness.id && path.relative(activeFiles[index]!, resume.sessionFile) === "";
            }
            return resume.sessionId
                ? identity?.harnessId === harness.id && identity.sessionId === resume.sessionId
                : terminal.name === resume.terminalName;
        });
        if (existing) {
            await showEditorTerminal(existing);
            return;
        }
        if ((harness.id === "grokBuild" && resume.sessionsRoot && process.platform === "linux")
            || (harness.id === "ohMyPi" && resume.sessionFile && process.platform === "linux")) {
            const strings = extensionStrings(context);
            const owners = async (): Promise<readonly SessionOwner[]> => {
                if (harness.id === "ohMyPi") return ompSessionOwners(resume.sessionFile!);
                const all = await grokOwners(resume.sessionsRoot!);
                const matching = all.filter((owner) => owner.sessionId === resume.sessionId);
                if (matching.some((owner) => all.some((other) => other.pid === owner.pid && other.sessionId !== resume.sessionId))) {
                    throw new Error("Grok process owns other sessions");
                }
                return [...new Map(matching.map((owner) => [owner.pid, owner])).values()];
            };
            try {
                const expected = await owners();
                if (expected.length) {
                    const confirm = strings["savedSessions.takeoverConfirm"];
                    const picked = await vscode.window.showWarningMessage(
                        strings["savedSessions.takeoverPrompt"].replace("{0}", harness.displayName),
                        { modal: true }, confirm
                    );
                    if (picked !== confirm) return;
                    await releaseSessionOwners(expected, { owners });
                }
            } catch {
                await vscode.window.showErrorMessage(strings["savedSessions.takeoverFailed"]);
                return;
            }
        }
    }

    const launch = resolveAgentLaunch(context, harness, resume?.cwd);
    const configuredArgs = launch.args;
    if (resume) {
        launch.name = resume.terminalName;
        // `dsh` parses launcher flags like `--profile tui` only before inner app flags like `--resume`.
        launch.args = harness.id === "deepseek"
            ? [...(launch.args ?? []), ...resume.args]
            : [...resume.args, ...(launch.args ?? [])];
    }
    const executable = resolveExecutable(launch.executable, { rootFolder: launch.cwd });
    if (!executable) {
        await offerOpenSettings(launch.name, launch.executable, harness);
        return;
    }
    if (harness.id === "codex") {
        // Probe only configured TUI options; resume arguments are extension-owned.
        const args = await codexLaunchArgs(executable, configuredArgs);
        if (args !== configuredArgs) {
            launch.args = ["--no-daemon", ...(launch.args ?? [])];
        }
    }

    // Shell mode needs the 1.93 shell-integration API; without it, falling back
    // to a direct-mode terminal keeps the CLI usable on older VS Code.
    if (launch.launchMode === "shell" && hasShellIntegrationApi()) {
        await openShellMode(harness, launch, executable, status, resume);
        return;
    }

    const terminal = vscode.window.createTerminal({
        name: resume?.terminalName,
        ...terminalExitOptions(context, executable, launch.args, launchEnvironment(harness, "direct", launch.cwd, resume)),
        cwd: launch.cwd,
        location: { viewColumn: vscode.ViewColumn.Active },
        isTransient: false,
        iconPath: launch.iconPath,
    });
    await showEditorTerminal(terminal);
}
