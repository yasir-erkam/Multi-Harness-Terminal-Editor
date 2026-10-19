import * as vscode from "vscode";
import { HARNESSES, type Harness } from "./harnesses";
import { extensionStrings } from "./localization";
import { registerWorkspaceContext, workspaceFolder } from "./workspaceContext";
import { harnessForTerminal, restoreTerminalIdentity, terminalIdentity } from "./terminalIdentity";

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
    registerWorkspaceContext(context);
    const changes = new vscode.EventEmitter<void>();
    const strings = extensionStrings(context);
    let lastActivation: { id: string; time: number } | undefined;
    let selectedId = context.workspaceState.get<string>("selectedSessionAgent");
    const restoreInitialSelection = !HARNESSES.some((agent) => agent.id === selectedId);
    let selectionRevision = 0;
    let disposed = false;
    if (restoreInitialSelection) {
        selectedId = vscode.window.activeTerminal ? harnessForTerminal(vscode.window.activeTerminal)?.id : undefined;
    }
    async function selectAgent(id: string): Promise<void> {
        if (selectedId === id || !HARNESSES.some((agent) => agent.id === id)) {
            return;
        }
        selectionRevision++;
        selectedId = id;
        changes.fire();
        await context.workspaceState.update("selectedSessionAgent", id);
    }
    const followTerminal = (terminal: vscode.Terminal | undefined): void => {
        if (!terminal) {
            return;
        }
        const agent = harnessForTerminal(terminal);
        if (agent) {
            void selectAgent(agent.id);
        }
        if (!terminalIdentity(terminal)) {
            const revision = selectionRevision;
            void restoreTerminalIdentity(terminal).then((identity) => {
                if (identity && !disposed && selectionRevision === revision && vscode.window.activeTerminal === terminal) {
                    void selectAgent(identity.harnessId);
                }
            });
        }
    };
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
        { dispose: () => { disposed = true; } },
        vscode.window.onDidChangeActiveTerminal(followTerminal)
    );
    if (restoreInitialSelection) {
        followTerminal(vscode.window.activeTerminal);
    }
    return {
        onDidChange: changes.event,
        getScope: () => ({ agent: HARNESSES.find((agent) => agent.id === selectedId), cwd: workspaceFolder()?.uri.fsPath }),
        selectAgent,
    };
}
