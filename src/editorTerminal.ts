import * as vscode from "vscode";

/** Reveal the terminal, optionally joining editor groups for the full area. */
export async function showEditorTerminal(terminal: vscode.Terminal): Promise<void> {
    terminal.show(false);
    const useFullEditorArea = vscode.workspace.getConfiguration("multiHarness").get<boolean>("useFullEditorArea", true);
    if (useFullEditorArea && vscode.window.tabGroups.all.length > 1) {
        await vscode.commands.executeCommand("workbench.action.joinAllGroups");
    }
}
