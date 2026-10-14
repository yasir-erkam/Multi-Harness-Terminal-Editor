import * as vscode from "vscode";
import { harnessForTerminalName, type Harness, iconFile } from "./harnesses";
import { showEditorTerminal } from "./editorTerminal";

export interface AgentSession {
    readonly id: string;
    readonly terminal: vscode.Terminal;
    readonly harness: Harness;
}

export interface AgentSessions {
    readonly onDidChange: vscode.Event<void>;
    getSessions(): AgentSession[];
}

export function sessionLabel(session: AgentSession): string {
    const matching = vscode.window.terminals.filter((terminal) => terminal.name === session.terminal.name);
    return matching.length > 1
        ? `${session.terminal.name} #${matching.indexOf(session.terminal) + 1}`
        : session.terminal.name;
}

/** Lists open terminals using the same harness-name matching as the launcher. */
export function registerSessionsView(context: vscode.ExtensionContext): AgentSessions {
    const changes = new vscode.EventEmitter<void>();
    const sessions = new WeakMap<vscode.Terminal, AgentSession>();
    let nextId = 0;
    function getSessions(): AgentSession[] {
        const open: AgentSession[] = [];
        for (const terminal of vscode.window.terminals) {
            const harness = harnessForTerminalName(terminal.name);
            if (!harness) {
                continue;
            }
            let session = sessions.get(terminal);
            if (!session) {
                session = { id: `session-${nextId++}`, terminal, harness };
                sessions.set(terminal, session);
            }
            open.push(session);
        }
        return open;
    }
    const provider: vscode.TreeDataProvider<AgentSession> = {
        onDidChangeTreeData: changes.event,
        getChildren(element) {
            return element ? [] : getSessions();
        },
        getTreeItem(session) {
            return {
                id: session.id,
                label: sessionLabel(session),
                description: session.terminal === vscode.window.activeTerminal ? "●" : undefined,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(session.harness, "light")),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(session.harness, "dark")),
                },
                command: {
                    command: "multiHarness.focusSession",
                    title: session.terminal.name,
                    arguments: [session.terminal],
                },
            };
        },
    };
    context.subscriptions.push(
        changes,
        vscode.window.registerTreeDataProvider("multiHarness.sessions", provider),
        vscode.commands.registerCommand("multiHarness.focusSession", async (terminal?: vscode.Terminal) => {
            if (terminal && vscode.window.terminals.includes(terminal)) {
                await showEditorTerminal(terminal);
            }
        }),
        vscode.window.onDidOpenTerminal(() => changes.fire()),
        vscode.window.onDidCloseTerminal(() => changes.fire()),
        vscode.window.onDidChangeActiveTerminal(() => changes.fire())
    );
    return { onDidChange: changes.event, getSessions };
}
