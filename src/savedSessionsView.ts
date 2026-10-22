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
import { SessionDeletionError, sessionDeletionFiles } from "./deleteSession";
import { codexTerminalSessionFiles, ompTerminalSessionFile, restoreTerminalIdentity, windowsCodexSessionMatches } from "./terminalIdentity";

export interface SavedSessions {
    readonly onDidChange: vscode.Event<void>;
    getSessions(): Promise<SessionScan>;
    getScope(): SessionScope;
    getMessage(): string | undefined;
    getAllLocations(): boolean;
    getSelection(): { mode: boolean; busy: boolean; supported: boolean; keys: string[] };
}

interface ScanNotice { readonly notice: true; }
interface SessionDay { readonly day: string; readonly modified: number; readonly sessions: SavedSession[]; }
type SavedSessionItem = SavedSession | SessionDay | ScanNotice;

export function registerSavedSessionsView(context: vscode.ExtensionContext, status: AgentStatus, selection: SessionContext): SavedSessions {
    const strings = extensionStrings(context);
    const changes = new vscode.EventEmitter<void>();
    let pending: Promise<SessionScan> | undefined;
    let pendingKey: string | undefined;
    let scanController: AbortController | undefined;
    let selectionMode = false;
    let allLocations = context.workspaceState.get<boolean>("allSessionLocations", false);
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
    const scopeKey = (): string => JSON.stringify([selection.getScope().agent?.id, allLocations ? undefined : selection.getScope().cwd, allLocations]);
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
        if (!allLocations && !scope.cwd) {
            return strings["sessionScope.noFolder"];
        }
        if (!sessionRoots().some((root) => root.harnessId === scope.agent!.id)) {
            return strings["sessionScope.unsupported"];
        }
        return undefined;
    }
    async function getSessions(): Promise<SessionScan> {
        const scope = selection.getScope();
        const key = scopeKey();
        if (key !== pendingKey) {
            scanController?.abort();
            pending = undefined;
            pendingKey = key;
        }
        if (!pending) {
            if (!scope.agent || (!allLocations && !scope.cwd)) {
                return { sessions: [], unreadable: [] };
            }
            scanController = new AbortController();
            const signal = scanController.signal;
            pending = Promise.resolve().then(() => {
                const roots = getRoots().filter((root) => root.harnessId === scope.agent!.id);
                return scanSavedSessions(roots, 100, allLocations ? undefined : { harnessId: scope.agent!.id, cwd: scope.cwd! }, { signal });
            }).catch(() => ({ sessions: [], unreadable: [scope.agent!.id] }));
        }
        const request = pending;
        const result = await request;
        // A refresh or project change must not restore an obsolete scan.
        if (request !== pending || key !== scopeKey()) {
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
    async function sessionTerminals(session: SavedSession): Promise<vscode.Terminal[]> {
        const terminals = [...vscode.window.terminals];
        const identities = await Promise.all(terminals.map((terminal) => restoreTerminalIdentity(terminal)));
        const root = session.harnessId === "ohMyPi" ? getRoots().find((candidate) => candidate.harnessId === "ohMyPi") : undefined;
        const activeFiles = root ? await Promise.all(terminals.map((terminal) => ompTerminalSessionFile(terminal, root.directory))) : [];
        const codexRoot = session.harnessId === "codex" ? getRoots().find((candidate) => candidate.harnessId === "codex") : undefined;
        const codexFiles = codexRoot ? await Promise.all(terminals.map((terminal) => codexTerminalSessionFiles(terminal, codexRoot.directory))) : [];
        const sessionFile = codexRoot ? await fs.realpath(session.file) : session.file;
        const windowsMatches = codexRoot ? await windowsCodexSessionMatches(terminals, sessionFile) : new Map<vscode.Terminal, boolean>();
        return terminals.filter((_terminal, index) => {
            const identity = identities[index];
            const activeFile = activeFiles[index];
            const files = codexFiles[index];
            const matches = windowsMatches.get(_terminal) ?? (files?.length
                ? files.some((file) => path.relative(file, sessionFile) === "")
                : activeFile ? path.relative(activeFile, session.file) === "" : identity?.sessionId === session.id);
            return identity?.harnessId === session.harnessId && matches;
        });
    }
    function closeSessionTerminals(terminals: vscode.Terminal[]): void {
        const errors: unknown[] = [];
        for (const terminal of terminals) {
            if (vscode.window.terminals.includes(terminal)) {
                try { terminal.dispose(); } catch (error) { errors.push(error); }
            }
        }
        if (errors.length) throw errors[0];
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
            const finishDeletion = (session: SavedSession, terminals: vscode.Terminal[]): void => {
                selected.delete(sessionKey(session));
                try {
                    closeSessionTerminals(terminals);
                } catch (error) {
                    failures.push(`${session.title}: ${strings["savedSessions.closeFailed"]} (${error instanceof Error ? error.message : String(error)})`);
                }
            };
            for (const session of targets) {
                let files: SavedSession[];
                let terminals: vscode.Terminal[];
                try {
                    await sessionDeletionFiles(session, roots);
                    terminals = await sessionTerminals(session);
                    // Live-process discovery can take time; revalidate before deleting.
                    files = await sessionDeletionFiles(session, roots);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") selected.delete(sessionKey(session));
                    else fail(session, error);
                    continue;
                }
                try {
                    for (const file of files) {
                        await vscode.workspace.fs.delete(vscode.Uri.file(file.file), { recursive: false, useTrash: true });
                    }
                } catch {
                    trashFailed.push(session);
                    continue;
                }
                finishDeletion(session, terminals);
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
                        await sessionDeletionFiles(session, roots);
                        const terminals = await sessionTerminals(session);
                        const files = await sessionDeletionFiles(session, roots);
                        for (const file of files) {
                            await vscode.workspace.fs.delete(vscode.Uri.file(file.file), { recursive: false, useTrash: false });
                        }
                        finishDeletion(session, terminals);
                    } catch (error) { fail(session, error); }
                }
            }
            if (originalScope === scopeKey() && failedKeys.size) {
                selectionMode = true;
                for (const key of failedKeys) selected.add(key);
            }
            refresh();
            if (failures.length) {
                await vscode.window.showErrorMessage(`${strings["savedSessions.deleteFailed"]}\n${failures.join("\n")}`);
            }
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
    const provider: vscode.TreeDataProvider<SavedSessionItem> = {
        onDidChangeTreeData: changes.event,
        async getChildren(element) {
            if (element) {
                return "day" in element ? element.sessions : [];
            }
            const result = await getSessions();
            const groups = new Map<string, SessionDay>();
            for (const session of [...result.sessions].sort((left, right) => right.modified - left.modified)) {
                const date = new Date(session.modified);
                const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                let group = groups.get(day);
                if (!group) {
                    group = { day, modified: session.modified, sessions: [] };
                    groups.set(day, group);
                }
                group.sessions.push(session);
            }
            const items: SavedSessionItem[] = [...groups.values()];
            if (result.unreadable.length) items.push({ notice: true });
            return items;
        },
        getTreeItem(session) {
            if ("notice" in session) {
                return { label: strings["savedSessions.unreadable"], tooltip: strings["savedSessions.unreadable.help"], iconPath: new vscode.ThemeIcon("warning") };
            }
            if ("day" in session) {
                const label = new Date(session.modified).toLocaleDateString(vscode.env?.language ?? "en", {
                    weekday: "long", year: "numeric", month: "long", day: "numeric",
                });
                return {
                    id: `saved-day:${session.day}`,
                    label,
                    accessibilityInformation: { label },
                    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                };
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
    const view = vscode.window.createTreeView("multiHarness.savedSessions", options) as vscode.TreeView<SavedSessionItem> & {
        onDidChangeCheckboxState?: vscode.Event<{ items: readonly (readonly [SavedSessionItem, number])[] }>;
    };
    nativeCheckboxes = typeof view.onDidChangeCheckboxState === "function";
    if (view.onDidChangeCheckboxState) {
        context.subscriptions.push(view.onDidChangeCheckboxState(async (event) => {
            if (!selectionMode || deleting) return;
            const available = new Set((await getSessions()).sessions.map(sessionKey));
            if (!selectionMode || deleting) return;
            for (const [session, value] of event.items) {
                if ("notice" in session || "day" in session || !available.has(sessionKey(session))) continue;
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
        view.description = [scope.agent?.displayName, allLocations ? strings["sessionScope.allLocations"] : scope.cwd ? path.basename(scope.cwd) : undefined].filter(Boolean).join(" · ");
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
        vscode.commands.registerCommand("multiHarness.toggleSessionLocationScope", async () => {
            if (deleting) return;
            allLocations = !allLocations;
            refresh();
            await context.workspaceState.update("allSessionLocations", allLocations);
        }),
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
            if (deleting || !request || typeof request.harnessId !== "string" || typeof request.id !== "string") {
                return;
            }
            const originalScope = scopeKey();
            const session = (await getSessions()).sessions.find((candidate) => candidate.harnessId === request.harnessId && candidate.id === request.id);
            const harness = HARNESSES.find((candidate) => candidate.id === session?.harnessId);
            if (deleting || !session || !harness) {
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
            if (deleting || originalScope !== scopeKey()) return;
            await openAgentTerminal(context, harness, status, {
                sessionId: session.id,
                sessionFile: session.file,
                sessionsRoot: getRoots().find((root) => root.harnessId === session.harnessId)?.directory,
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
    return { onDidChange: changes.event, getSessions, getScope: selection.getScope, getMessage, getAllLocations: () => allLocations,
        getSelection: () => ({ mode: selectionMode, busy: deleting, supported: supportsSessionDeletion(selection.getScope().agent?.id ?? ""), keys: [...selected] }) };
}
