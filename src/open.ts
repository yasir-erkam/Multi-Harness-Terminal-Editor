import * as os from "node:os";
import * as vscode from "vscode";
import { iconFile, settingKey, type Harness } from "./harnesses";
import { resolveExecutable } from "./resolveExecutable";

export function registerOpenCommand(context: vscode.ExtensionContext, harness: Harness): void {
    const disposable = vscode.commands.registerCommand(harness.commandId, async () => {
        await openHarness(context, harness);
    });
    context.subscriptions.push(disposable);
}

async function openHarness(context: vscode.ExtensionContext, harness: Harness): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const folder = activeUri
        ? vscode.workspace.getWorkspaceFolder(activeUri) ?? vscode.workspace.workspaceFolders?.[0]
        : vscode.workspace.workspaceFolders?.[0];
    const cwd = folder?.uri.fsPath ?? os.homedir();
    const config = vscode.workspace.getConfiguration("multiHarness", folder?.uri);
    const configuredPath = config.get<string>(settingKey(harness, "executablePath"), harness.defaultExecutable);
    const args: readonly string[] = config.get<string[]>(settingKey(harness, "arguments"), []);

    const existing = vscode.window.terminals.find((terminal) => terminal.name === harness.displayName);
    if (existing) {
        existing.show(false);
        return;
    }

    const executable = resolveExecutable(configuredPath, { rootFolder: folder?.uri.fsPath });
    if (!executable) {
        const message = `Multi-Harness: could not find an executable for ${harness.displayName} ('${configuredPath}'). Install the CLI or set its executable path.`;
        const openSettings = "Open Settings";
        const picked = await vscode.window.showErrorMessage(message, openSettings);
        if (picked === openSettings) {
            await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                settingKey(harness, "executablePath")
            );
        }
        return;
    }

    const terminal = vscode.window.createTerminal({
        name: harness.displayName,
        shellPath: executable,
        shellArgs: args.length > 0 ? [...args] : undefined,
        cwd,
        location: { viewColumn: vscode.ViewColumn.Beside },
        isTransient: true,
        iconPath: {
            light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
            dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
        },
    });
    terminal.show(false);
}
