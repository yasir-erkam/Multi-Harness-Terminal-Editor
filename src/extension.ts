import * as vscode from "vscode";
import { HARNESSES } from "./harnesses";
import { openAgentTerminal } from "./launch";
import { registerAgentProfile } from "./profiles";
import { registerAgentStatus } from "./status";
import { registerAgentsView } from "./agentsView";
import { registerSessionsView } from "./sessionsView";
import { registerSessionContext } from "./sessionContext";
import { registerSavedSessionsView } from "./savedSessionsView";
import { extensionStrings } from "./localization";
import { harnessForTerminal, restoreTerminalIdentity } from "./terminalIdentity";
import { registerTerminalTitles } from "./terminalTitles";
import { cleanupTerminalExit } from "./terminalExit";

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
                { placeHolder: extensionStrings(context)["command.openAgentPicker.placeholder"] }
            );
            if (picked) {
                await vscode.commands.executeCommand(picked.harness.commandId);
            }
        })
    );

    registerAgentsView(context, sessionContext);
    const sessions = registerSessionsView(context);
    registerTerminalTitles(context, sessions.refresh);
    registerSavedSessionsView(context, status, sessionContext);

    context.subscriptions.push(
        vscode.commands.registerCommand("multiHarness.openSettings", () =>
            vscode.commands.executeCommand("workbench.action.openSettings", "@ext:yasir-erkam-ozdemir.multi-harness-terminal-editor")
        )
    );

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            void cleanupTerminalExit(terminal);
            const config = vscode.workspace.getConfiguration("multiHarness");
            if (!config.get<boolean>("notifyOnExit", false)) {
                return;
            }
            void restoreTerminalIdentity(terminal).then(() => {
                const displayName = harnessForTerminal(terminal)?.displayName;
                if (displayName && terminal.exitStatus) {
                    const strings = extensionStrings(context);
                    const message = terminal.exitStatus.code === undefined
                        ? strings["terminal.exited"].replace("{displayName}", displayName)
                        : strings["terminal.exitedWithCode"]
                            .replace("{displayName}", displayName)
                            .replace("{code}", String(terminal.exitStatus.code));
                    void vscode.window.showInformationMessage(message);
                }
            });
        })
    );
}

export function deactivate(): void {
    // Terminal persistence and process reconnection are managed by VS Code.
}
