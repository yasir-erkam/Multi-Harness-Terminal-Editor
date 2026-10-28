import * as vscode from "vscode";
import { HARNESSES, type Harness, iconFile } from "./harnesses";
import { type SessionContext } from "./sessionContext";
import { extensionStrings } from "./localization";

/** Activity Bar launcher reuses the same commands as the editor buttons. */
export function registerAgentsView(context: vscode.ExtensionContext, selection: SessionContext): void {
    const favoritesKey = "favoriteAgents";
    const strings = extensionStrings(context);
    const favorites = new Set(context.globalState.get<string[]>(favoritesKey, []));
    const changes = new vscode.EventEmitter<void>();
    const provider: vscode.TreeDataProvider<Harness> = {
        onDidChangeTreeData: changes.event,
        getChildren(element) {
            return element ? [] : [
                ...HARNESSES.filter((harness) => favorites.has(harness.id)),
                ...HARNESSES.filter((harness) => !favorites.has(harness.id)),
            ];
        },
        getTreeItem(harness) {
            return {
                id: harness.id,
                label: harness.displayName,
                description: [selection.getScope().agent?.id === harness.id ? "✓" : "", favorites.has(harness.id) ? "★" : ""].filter(Boolean).join(" ") || undefined,
                contextValue: favorites.has(harness.id) ? "favoriteAgent" : "agent",
                tooltip: `${harness.displayName} — ${strings["sidebar.select"]}. ${strings["sidebar.doubleClickOpen"]}.`,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "light")),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", iconFile(harness, "dark")),
                },
                command: {
                    command: "multiHarness.selectSessionAgent",
                    title: harness.displayName,
                    arguments: [harness.id, true],
                },
            };
        },
    };

    async function setFavorite(harness: Harness | undefined, favorite: boolean): Promise<void> {
        if (!harness || !HARNESSES.some((agent) => agent.id === harness.id)) {
            return;
        }
        if (favorites.has(harness.id) === favorite) {
            return;
        }
        if (favorite) {
            favorites.add(harness.id);
        } else {
            favorites.delete(harness.id);
        }
        await context.globalState.update(favoritesKey, [...favorites]);
        changes.fire();
    }

    const view = vscode.window.createTreeView("multiHarness.agents", { treeDataProvider: provider });
    context.subscriptions.push(
        changes,
        selection.onDidChange(() => changes.fire()),
        view,
        view.onDidChangeSelection((event) => {
            const harness = event.selection[0];
            if (harness) {
                void selection.selectAgent(harness.id);
            }
        }),
        vscode.commands.registerCommand("multiHarness.addFavorite", (harness?: Harness) => setFavorite(harness, true)),
        vscode.commands.registerCommand("multiHarness.removeFavorite", (harness?: Harness) => setFavorite(harness, false))
    );
}
