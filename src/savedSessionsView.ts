import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { HARNESSES, iconFile } from "./harnesses";
import { openAgentTerminal } from "./launch";
import { extensionStrings } from "./localization";
import { resumeArguments, scanSavedSessions, sessionRoots, type SavedSession, type SessionScan } from "./savedSessions";
import { type AgentStatus } from "./status";

export interface SavedSessions {
    readonly onDidChange: vscode.Event<void>;
    getSessions(): Promise<SessionScan>;
}

interface ScanNotice { readonly notice: true; }

export function registerSavedSessionsView(context: vscode.ExtensionContext, status: AgentStatus): SavedSessions {
    const strings = extensionStrings(context);
    const changes = new vscode.EventEmitter<void>();
    let pending: Promise<SessionScan> | undefined;
    function getSessions(): Promise<SessionScan> {
        if (!pending) {
            const config = vscode.workspace.getConfiguration("multiHarness");
            const roots = sessionRoots().map((root) => {
                const override = config.get<string>(`${root.harnessId}.sessionDirectory`, "").trim();
                return override ? { ...root, directory: override.replace(/^~(?=$|[/\\])/, os.homedir()) } : root;
            });
            pending = scanSavedSessions(roots);
        }
        return pending;
    }
    function refresh(): void {
        pending = undefined;
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
    context.subscriptions.push(
        changes,
        vscode.window.registerTreeDataProvider("multiHarness.savedSessions", provider),
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
    return { onDidChange: changes.event, getSessions };
}
