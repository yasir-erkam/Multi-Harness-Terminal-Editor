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
    let lastActivation: { id: string; time: number } | undefined;
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
        vscode.commands.registerCommand("multiHarness.selectSessionAgent", async (id?: string, activate?: boolean) => {
            if (typeof id === "string") {
                const agent = HARNESSES.find((harness) => harness.id === id);
                if (!agent) {
                    lastActivation = undefined;
                    return;
                }
                let open = false;
                if (activate === true) {
                    // Native trees gate their command through workbench.list.openMode.
                    // In doubleClick mode the command already means a double click;
                    // in singleClick mode require two activations of the same row.
                    const doubleClickMode = vscode.workspace.getConfiguration("workbench.list").get<string>("openMode", "singleClick") === "doubleClick";
                    const now = Date.now();
                    open = doubleClickMode || (lastActivation?.id === id && now - lastActivation.time <= 500);
                    lastActivation = open ? undefined : { id, time: now };
                } else {
                    lastActivation = undefined;
                }
                await selectAgent(id);
                if (open) {
                    await vscode.commands.executeCommand(agent.commandId);
                }
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
