import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES, iconFile } from "./harnesses";
import { openAgentTerminal } from "./launch";
import { extensionStrings } from "./localization";
import { resumeArguments, scanSavedSessions, sessionRoots, type SavedSession, type SessionScan } from "./savedSessions";
import { type AgentStatus } from "./status";
import { type SessionContext, type SessionScope } from "./sessionContext";

export interface SavedSessions {
    readonly onDidChange: vscode.Event<void>;
    getSessions(): Promise<SessionScan>;
    getScope(): SessionScope;
    getMessage(): string | undefined;
}

interface ScanNotice { readonly notice: true; }

export function registerSavedSessionsView(context: vscode.ExtensionContext, status: AgentStatus, selection: SessionContext): SavedSessions {
    const strings = extensionStrings(context);
    const changes = new vscode.EventEmitter<void>();
    let pending: Promise<SessionScan> | undefined;
    let pendingKey: string | undefined;
    let scanController: AbortController | undefined;
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
                const config = vscode.workspace.getConfiguration("multiHarness");
                const roots = sessionRoots().map((root) => {
                    const value = config.get<unknown>(`${root.harnessId}.sessionDirectory`, "");
                    const override = typeof value === "string" ? value.trim() : "";
                    return override ? { ...root, directory: override.replace(/^~(?=$|[/\\])/, os.homedir()) } : root;
                });
                return scanSavedSessions(roots, 100, { harnessId: scope.agent!.id, cwd: scope.cwd! }, { signal });
            }).catch(() => ({ sessions: [], unreadable: [scope.agent!.id] }));
        }
        const request = pending;
        const result = await request;
        // A refresh or project change must not restore an obsolete scan.
        if (request !== pending || key !== JSON.stringify([selection.getScope().agent?.id, selection.getScope().cwd])) {
            return getSessions();
        }
        return result;
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
                label: session.title,
                description: `${harness.displayName} · ${path.basename(session.cwd)} · ${date}`,
                tooltip: `${session.title}\n${harness.displayName}\n${session.cwd}\n${new Date(session.modified).toLocaleString()}\n${session.id}`,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
                },
                command: {
                    command: "multiHarness.resumeSession",
                    title: strings["command.resumeSession.title"],
                    arguments: [{ harnessId: session.harnessId, id: session.id }],
                },
            };
        },
    };
    const view = vscode.window.createTreeView("multiHarness.savedSessions", { treeDataProvider: provider });
    let previousAgentPresence: boolean | undefined;
    function updateHeader(): void {
        const scope = selection.getScope();
        const hasAgent = scope.agent !== undefined;
        if (previousAgentPresence !== hasAgent) {
            previousAgentPresence = hasAgent;
            void vscode.commands.executeCommand("setContext", "multiHarness.hasSelectedSessionAgent", hasAgent);
        }
        view.description = [scope.agent?.displayName, scope.cwd ? path.basename(scope.cwd) : undefined].filter(Boolean).join(" · ");
        view.message = getMessage();
    }
    updateHeader();
    context.subscriptions.push(
        changes,
        { dispose: () => scanController?.abort() },
        view,
        selection.onDidChange(refresh),
        vscode.commands.registerCommand("multiHarness.refreshSessions", refresh),
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
                terminalName: `${harness.displayName} — ${session.id}`,
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
    return { onDidChange: changes.event, getSessions, getScope: selection.getScope, getMessage };
}
