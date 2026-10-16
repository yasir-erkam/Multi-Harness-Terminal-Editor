import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES, iconFile } from "./harnesses";
import { openAgentTerminal } from "./launch";
import { extensionStrings } from "./localization";
import { supportsSessionDeletion, resumeArguments, scanSavedSessions, sessionRoots, type SavedSession, type SessionScan } from "./savedSessions";
import { type AgentStatus } from "./status";
import { type SessionContext, type SessionScope } from "./sessionContext";
import { SessionDeletionError, validateSessionDeletion } from "./deleteSession";
import { restoreTerminalIdentity } from "./terminalIdentity";

export interface SavedSessions {
    readonly onDidChange: vscode.Event<void>;
    getSessions(): Promise<SessionScan>;
    getScope(): SessionScope;
    getMessage(): string | undefined;
    getSelection(): { mode: boolean; busy: boolean; supported: boolean; keys: string[] };
}

interface ScanNotice { readonly notice: true; }

export function registerSavedSessionsView(context: vscode.ExtensionContext, status: AgentStatus, selection: SessionContext): SavedSessions {
    const strings = extensionStrings(context);
    const changes = new vscode.EventEmitter<void>();
    let pending: Promise<SessionScan> | undefined;
    let pendingKey: string | undefined;
    let scanController: AbortController | undefined;
    let selectionMode = false;
    let deleting = false;
    let selectionScope = "";
    let nativeCheckboxes = false;
    const selected = new Set<string>();
    const contextValues = new Map<string, boolean>();
    function setContext(key: string, value: boolean): void {
        if (contextValues.get(key) !== value) {
            contextValues.set(key, value);
            void vscode.commands.executeCommand("setContext", key, value);
        }
    }
    const sessionKey = (session: SavedSession): string => `${session.harnessId}:${session.id}`;
    const scopeKey = (): string => JSON.stringify([selection.getScope().agent?.id, selection.getScope().cwd]);
    function getRoots() {
        const config = vscode.workspace.getConfiguration("multiHarness");
        return sessionRoots().map((root) => {
            const value = config.get<unknown>(`${root.harnessId}.sessionDirectory`, "");
            const override = typeof value === "string" ? value.trim() : "";
            return override ? { ...root, directory: override.replace(/^~(?=$|[/\\])/, os.homedir()) } : root;
        });
    }
    function getMessage(): string | undefined {
        const scope = selection.getScope();
        if (!scope.agent) {
            return strings["sessionScope.noAgent"];
        }
        if (!scope.cwd) {
            return strings["sessionScope.noFolder"];
        }
        if (!sessionRoots().some((root) => root.harnessId === scope.agent!.id)) {
            return strings["sessionScope.unsupported"];
        }
        return undefined;
    }
    async function getSessions(): Promise<SessionScan> {
        const scope = selection.getScope();
        const key = JSON.stringify([scope.agent?.id, scope.cwd]);
        if (key !== pendingKey) {
            scanController?.abort();
            pending = undefined;
            pendingKey = key;
        }
        if (!pending) {
            if (!scope.agent || !scope.cwd) {
                return { sessions: [], unreadable: [] };
            }
            scanController = new AbortController();
            const signal = scanController.signal;
            pending = Promise.resolve().then(() => {
                return scanSavedSessions(getRoots(), 100, { harnessId: scope.agent!.id, cwd: scope.cwd! }, { signal });
            }).catch(() => ({ sessions: [], unreadable: [scope.agent!.id] }));
        }
        const request = pending;
        const result = await request;
        // A refresh or project change must not restore an obsolete scan.
        if (request !== pending || key !== JSON.stringify([selection.getScope().agent?.id, selection.getScope().cwd])) {
            return getSessions();
        }
        if (!result.unreadable.length && !deleting) {
            const present = new Set(result.sessions.map(sessionKey));
            for (const key of selected) if (!present.has(key)) selected.delete(key);
            updateHeader();
        }
        return result;
    }
    function notifySelection(): void {
        updateHeader();
        changes.fire();
    }
    async function toggleSelection(request?: { harnessId?: string; id?: string }): Promise<void> {
        if (deleting || !selectionMode || !request) return;
        const session = (await getSessions()).sessions.find((candidate) => candidate.harnessId === request.harnessId && candidate.id === request.id);
        if (!session || deleting || !selectionMode) return;
        const key = sessionKey(session);
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        notifySelection();
    }
    async function closeSessionTerminals(session: SavedSession): Promise<void> {
        const terminals = [...vscode.window.terminals];
        const identities = await Promise.all(terminals.map((terminal) => restoreTerminalIdentity(terminal)));
        for (const [index, terminal] of terminals.entries()) {
            const identity = identities[index];
            if (identity?.harnessId === session.harnessId && identity.sessionId === session.id
                && vscode.window.terminals.includes(terminal)) {
                terminal.dispose();
            }
        }
    }
    async function deleteSessions(request?: { harnessId?: string; id?: string }): Promise<void> {
        if (deleting || !supportsSessionDeletion(selection.getScope().agent?.id ?? "")) return;
        deleting = true;
        notifySelection();
        const originalScope = scopeKey();
        const failures: string[] = [];
        const failedKeys = new Set<string>();
        try {
            const targets = (await getSessions()).sessions.filter((session) => request
                ? session.harnessId === request.harnessId && session.id === request.id : selected.has(sessionKey(session)));
            if (!targets.length || originalScope !== scopeKey()) return;
            const detail = targets.map((session) => session.title).join("\n");
            const confirm = strings["savedSessions.deleteConfirm"].replace("{count}", String(targets.length));
            const trashAction = strings["savedSessions.moveToTrash"];
            if (await vscode.window.showWarningMessage(confirm, { modal: true, detail: `${detail}\n\n${strings["savedSessions.deleteHelp"]}` }, trashAction) !== trashAction) return;
            const roots = getRoots();
            const trashFailed: SavedSession[] = [];
            const fail = (session: SavedSession, error: unknown): void => {
                failedKeys.add(sessionKey(session));
                const reason = error instanceof SessionDeletionError ? strings[`savedSessions.${error.reason}`]
                    : error instanceof Error ? error.message : String(error);
                failures.push(`${session.title}: ${reason}`);
            };
            for (const session of targets) {
                try {
                    await validateSessionDeletion(session, roots);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") selected.delete(sessionKey(session));
                    else fail(session, error);
                    continue;
                }
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(session.file), { recursive: false, useTrash: true });
                    selected.delete(sessionKey(session));
                    await closeSessionTerminals(session);
                } catch {
                    trashFailed.push(session);
                }
            }
            if (trashFailed.length) {
                const permanent = strings["savedSessions.deletePermanently"];
                const approved = await vscode.window.showWarningMessage(
                    strings["savedSessions.trashUnavailable"].replace("{count}", String(trashFailed.length)),
                    { modal: true, detail: trashFailed.map((session) => session.title).join("\n") }, permanent
                ) === permanent;
                for (const session of trashFailed) {
                    if (!approved) {
                        failedKeys.add(sessionKey(session));
                        continue;
                    }
                    try {
                        await validateSessionDeletion(session, roots);
                        await vscode.workspace.fs.delete(vscode.Uri.file(session.file), { recursive: false, useTrash: false });
                        selected.delete(sessionKey(session));
                        await closeSessionTerminals(session);
                    } catch (error) { fail(session, error); }
                }
            }
            if (originalScope === scopeKey() && failedKeys.size) {
                selectionMode = true;
                for (const key of failedKeys) selected.add(key);
            }
            if (failures.length) {
                await vscode.window.showErrorMessage(`${strings["savedSessions.deleteFailed"]}\n${failures.join("\n")}`);
            }
            refresh();
        } catch (error) {
            await vscode.window.showErrorMessage(`${strings["savedSessions.deleteFailed"]}\n${error instanceof Error ? error.message : String(error)}`);
        } finally {
            deleting = false;
            notifySelection();
        }
    }
    function refresh(): void {
        scanController?.abort();
        pending = undefined;
        updateHeader();
        changes.fire();
    }
    const provider: vscode.TreeDataProvider<SavedSession | ScanNotice> = {
        onDidChangeTreeData: changes.event,
        async getChildren(element) {
            if (element) {
                return [];
            }
            const result = await getSessions();
            return result.unreadable.length ? [...result.sessions, { notice: true }] : result.sessions;
        },
        getTreeItem(session) {
            if ("notice" in session) {
                return { label: strings["savedSessions.unreadable"], tooltip: strings["savedSessions.unreadable.help"], iconPath: new vscode.ThemeIcon("warning") };
            }
            const harness = HARNESSES.find((candidate) => candidate.id === session.harnessId)!;
            const date = new Date(session.modified).toLocaleDateString(vscode.env?.language ?? "en");
            return {
                id: `${session.harnessId}:${session.id}`,
                contextValue: supportsSessionDeletion(session.harnessId) ? "savedSession" : "savedSessionReadOnly",
                checkboxState: nativeCheckboxes && selectionMode ? (selected.has(sessionKey(session)) ? 1 : 0) : undefined,
                label: session.title,
                description: `${harness.displayName} · ${path.basename(session.cwd)} · ${date}`,
                tooltip: `${session.title}\n${harness.displayName}\n${session.cwd}\n${new Date(session.modified).toLocaleString()}\n${session.id}`,
                iconPath: selectionMode && !nativeCheckboxes ? new vscode.ThemeIcon(selected.has(sessionKey(session)) ? "check" : "circle-outline") : {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
                },
                command: deleting ? undefined : {
                    command: selectionMode ? "multiHarness.toggleSessionSelection" : "multiHarness.resumeSession",
                    title: strings["command.resumeSession.title"],
                    arguments: [{ harnessId: session.harnessId, id: session.id }],
                },
            };
        },
    };
    const options = { treeDataProvider: provider, manageCheckboxStateManually: true };
    const view = vscode.window.createTreeView("multiHarness.savedSessions", options) as vscode.TreeView<SavedSession | ScanNotice> & {
        onDidChangeCheckboxState?: vscode.Event<{ items: readonly (readonly [SavedSession | ScanNotice, number])[] }>;
    };
    nativeCheckboxes = typeof view.onDidChangeCheckboxState === "function";
    if (view.onDidChangeCheckboxState) {
        context.subscriptions.push(view.onDidChangeCheckboxState(async (event) => {
            if (!selectionMode || deleting) return;
            const available = new Set((await getSessions()).sessions.map(sessionKey));
            if (!selectionMode || deleting) return;
            for (const [session, value] of event.items) {
                if ("notice" in session || !available.has(sessionKey(session))) continue;
                if (value === 1) selected.add(sessionKey(session));
                else selected.delete(sessionKey(session));
            }
            notifySelection();
        }));
    }
    let previousAgentPresence: boolean | undefined;
    function updateHeader(): void {
        const scope = selection.getScope();
        const key = scopeKey();
        if (selectionScope !== key) {
            selectionScope = key;
            selectionMode = false;
            selected.clear();
        }
        const hasAgent = scope.agent !== undefined;
        if (previousAgentPresence !== hasAgent) {
            previousAgentPresence = hasAgent;
            void vscode.commands.executeCommand("setContext", "multiHarness.hasSelectedSessionAgent", hasAgent);
        }
        view.description = [scope.agent?.displayName, scope.cwd ? path.basename(scope.cwd) : undefined].filter(Boolean).join(" · ");
        view.message = getMessage();
        if (selectionMode) view.message = `${strings["savedSessions.selectedCount"].replace("{count}", String(selected.size))}${deleting ? ` · ${strings["savedSessions.deleting"]}` : ""}`;
        setContext("multiHarness.sessionDeletionSupported", supportsSessionDeletion(scope.agent?.id ?? ""));
        setContext("multiHarness.sessionSelectionMode", selectionMode);
        setContext("multiHarness.hasSelectedSessions", selected.size > 0);
        setContext("multiHarness.deletingSessions", deleting);
    }
    updateHeader();
    context.subscriptions.push(
        changes,
        { dispose: () => scanController?.abort() },
        view,
        selection.onDidChange(refresh),
        vscode.commands.registerCommand("multiHarness.refreshSessions", refresh),
        vscode.commands.registerCommand("multiHarness.toggleSessionSelectionMode", () => {
            if (deleting || !supportsSessionDeletion(selection.getScope().agent?.id ?? "")) return;
            selectionMode = !selectionMode;
            selected.clear();
            notifySelection();
        }),
        vscode.commands.registerCommand("multiHarness.cancelSessionSelection", () => {
            if (deleting) return;
            selectionMode = false;
            selected.clear();
            notifySelection();
        }),
        vscode.commands.registerCommand("multiHarness.toggleSessionSelection", toggleSelection),
        vscode.commands.registerCommand("multiHarness.selectAllSessions", async (keys?: unknown) => {
            if (deleting || !selectionMode) return;
            const sessions = (await getSessions()).sessions;
            if (deleting || !selectionMode) return;
            const requested = Array.isArray(keys) ? new Set(keys.filter((key): key is string => typeof key === "string")) : undefined;
            for (const session of sessions) if (!requested || requested.has(sessionKey(session))) selected.add(sessionKey(session));
            notifySelection();
        }),
        vscode.commands.registerCommand("multiHarness.deleteSession", deleteSessions),
        vscode.commands.registerCommand("multiHarness.deleteSelectedSessions", () => deleteSessions()),
        vscode.commands.registerCommand("multiHarness.resumeSession", async (request?: { harnessId?: string; id?: string }) => {
            if (!request || typeof request.harnessId !== "string" || typeof request.id !== "string") {
                return;
            }
            const session = (await getSessions()).sessions.find((candidate) => candidate.harnessId === request.harnessId && candidate.id === request.id);
            const harness = HARNESSES.find((candidate) => candidate.id === session?.harnessId);
            if (!session || !harness) {
                return;
            }
            try {
                if (!(await fs.stat(session.file)).isFile() || !(await fs.stat(session.cwd)).isDirectory()) {
                    throw new Error("missing");
                }
            } catch {
                void vscode.window.showErrorMessage(`${strings["savedSessions.missing"]}\n${session.cwd}`);
                refresh();
                return;
            }
            await openAgentTerminal(context, harness, status, {
                sessionId: session.id,
                terminalName: `${harness.displayName} — ${session.title}`,
                cwd: session.cwd,
                args: resumeArguments(session),
            });
        }),
        vscode.window.onDidCloseTerminal(refresh),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("multiHarness")) {
                refresh();
            }
        })
    );
    return { onDidChange: changes.event, getSessions, getScope: selection.getScope, getMessage,
        getSelection: () => ({ mode: selectionMode, busy: deleting, supported: supportsSessionDeletion(selection.getScope().agent?.id ?? ""), keys: [...selected] }) };
}
