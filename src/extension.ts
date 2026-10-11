import * as vscode from "vscode";
import { HARNESSES } from "./harnesses";
import { registerOpenCommand } from "./open";

export function activate(context: vscode.ExtensionContext): void {
    for (const harness of HARNESSES) {
        registerOpenCommand(context, harness);
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

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            const config = vscode.workspace.getConfiguration("multiHarness");
            if (!config.get<boolean>("notifyOnExit", false)) {
                return;
            }
            const displayName = HARNESSES.find((harness) => harness.displayName === terminal.name)?.displayName;
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
