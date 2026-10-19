import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES } from "./harnesses";
import { scanSavedSessions, sessionRoots } from "./savedSessions";
import { ompTerminalSessionFile, restoreTerminalIdentity } from "./terminalIdentity";

/** Rename only the active terminal: VS Code's rename command has no target argument. */
export function registerTerminalTitles(context: vscode.ExtensionContext): void {
    let disposed = false;
    let running = false;
    async function update(): Promise<void> {
        if (disposed || running) return;
        const terminal = vscode.window.activeTerminal;
        if (!terminal || terminal.exitStatus) return;
        running = true;
        try {
            const identity = await restoreTerminalIdentity(terminal);
            if (!identity) return;
            const harness = HARNESSES.find((candidate) => candidate.id === identity.harnessId);
            let root = sessionRoots().find((candidate) => candidate.harnessId === identity.harnessId);
            if (!harness || !root) return;
            const config = vscode.workspace.getConfiguration("multiHarness");
            const override = config.get<unknown>(`${root.harnessId}.sessionDirectory`, "");
            if (typeof override === "string" && override.trim()) {
                root = { ...root, directory: override.trim().replace(/^~(?=$|[/\\])/, os.homedir()) };
            }
            const file = identity.harnessId === "ohMyPi"
                ? await ompTerminalSessionFile(terminal, root.directory) : undefined;
            if (!file && !identity.sessionId) return;
            const scan = await scanSavedSessions([root], Number.MAX_SAFE_INTEGER);
            const session = scan.sessions.find((candidate) => file
                ? path.relative(candidate.file, file) === ""
                : candidate.id === identity.sessionId);
            if (!session || !session.title || session.title === session.id) return;
            const title = `${harness.defaultExecutable} - ${session.title}`;
            // Async disk reads must not rename a newly focused or closed terminal.
            if (disposed || vscode.window.activeTerminal !== terminal || terminal.exitStatus
                || !vscode.window.terminals.includes(terminal) || terminal.name === title) return;
            await vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name: title });
        } catch {
            // History may be temporarily unavailable while the agent writes it.
        } finally {
            running = false;
        }
    }
    const timer = setInterval(() => { void update(); }, 3000);
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTerminal(() => { void update(); }),
        { dispose() { disposed = true; clearInterval(timer); } }
    );
    void update();
}
