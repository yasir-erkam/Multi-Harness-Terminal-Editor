import { realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { grokOwners } from "./grokSessions";
import { HARNESSES, iconFile } from "./harnesses";
import { openAgentTerminal } from "./launch";
import { extensionStrings } from "./localization";
import { supportsSessionDeletion, resumeArguments, scanSavedSessions, sessionRoots, type SavedSession, type SessionScan } from "./savedSessions";
import { type AgentStatus } from "./status";
import { type SessionContext } from "./sessionContext";
import { SessionDeletionError, sessionDeletionTarget } from "./deleteSession";
import { deleteOpenCodeSession, validateOpenCodeDeletion } from "./openCodeDeletion";
import { grokTerminalSessionId, codexTerminalSessionFiles, ompTerminalSessionFile, restoreTerminalIdentity, windowsCodexSessionMatches } from "./terminalIdentity";
import { terminalHasExited } from "./terminalExit";

interface ScanNotice { readonly notice: true; }
interface SessionDay { readonly day: string; readonly modified: number; readonly sessions: SavedSession[]; }
type SavedSessionItem = SavedSession | SessionDay | ScanNotice;

export function registerSavedSessionsView(context: vscode.ExtensionContext, status: AgentStatus, selection: SessionContext): void {
    const strings = extensionStrings(context);
    const changes = new vscode.EventEmitter<void>();
    let pending: Promise<SessionScan> | undefined;
    let pendingKey: string | undefined;
    let scanController: AbortController | undefined;
    let automaticScan: AbortController | undefined;
    let disposed = false;
    let selectionMode = false;
    let allLocations = context.workspaceState.get<boolean>("allSessionLocations", false);
    let deleting = false;
    let activeResumes = 0;
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
    const sessionKey = (session: Pick<SavedSession, "harnessId" | "id" | "file">): string => {
        const resolved = path.resolve(session.file);
        let current = resolved;
        const suffix: string[] = [];
        let file = resolved;
        while (true) {
            try {
                file = path.join(realpathSync(current), ...suffix.reverse());
                break;
            } catch {
                const parent = path.dirname(current);
                if (parent === current) break;
                suffix.push(path.basename(current));
                current = parent;
            }
        }
        if (process.platform === "win32") file = file.toLowerCase();
        return JSON.stringify([session.harnessId, file, session.id]);
    };
    function resolveSession(sessions: readonly SavedSession[], request: unknown): SavedSession | undefined {
        if (!request || typeof request !== "object" || "notice" in request || "day" in request
            || !("harnessId" in request) || !("id" in request)
            || typeof request.harnessId !== "string" || typeof request.id !== "string") return undefined;
        const matches = sessions.filter((session) => session.harnessId === request.harnessId && session.id === request.id);
        if ("file" in request && request.file !== undefined) {
            if (typeof request.file !== "string" || !path.isAbsolute(request.file)) return undefined;
            const key = sessionKey({ harnessId: request.harnessId, id: request.id, file: request.file });
            return matches.find((session) => sessionKey(session) === key);
        }
        return matches.length === 1 ? matches[0] : undefined;
    }
    function getRoots() {
        const config = vscode.workspace.getConfiguration("multiHarness");
        return sessionRoots().map((root) => {
            const value = config.get<unknown>(`${root.harnessId}.sessionDirectory`, "");
            const override = typeof value === "string" ? value.trim() : "";
            return override ? { ...root, directory: override.replace(/^~(?=$|[/\\])/, os.homedir()) } : root;
        });
    }
    function sessionRoot(session: SavedSession) {
        let file: string;
        try { file = realpathSync(session.file); } catch { return undefined; }
        const roots = getRoots().filter((root) => {
            if (root.harnessId !== session.harnessId) return false;
            try {
                const relative = path.relative(realpathSync(root.directory), file);
                return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
            } catch { return false; }
        });
        return roots.length === 1 ? roots[0] : undefined;
    }
    const scopeKey = (): string | undefined => {
        const scope = selection.getScope();
        const agentId = scope.agent?.id;
        try {
            const storeRoot = agentId ? getRoots().find((root) => root.harnessId === agentId)?.directory : undefined;
            return JSON.stringify([agentId, allLocations ? undefined : scope.cwd, allLocations, storeRoot]);
        } catch {
            return undefined;
        }
    };
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
        if (!deleting) {
            if (!result.unreadable.length) {
                const present = new Set(result.sessions.map(sessionKey));
                for (const key of selected) if (!present.has(key)) selected.delete(key);
            }
            updateHeader();
        }
        return result;
    }
    function notifySelection(): void {
        updateHeader();
        changes.fire();
    }
    async function toggleSelection(request?: { harnessId?: string; id?: string; file?: string }): Promise<void> {
        if (deleting || !selectionMode || !request) return;
        const session = resolveSession((await getSessions()).sessions, request);
        if (!session || deleting || !selectionMode) return;
        const key = sessionKey(session);
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        notifySelection();
    }
    async function sessionTerminals(session: SavedSession, sessionIds: readonly string[] = [session.id]): Promise<vscode.Terminal[]> {
        const expectedIds = new Set(sessionIds);
        const terminals = [...vscode.window.terminals];
        const identities = await Promise.all(terminals.map((terminal) => restoreTerminalIdentity(terminal)));
        const exited = await Promise.all(terminals.map((terminal) => terminalHasExited(terminal)));
        const root = session.harnessId === "ohMyPi" ? sessionRoot(session) : undefined;
        const activeFiles = root ? await Promise.all(terminals.map((terminal) => ompTerminalSessionFile(terminal, root.directory))) : [];
        const codexRoot = session.harnessId === "codex" ? sessionRoot(session) : undefined;
        const codexFiles = codexRoot ? await Promise.all(terminals.map((terminal) => codexTerminalSessionFiles(terminal, codexRoot.directory))) : [];
        const grokRoot = session.harnessId === "grokBuild" ? sessionRoot(session) : undefined;
        const grokIds = grokRoot ? await Promise.all(terminals.map((terminal) => grokTerminalSessionId(terminal, grokRoot.directory))) : [];
        const sessionFile = codexRoot ? await fs.realpath(session.file) : session.file;
        const windowsMatches = codexRoot ? await windowsCodexSessionMatches(terminals, sessionFile) : new Map<vscode.Terminal, boolean>();
        return terminals.filter((_terminal, index) => {
            if (exited[index] || _terminal.exitStatus) return false;
            const identity = identities[index];
            if (identity?.harnessId !== session.harnessId) return false;
            if (session.harnessId === "ohMyPi") {
                const activeFile = activeFiles[index];
                return activeFile !== undefined && path.relative(activeFile, session.file) === "";
            }
            if (session.harnessId === "codex") {
                const windowsMatch = windowsMatches.get(_terminal);
                return windowsMatch ?? (codexFiles[index]?.some((file) => path.relative(file, sessionFile) === "") ?? false);
            }
            if (session.harnessId === "grokBuild") {
                return grokIds[index] !== undefined && grokIds[index] !== null && expectedIds.has(grokIds[index]!);
            }
            return identity.sessionId !== undefined && expectedIds.has(identity.sessionId);
        });
    }
    async function deletionTerminals(session: SavedSession, sessionIds?: readonly string[]): Promise<vscode.Terminal[]> {
        const terminals = await sessionTerminals(session, sessionIds);
        if (session.harnessId === "grokBuild" && process.platform === "linux") {
            const root = sessionRoot(session);
            if (!root) throw new Error(strings["savedSessions.invalidFile"]);
            const owners = await grokOwners(root.directory);
            if (owners.some((owner) => owner.sessionId === session.id) && !terminals.length) {
                throw new Error(strings["savedSessions.alreadyRunning"]);
            }
        }
        return terminals;
    }
    async function closeSessionTerminals(terminals: vscode.Terminal[]): Promise<void> {
        const errors: unknown[] = [];
        for (const terminal of terminals) {
            if (!vscode.window.terminals.includes(terminal) || terminal.exitStatus) continue;
            if (await terminalHasExited(terminal)) continue;
            if (!vscode.window.terminals.includes(terminal) || terminal.exitStatus) continue;
            try { terminal.dispose(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw errors[0];
    }
    async function deleteSessions(requests?: readonly unknown[]): Promise<void> {
        const agentId = selection.getScope().agent?.id ?? "";
        if (deleting || disposed || activeResumes > 0 || !supportsSessionDeletion(agentId)) return;
        if (requests !== undefined) {
            if (!requests.some((item) => item && typeof item === "object" && !("notice" in item) && !("day" in item)
                && "harnessId" in item && item.harnessId === agentId && "id" in item && typeof item.id === "string")) {
                return;
            }
        } else if (!selectionMode || !selected.size) {
            return;
        }
        deleting = true;
        notifySelection();
        const originalScope = scopeKey();
        const failures: string[] = [];
        const failedKeys = new Set<string>();
        try {
            if (originalScope === undefined) return;
            const listed = (await getSessions()).sessions;
            const requestedKeys = requests === undefined ? undefined : new Set(requests
                .map((item) => resolveSession(listed, item))
                .filter((session): session is SavedSession => session !== undefined && session.harnessId === agentId)
                .map(sessionKey));
            const targets = requestedKeys
                ? listed.filter((session) => requestedKeys.has(sessionKey(session)))
                : listed.filter((session) => selected.has(sessionKey(session)));
            if (!targets.length || disposed || originalScope !== scopeKey()) return;
            const detail = targets.map((session) => session.title).join("\n");
            const confirm = strings["savedSessions.deleteConfirm"].replace("{count}", String(targets.length));
            const providerDeletion = targets.every((session) => session.harnessId === "openCode");
            const action = strings[providerDeletion ? "savedSessions.deletePermanently" : "savedSessions.moveToTrash"];
            const help = strings[providerDeletion ? "savedSessions.openCodeDeleteHelp" : "savedSessions.deleteHelp"];
            if (await vscode.window.showWarningMessage(confirm, { modal: true, detail: `${detail}\n\n${help}` }, action) !== action) return;
            if (disposed || originalScope !== scopeKey()) return;
            const roots = getRoots();
            const trashFailed: SavedSession[] = [];
            const fail = (session: SavedSession, error: unknown): void => {
                failedKeys.add(sessionKey(session));
                const reason = error instanceof SessionDeletionError ? strings[`savedSessions.${error.reason}`]
                    : error instanceof Error ? error.message : String(error);
                failures.push(`${session.title}: ${reason}`);
            };
            const finishDeletion = async (session: SavedSession, terminals: vscode.Terminal[]): Promise<void> => {
                selected.delete(sessionKey(session));
                try {
                    await closeSessionTerminals(terminals);
                } catch (error) {
                    failures.push(`${session.title}: ${strings["savedSessions.closeFailed"]} (${error instanceof Error ? error.message : String(error)})`);
                }
            };
            for (const session of targets) {
                if (disposed || originalScope !== scopeKey()) break;
                if (session.harnessId === "openCode") {
                    try {
                        const expectedIds = await validateOpenCodeDeletion(session, roots);
                        const terminals = await deletionTerminals(session, expectedIds);
                        if (disposed || originalScope !== scopeKey()) break;
                        await deleteOpenCodeSession(session, roots, expectedIds);
                        await finishDeletion(session, terminals);
                    } catch (error) { fail(session, error); }
                    continue;
                }
                let target: string;
                let terminals: vscode.Terminal[];
                try {
                    await sessionDeletionTarget(session, roots);
                    terminals = await deletionTerminals(session);
                    if (disposed || originalScope !== scopeKey()) break;
                    // Live-process discovery can take time; revalidate before deleting.
                    target = await sessionDeletionTarget(session, roots);
                    if (disposed || originalScope !== scopeKey()) break;
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") selected.delete(sessionKey(session));
                    else fail(session, error);
                    continue;
                }
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: session.harnessId === "grokBuild", useTrash: true });
                } catch {
                    trashFailed.push(session);
                    continue;
                }
                await finishDeletion(session, terminals);
            }
            if (trashFailed.length && !disposed && originalScope === scopeKey()) {
                const permanent = strings["savedSessions.deletePermanently"];
                const approved = await vscode.window.showWarningMessage(
                    strings["savedSessions.trashUnavailable"].replace("{count}", String(trashFailed.length)),
                    { modal: true, detail: trashFailed.map((session) => session.title).join("\n") }, permanent
                ) === permanent;
                if (!disposed && originalScope === scopeKey()) {
                    for (const session of trashFailed) {
                        if (disposed || originalScope !== scopeKey()) break;
                        if (!approved) {
                            failedKeys.add(sessionKey(session));
                            continue;
                        }
                        try {
                            await sessionDeletionTarget(session, roots);
                            const terminals = await deletionTerminals(session);
                            if (disposed || originalScope !== scopeKey()) break;
                            const target = await sessionDeletionTarget(session, roots);
                            if (disposed || originalScope !== scopeKey()) break;
                            await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: session.harnessId === "grokBuild", useTrash: false });
                            await finishDeletion(session, terminals);
                        } catch (error) { fail(session, error); }
                    }
                }
            }
            if (originalScope === scopeKey()) {
                if (failedKeys.size) {
                    selectionMode = true;
                    for (const key of failedKeys) selected.add(key);
                } else if (selected.size === 0) {
                    selectionMode = false;
                }
            }
            if (!disposed) refresh();
            if (!disposed && failures.length) {
                await vscode.window.showErrorMessage(`${strings["savedSessions.deleteFailed"]}\n${failures.join("\n")}`);
            }
        } catch (error) {
            if (!disposed) {
                await vscode.window.showErrorMessage(`${strings["savedSessions.deleteFailed"]}\n${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            deleting = false;
            if (!disposed) notifySelection();
        }
    }
    function refresh(): void {
        scanController?.abort();
        automaticScan?.abort();
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
                id: sessionKey(session),
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
                    arguments: [{ harnessId: session.harnessId, id: session.id, file: session.file }],
                },
            };
        },
    };
    const options = { treeDataProvider: provider, manageCheckboxStateManually: true, canSelectMany: true };
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
        const key = scopeKey() ?? "";
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
    // Poll the selected provider only. Recursive filesystem watches are not
    // portable across supported extension hosts, and SQLite also uses WAL files.
    async function checkForChanges(): Promise<void> {
        const request = pending;
        const key = scopeKey();
        if (disposed || deleting || !request || getMessage()) return;
        const previous = await request;
        if (disposed || deleting || request !== pending || key !== scopeKey()) return;
        const scope = selection.getScope();
        const controller = new AbortController();
        automaticScan = controller;
        const result = await scanSavedSessions(getRoots().filter((root) => root.harnessId === scope.agent!.id),
            100, allLocations ? undefined : { harnessId: scope.agent!.id, cwd: scope.cwd! }, { signal: controller.signal });
        if (disposed || deleting || controller.signal.aborted || request !== pending || key !== scopeKey()) return;
        const same = previous.unreadable.join("\0") === result.unreadable.join("\0")
            && previous.sessions.length === result.sessions.length
            && previous.sessions.every((session, index) => {
                const next = result.sessions[index]!;
                return session.harnessId === next.harnessId && session.id === next.id && session.file === next.file
                    && session.cwd === next.cwd && session.title === next.title && session.modified === next.modified;
            });
        if (!same) {
            pending = Promise.resolve(result);
            changes.fire();
        }
    }
    let automaticTimer: NodeJS.Timeout;
    function scheduleCheck(): void {
        automaticTimer = setTimeout(() => {
            return checkForChanges().catch(() => {
                // A transient store/configuration failure is retried next time.
            }).finally(() => { if (!disposed) scheduleCheck(); });
        }, 3000);
    }
    scheduleCheck();
    context.subscriptions.push(
        changes,
        { dispose: () => {
            disposed = true;
            clearTimeout(automaticTimer);
            automaticScan?.abort();
            scanController?.abort();
        } },
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
        vscode.commands.registerCommand("multiHarness.selectAllSessions", async () => {
            if (deleting || !selectionMode) return;
            const sessions = (await getSessions()).sessions;
            if (deleting || !selectionMode) return;
            for (const session of sessions) selected.add(sessionKey(session));
            notifySelection();
        }),
        vscode.commands.registerCommand("multiHarness.deleteSession", (item?: SavedSessionItem) => deleteSessions(item ? [item] : [])),
        vscode.commands.registerCommand("multiHarness.deleteContextSessions", (item?: SavedSessionItem, items?: readonly SavedSessionItem[]) =>
            deleteSessions(Array.isArray(items) && items.length > 0 ? items : item ? [item] : [])),
        vscode.commands.registerCommand("multiHarness.deleteSelectedSessions", () => deleteSessions()),
        vscode.commands.registerCommand("multiHarness.resumeSession", async (request?: { harnessId?: string; id?: string; file?: string }) => {
            if (deleting || disposed || !request || typeof request.harnessId !== "string" || typeof request.id !== "string") {
                return;
            }
            activeResumes += 1;
            try {
                const originalScope = scopeKey();
                if (originalScope === undefined) return;
                const session = resolveSession((await getSessions()).sessions, request);
                const harness = HARNESSES.find((candidate) => candidate.id === session?.harnessId);
                if (disposed || deleting || !session || !harness || originalScope !== scopeKey()) {
                    return;
                }
                try {
                    if (!(await fs.stat(session.file)).isFile() || !(await fs.stat(session.cwd)).isDirectory()) {
                        throw new Error("missing");
                    }
                } catch {
                    if (!disposed) {
                        void vscode.window.showErrorMessage(`${strings["savedSessions.missing"]}\n${session.cwd}`);
                        refresh();
                    }
                    return;
                }
                if (disposed || deleting || originalScope !== scopeKey()) return;
                const root = sessionRoot(session);
                if (!root) return;
                await openAgentTerminal(context, harness, status, {
                    sessionId: session.id,
                    sessionFile: session.file,
                    sessionsRoot: root.directory,
                    terminalName: `${harness.defaultExecutable} - ${session.title}`,
                    cwd: session.cwd,
                    args: resumeArguments(session),
                });
            } finally {
                activeResumes -= 1;
            }
        }),
        vscode.window.onDidCloseTerminal(refresh),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("multiHarness")) {
                refresh();
            }
        })
    );
}
