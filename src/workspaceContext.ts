import * as vscode from "vscode";

let currentFolder: vscode.WorkspaceFolder | undefined;

/** Keep editor launches and saved-session filtering on the same project. */
export function workspaceFolder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    currentFolder = activeFolder
        ?? folders.find((folder) => folder.uri.fsPath === currentFolder?.uri.fsPath)
        ?? folders[0];
    return currentFolder;
}

export function registerWorkspaceContext(context: vscode.ExtensionContext): void {
    currentFolder = undefined;
    workspaceFolder();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => { workspaceFolder(); }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => { workspaceFolder(); })
    );
}
