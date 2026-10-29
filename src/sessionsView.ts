import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES, type Harness, iconFile } from "./harnesses";
import { showEditorTerminal } from "./editorTerminal";
import { extensionStrings } from "./localization";
import { harnessForTerminal, restoreTerminalIdentity, terminalIdentity } from "./terminalIdentity";

interface AgentSession {
    readonly id: string;
    readonly terminal: vscode.Terminal;
    readonly harness: Harness;
}

interface AgentSessions {
    refresh(): void;
}

function sessionLabel(session: AgentSession): string {
    const matching = vscode.window.terminals.filter((terminal) => terminal.name === session.terminal.name);
    return matching.length > 1
        ? `${session.terminal.name} #${matching.indexOf(session.terminal) + 1}`
        : session.terminal.name;
}

/** Lists open harness terminals independently of their editable titles. */
export function registerSessionsView(context: vscode.ExtensionContext): AgentSessions {
    const strings = extensionStrings(context);
    const changes = new vscode.EventEmitter<void>();
    const sessions = new WeakMap<vscode.Terminal, AgentSession>();
    const closed = new WeakSet<vscode.Terminal>();
    const selected = new Set<AgentSession>();
    let nextId = 0;
    let disposed = false;
    let selectionMode = false;
    let busy = false;
    let agentId: string | undefined;
    let projectPath: string | undefined;
    let revision = 0;
    let nativeCheckboxes = false;
    const project = (session: AgentSession): string => terminalIdentity(session.terminal)?.projectPath ?? "";
    const projectKey = (value: string): string => process.platform === "win32" ? path.normalize(value).toLowerCase() : path.normalize(value);
    const sameProject = (a: string, b: string): boolean => a === b || (!!a && !!b && projectKey(a) === projectKey(b));
    function getSessions(): AgentSession[] {
        const open: AgentSession[] = [];
        for (const terminal of vscode.window.terminals) {
            if (closed.has(terminal) || terminal.exitStatus) continue;
            const harness = harnessForTerminal(terminal);
            if (!harness) continue;
            let session = sessions.get(terminal);
            if (!session || session.harness.id !== harness.id) {
                session = { id: session?.id ?? `session-${nextId++}`, terminal, harness };
                sessions.set(terminal, session);
            }
            open.push(session);
        }
        return open;
    }
    function visible(): AgentSession[] {
        return getSessions().filter((session) => (!agentId || session.harness.id === agentId)
            && (projectPath === undefined || sameProject(project(session), projectPath)));
    }
    function refresh(): void {
        if (disposed) return;
        const available = new Set(visible());
        for (const session of selected) if (!available.has(session)) selected.delete(session);
        view.description = [HARNESSES.find((harness) => harness.id === agentId)?.displayName,
            projectPath === undefined ? undefined : projectPath || strings["terminals.unknownProject"]].filter(Boolean).join(" · ");
        view.message = selectionMode ? strings["terminals.selectedCount"].replace("{count}", String(selected.size)) : undefined;
        if (busy) view.message = strings["terminals.closing"];
        for (const [key, value] of Object.entries({ terminalSelectionMode: selectionMode, hasSelectedTerminals: selected.size > 0, closingTerminals: busy })) {
            void vscode.commands.executeCommand("setContext", `multiHarness.${key}`, value);
        }
        changes.fire();
    }
    const restore = (terminal: vscode.Terminal): void => {
        closed.delete(terminal);
        refresh();
        if (!terminalIdentity(terminal)) {
            void restoreTerminalIdentity(terminal).then((identity) => {
                if (identity && !disposed && vscode.window.terminals.includes(terminal)) refresh();
            });
        }
    };
    const provider: vscode.TreeDataProvider<AgentSession> = {
        onDidChangeTreeData: changes.event,
        getChildren: (element) => element ? [] : visible(),
        getTreeItem(session) {
            return {
                id: session.id,
                contextValue: "openTerminal",
                label: sessionLabel(session),
                description: session.terminal === vscode.window.activeTerminal ? "●" : undefined,
                tooltip: `${session.terminal.name}\n${session.harness.displayName}\n${project(session) || strings["terminals.unknownProject"]}`,
                checkboxState: nativeCheckboxes && selectionMode ? (selected.has(session) ? 1 : 0) : undefined,
                iconPath: selectionMode && !nativeCheckboxes ? new vscode.ThemeIcon(selected.has(session) ? "check" : "circle-outline") : {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(session.harness, "light")),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(session.harness, "dark")),
                },
                command: busy ? undefined : {
                    command: selectionMode ? "multiHarness.toggleTerminalSelection" : "multiHarness.focusSession",
                    title: session.terminal.name,
                    arguments: selectionMode ? [session] : [session.terminal],
                },
            };
        },
    };
    const options = { treeDataProvider: provider, manageCheckboxStateManually: true };
    const view = vscode.window.createTreeView("multiHarness.sessions", options) as vscode.TreeView<AgentSession> & {
        onDidChangeCheckboxState?: vscode.Event<{ items: readonly (readonly [AgentSession, number])[] }>;
    };
    nativeCheckboxes = typeof view.onDidChangeCheckboxState === "function";
    if (view.onDidChangeCheckboxState) context.subscriptions.push(view.onDidChangeCheckboxState((event) => {
        if (!selectionMode || busy) return;
        const available = new Set(visible());
        for (const [session, value] of event.items) {
            if (!available.has(session)) continue;
            if (value === 1) selected.add(session);
            else selected.delete(session);
        }
        refresh();
    }));
    async function closeMany(targets: AgentSession[], keeper?: AgentSession): Promise<void> {
        if (busy || !targets.length || disposed) return;
        busy = true;
        const scope = revision;
        const snapshot = targets.map((session) => ({ session, project: project(session), harnessId: session.harness.id }));
        refresh();
        try {
            const action = strings["terminals.confirmClose"];
            const answer = await vscode.window.showWarningMessage(
                strings["terminals.closeWarning"].replace("{count}", String(snapshot.length)),
                { modal: true, detail: snapshot.map(({ session }) => sessionLabel(session)).join("\n") }, action);
            if (answer !== action || disposed || scope !== revision) return;
            const failures: string[] = [];
            for (const target of snapshot) {
                const available = visible();
                if (keeper && !available.includes(keeper)) break;
                if (!available.includes(target.session) || target.session.harness.id !== target.harnessId
                    || !sameProject(project(target.session), target.project)) continue;
                try {
                    target.session.terminal.dispose();
                    closed.add(target.session.terminal);
                    selected.delete(target.session);
                } catch (error) {
                    selectionMode = true;
                    selected.add(target.session);
                    failures.push(`${sessionLabel(target.session)}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (failures.length) await vscode.window.showErrorMessage(`${strings["terminals.closeFailed"]}\n${failures.join("\n")}`);
        } finally {
            busy = false;
            refresh();
        }
    }
    async function filterAgent(): Promise<void> {
        if (busy) return;
        const scope = revision;
        const choices = [{ label: strings["terminals.allAgents"], agentId: undefined as string | undefined },
            ...HARNESSES.map((harness) => ({ label: harness.displayName, agentId: harness.id }))];
        const choice = await vscode.window.showQuickPick(choices, { placeHolder: strings["command.filterTerminalAgent.title"] });
        if (!choice || !choices.includes(choice) || busy || disposed || scope !== revision) return;
        agentId = choice.agentId;
        revision++;
        selectionMode = false;
        selected.clear();
        refresh();
    }
    async function filterProject(): Promise<void> {
        if (busy) return;
        const scope = revision;
        const projects = new Map<string, string>();
        for (const session of getSessions()) {
            const value = project(session);
            if (value) projects.set(projectKey(value), value);
        }
        const choices = [{ label: strings["terminals.allProjects"], projectPath: undefined as string | undefined },
            { label: strings["terminals.unknownProject"], projectPath: "" },
            ...[...projects.values()].sort().map((value) => ({ label: value, projectPath: value }))];
        const choice = await vscode.window.showQuickPick(choices, { placeHolder: strings["command.filterTerminalProject.title"] });
        if (!choice || !choices.includes(choice) || busy || disposed || scope !== revision) return;
        projectPath = choice.projectPath;
        revision++;
        selectionMode = false;
        selected.clear();
        refresh();
    }
    context.subscriptions.push(changes, view,
        vscode.commands.registerCommand("multiHarness.focusSession", async (terminal?: vscode.Terminal) => {
            if (!busy && terminal && getSessions().some((session) => session.terminal === terminal)) await showEditorTerminal(terminal);
        }),
        vscode.commands.registerCommand("multiHarness.closeSession", (session?: AgentSession) => {
            if (!busy && session && visible().includes(session)) session.terminal.dispose();
        }),
        vscode.commands.registerCommand("multiHarness.toggleTerminalSelectionMode", () => {
            if (busy) return;
            selectionMode = !selectionMode;
            selected.clear();
            refresh();
        }),
        vscode.commands.registerCommand("multiHarness.cancelTerminalSelection", () => {
            if (busy) return;
            selectionMode = false;
            selected.clear();
            refresh();
        }),
        vscode.commands.registerCommand("multiHarness.toggleTerminalSelection", (session?: AgentSession) => {
            if (busy || !selectionMode || !session || !visible().includes(session)) return;
            if (selected.has(session)) selected.delete(session);
            else selected.add(session);
            refresh();
        }),
        vscode.commands.registerCommand("multiHarness.selectAllTerminals", () => {
            if (busy || !selectionMode) return;
            for (const session of visible()) selected.add(session);
            refresh();
        }),
        vscode.commands.registerCommand("multiHarness.closeSelectedTerminals", () => closeMany(selectionMode ? visible().filter((session) => selected.has(session)) : [])),
        vscode.commands.registerCommand("multiHarness.closeOtherTerminals", (session?: AgentSession) => {
            const available = visible();
            return session && available.includes(session) ? closeMany(available.filter((other) => other !== session), session) : undefined;
        }),
        vscode.commands.registerCommand("multiHarness.filterTerminalAgent", filterAgent),
        vscode.commands.registerCommand("multiHarness.filterTerminalProject", filterProject),
        { dispose: () => { disposed = true; revision++; selected.clear(); } },
        vscode.window.onDidOpenTerminal(restore),
        vscode.window.onDidCloseTerminal((terminal) => {
            closed.add(terminal);
            refresh();
        }),
        vscode.window.onDidChangeActiveTerminal(refresh)
    );
    vscode.window.terminals.forEach(restore);
    refresh();
    return { refresh };
}
