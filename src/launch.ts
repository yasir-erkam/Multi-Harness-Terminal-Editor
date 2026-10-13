import * as os from "node:os";
import * as vscode from "vscode";
import { iconFile, settingKey, type Harness } from "./harnesses";
import { resolveExecutable } from "./resolveExecutable";

export interface AgentLaunch {
    name: string;
    executable: string;
    args: string[] | undefined;
    cwd: string;
    iconPath: { light: vscode.Uri; dark: vscode.Uri };
}

/** Workspace folder backing the next agent launch (active editor first). */
export function workspaceFolder(): vscode.WorkspaceFolder | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    return activeUri
        ? vscode.workspace.getWorkspaceFolder(activeUri) ?? vscode.workspace.workspaceFolders?.[0]
        : vscode.workspace.workspaceFolders?.[0];
}

/**
 * Shared resolution for a harness launch: settings (path + arguments), the
 * workspace-aware cwd and the themed icon paths. Used by the open command and
 * the terminal profile provider so both stay on one code path.
 */
export function resolveAgentLaunch(context: vscode.ExtensionContext, harness: Harness): AgentLaunch {
    const folder = workspaceFolder();
    const cwd = folder?.uri.fsPath ?? os.homedir();
    const config = vscode.workspace.getConfiguration("multiHarness", folder?.uri);
    const configuredPath = config.get<string>(settingKey(harness, "executablePath"), harness.defaultExecutable);
    const args: readonly string[] = config.get<string[]>(settingKey(harness, "arguments"), []);

    return {
        name: harness.displayName,
        executable: configuredPath,
        args: args.length > 0 ? [...args] : undefined,
        cwd,
        iconPath: {
            light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
            dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
        },
    };
}

async function offerOpenSettings(displayName: string, configuredPath: string, harness: Harness): Promise<void> {
    const message = `Multi-Harness: could not find an executable for ${displayName} ('${configuredPath}'). Install the CLI or set its executable path.`;
    const openSettings = "Open Settings";
    const picked = await vscode.window.showErrorMessage(message, openSettings);
    if (picked === openSettings) {
        await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            settingKey(harness, "executablePath")
        );
    }
}

/** Open (or reveal) the harness terminal from the command. */
export async function openAgentTerminal(context: vscode.ExtensionContext, harness: Harness): Promise<void> {
    const existing = vscode.window.terminals.find((terminal) => terminal.name === harness.displayName);
    if (existing) {
        existing.show(false);
        return;
    }

    const launch = resolveAgentLaunch(context, harness);
    const executable = resolveExecutable(launch.executable, { rootFolder: workspaceFolder()?.uri.fsPath });
    if (!executable) {
        await offerOpenSettings(launch.name, launch.executable, harness);
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
