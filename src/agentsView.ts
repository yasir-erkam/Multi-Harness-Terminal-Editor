import * as vscode from "vscode";
import { HARNESSES, type Harness, iconFile } from "./harnesses";

/** Activity Bar launcher reuses the same commands as the editor buttons. */
export function registerAgentsView(context: vscode.ExtensionContext): void {
    const provider: vscode.TreeDataProvider<Harness> = {
        getChildren(element) {
            return element ? [] : [...HARNESSES];
        },
        getTreeItem(harness) {
            return {
                id: harness.id,
                label: harness.displayName,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
                },
                command: {
                    command: harness.commandId,
                    title: harness.displayName,
                },
            };
        },
    };
    context.subscriptions.push(vscode.window.registerTreeDataProvider("multiHarness.agents", provider));
}
