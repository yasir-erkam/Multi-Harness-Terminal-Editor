import * as vscode from "vscode";
import { HARNESSES, harnessForTerminalName } from "./harnesses";
import { openAgentTerminal } from "./launch";
import { registerAgentProfile } from "./profiles";
import { registerAgentStatus } from "./status";
import { registerAgentsView } from "./agentsView";
import { registerSessionsView } from "./sessionsView";
import { registerSavedSessionsView } from "./savedSessionsView";
import { registerSessionContext } from "./sessionContext";

export function activate(context: vscode.ExtensionContext): void {
    const status = registerAgentStatus(context);
    const sessionContext = registerSessionContext(context);
    for (const harness of HARNESSES) {
        context.subscriptions.push(
            vscode.commands.registerCommand(harness.commandId, async () => {
                await sessionContext.selectAgent(harness.id);
                await openAgentTerminal(context, harness, status);
            })
        );
        registerAgentProfile(context, harness);
    }
    context.subscriptions.push(
        vscode.commands.registerCommand("multiHarness.openAgentPicker", async () => {
            const picked = await vscode.window.showQuickPick(
                HARNESSES.map((harness) => ({ label: harness.displayName, harness })),
                { placeHolder: "Select agent to open in a terminal tab" }
            );
            if (picked) {
                await vscode.commands.executeCommand(picked.harness.commandId);
            }
        })
    );

    registerAgentsView(context, sessionContext);
    registerSessionsView(context);
    registerSavedSessionsView(context, status, sessionContext);

    context.subscriptions.push(
        vscode.commands.registerCommand("multiHarness.openSettings", () =>
            vscode.commands.executeCommand("workbench.action.openSettings", "@ext:yasir-erkam-ozdemir.multi-harness-terminal-editor")
        )
    );

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            const config = vscode.workspace.getConfiguration("multiHarness");
            if (!config.get<boolean>("notifyOnExit", false)) {
                return;
            }
            const displayName = harnessForTerminalName(terminal.name)?.displayName;
            if (!displayName || !terminal.exitStatus) {
                return;
            }
            void vscode.window.showInformationMessage(`${displayName} terminal exited with code ${terminal.exitStatus.code}`);
        })
    );
}

export function deactivate(): void {
    // Nothing to clean up; transient terminals die with the window.
}
