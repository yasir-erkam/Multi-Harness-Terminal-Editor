import * as vscode from "vscode";
import { type Harness } from "./harnesses";
import { resolveAgentLaunch, workspaceFolder } from "./launch";
import { resolveExecutable } from "./resolveExecutable";

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
        provideTerminalProfile(_token: vscode.CancellationToken): vscode.ProviderResult<vscode.TerminalProfile> {
            const launch = resolveAgentLaunch(context, harness);
            const executable = resolveExecutable(launch.executable, { rootFolder: workspaceFolder()?.uri.fsPath });
            if (!executable) {
                return undefined;
            }
            return new vscode.TerminalProfile({
                name: launch.name,
                shellPath: executable,
                shellArgs: launch.args,
                cwd: launch.cwd,
                location: { viewColumn: vscode.ViewColumn.Beside },
                isTransient: true,
                iconPath: launch.iconPath,
            });
        },
    };
    const disposable = vscode.window.registerTerminalProfileProvider(`multiHarness.${harness.id}`, provider);
    context.subscriptions.push(disposable);
}
