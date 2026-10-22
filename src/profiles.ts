import * as vscode from "vscode";
import { type Harness } from "./harnesses";
import { resolveAgentLaunch } from "./launch";
import { resolveExecutable } from "./resolveExecutable";
import { terminalIdentityEnv } from "./terminalIdentity";
import { codexLaunchArgs } from "./codexLaunch";

/**
 * Terminal profile provider for one harness: resolves the configured
 * executable/settings; if the executable cannot be found the profile resolves
 * to nothing (undefined) rather than throwing, so the dropdown simply omits it.
 */
export function registerAgentProfile(
    context: vscode.ExtensionContext,
    harness: Harness
): void {
    const provider: vscode.TerminalProfileProvider = {
        async provideTerminalProfile(_token: vscode.CancellationToken): Promise<vscode.TerminalProfile | undefined> {
            const launch = resolveAgentLaunch(context, harness);
            const executable = resolveExecutable(launch.executable, { rootFolder: launch.cwd });
            if (!executable) {
                return undefined;
            }
            return new vscode.TerminalProfile({
                shellPath: executable,
                shellArgs: harness.id === "codex" ? await codexLaunchArgs(executable, launch.args) : launch.args,
                cwd: launch.cwd,
                location: { viewColumn: vscode.ViewColumn.Active },
                isTransient: false,
                env: terminalIdentityEnv(harness, "direct"),
                iconPath: launch.iconPath,
            });
        },
    };
    const disposable = vscode.window.registerTerminalProfileProvider(`multiHarness.${harness.id}`, provider);
    context.subscriptions.push(disposable);
}
