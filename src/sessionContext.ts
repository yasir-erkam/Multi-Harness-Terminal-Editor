import * as vscode from "vscode";
import { HARNESSES, harnessForTerminalName, type Harness } from "./harnesses";
import { extensionStrings } from "./localization";

export interface SessionScope {
    readonly agent: Harness | undefined;
    readonly cwd: string | undefined;
}

export interface SessionContext {
    readonly onDidChange: vscode.Event<void>;
    getScope(): SessionScope;
    selectAgent(id: string): Promise<void>;
}

/** Selected agent is local to this workspace; the folder follows editor focus. */
export function registerSessionContext(context: vscode.ExtensionContext): SessionContext {
    const changes = new vscode.EventEmitter<void>();
    const strings = extensionStrings(context);
    let currentCwd: string | undefined;
    function getCwd(): string | undefined {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
        if (activeFolder) {
            currentCwd = activeFolder.uri.fsPath;
        } else if (!folders.some((folder) => folder.uri.fsPath === currentCwd)) {
            currentCwd = folders[0]?.uri.fsPath;
        }
        return currentCwd;
    }
    let selectedId = context.workspaceState.get<string>("selectedSessionAgent");
    if (!HARNESSES.some((agent) => agent.id === selectedId)) {
        selectedId = vscode.window.activeTerminal ? harnessForTerminalName(vscode.window.activeTerminal.name)?.id : undefined;
    }
    async function selectAgent(id: string): Promise<void> {
        if (selectedId === id || !HARNESSES.some((agent) => agent.id === id)) {
            return;
        }
        selectedId = id;
        changes.fire();
        await context.workspaceState.update("selectedSessionAgent", id);
    }
    context.subscriptions.push(
        changes,
        vscode.commands.registerCommand("multiHarness.selectSessionAgent", async (id?: string) => {
            if (typeof id === "string") {
                await selectAgent(id);
                return;
            }
            const picked = await vscode.window.showQuickPick(
                HARNESSES.map((agent) => ({ label: agent.displayName, agent })),
                { placeHolder: strings["sessionScope.selectAgent"] }
            );
            if (picked) {
                await selectAgent(picked.agent.id);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(() => changes.fire()),
        vscode.workspace.onDidChangeWorkspaceFolders(() => changes.fire()),
        vscode.window.onDidChangeActiveTerminal((terminal) => {
            const agent = terminal ? harnessForTerminalName(terminal.name) : undefined;
            if (agent) {
                void selectAgent(agent.id);
            }
        })
    );
    return {
        onDidChange: changes.event,
        getScope: () => ({ agent: HARNESSES.find((agent) => agent.id === selectedId), cwd: getCwd() }),
        selectAgent,
    };
}
