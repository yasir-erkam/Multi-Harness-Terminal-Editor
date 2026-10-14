import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { type FavoriteAgents } from "./agentsView";
import { HARNESSES, iconFile } from "./harnesses";
import { type AgentSessions, sessionLabel } from "./sessionsView";

export function registerCardsView(
    context: vscode.ExtensionContext,
    favorites: FavoriteAgents,
    sessions: AgentSessions
): void {
    let current: vscode.WebviewView | undefined;
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const language = vscode.env.language.toLowerCase().startsWith("tr") ? "tr" : "en";
    const strings: Record<string, string> = JSON.parse(readFileSync(
        join(context.extensionPath, language === "tr" ? "package.nls.tr.json" : "package.nls.json"), "utf8"
    ));

    function refresh(): void {
        if (!current) {
            return;
        }
        const webview = current.webview;
        void webview.postMessage({
            type: "state",
            agents: [...HARNESSES].sort((a, b) => Number(favorites.isFavorite(b)) - Number(favorites.isFavorite(a))).map((harness) => ({
                id: harness.id,
                name: harness.displayName,
                favorite: favorites.isFavorite(harness),
                lightIcon: webview.asWebviewUri(vscode.Uri.joinPath(media, iconFile(harness, "light"))).toString(),
                darkIcon: webview.asWebviewUri(vscode.Uri.joinPath(media, iconFile(harness, "dark"))).toString(),
            })),
            sessions: sessions.getSessions().map((session) => ({
                id: session.id,
                label: sessionLabel(session),
                active: session.terminal === vscode.window.activeTerminal,
            })),
        });
    }

    const provider: vscode.WebviewViewProvider = {
        resolveWebviewView(view) {
            current = view;
            const webview = view.webview;
            webview.options = { enableScripts: true, localResourceRoots: [media] };
            const nonce = randomBytes(18).toString("hex");
            const asset = (name: string): string => webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
            const labels = JSON.stringify(strings).replace(/</g, "\\u003c");
            webview.html = `<!DOCTYPE html>
<html lang="${language}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("sidebar.css")}"></head>
<body><main id="app"></main>
<script nonce="${nonce}">window.sidebarLabels = ${labels};</script>
<script nonce="${nonce}" src="${asset("sidebar.js")}"></script></body></html>`;

            context.subscriptions.push(
                webview.onDidReceiveMessage(async (message: unknown) => {
                    if (!message || typeof message !== "object") {
                        return;
                    }
                    const { action, id } = message as { action?: unknown; id?: unknown };
                    if (action === "ready") {
                        refresh();
                    } else if (action === "settings") {
                        await vscode.commands.executeCommand("multiHarness.openSettings");
                    } else if (action === "layout") {
                        await vscode.commands.executeCommand("multiHarness.toggleSidebarLayout");
                    } else if (action === "focus" && typeof id === "string") {
                        const session = sessions.getSessions().find((candidate) => candidate.id === id);
                        if (session) {
                            await vscode.commands.executeCommand("multiHarness.focusSession", session.terminal);
                        }
                    } else if (typeof id === "string") {
                        const harness = HARNESSES.find((candidate) => candidate.id === id);
                        if (harness && action === "open") {
                            await vscode.commands.executeCommand(harness.commandId);
                        } else if (harness && action === "favorite") {
                            await vscode.commands.executeCommand(
                                favorites.isFavorite(harness) ? "multiHarness.removeFavorite" : "multiHarness.addFavorite", harness
                            );
                        }
                    }
                }),
                view.onDidChangeVisibility(() => refresh()),
                view.onDidDispose(() => {
                    if (current === view) {
                        current = undefined;
                    }
                })
            );
        },
    };
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("multiHarness.cards", provider),
        favorites.onDidChange(refresh),
        sessions.onDidChange(refresh)
    );
}
