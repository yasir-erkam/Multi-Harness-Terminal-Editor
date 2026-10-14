import * as vscode from "vscode";

/** Reveal the terminal and keep all open tabs in a single editor group. */
export async function showEditorTerminal(terminal: vscode.Terminal): Promise<void> {
    terminal.show(false);
    if (vscode.window.tabGroups.all.length > 1) {
        await vscode.commands.executeCommand("workbench.action.joinAllGroups");
    }
}
