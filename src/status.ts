import * as vscode from "vscode";
import { HARNESSES, type Harness } from "./harnesses";
import { restoreTerminalIdentity, terminalIdentity } from "./terminalIdentity";

/** How long a finished status stays visible before the item hides itself. */
export const STATUS_HIDE_DELAY_MS = 30_000;

interface ShellIntegrationApi {
    onDidChangeTerminalShellIntegration?: vscode.Event<vscode.TerminalShellIntegrationChangeEvent>;
    onDidStartTerminalShellExecution?: vscode.Event<vscode.TerminalShellExecutionStartEvent>;
    onDidEndTerminalShellExecution?: vscode.Event<vscode.TerminalShellExecutionEndEvent>;
}

/**
 * Runtime feature detection: the shell-integration API family is stable only
 * since VS Code 1.93, while the extension supports ^1.67.0, so these members can
 * be `undefined` at runtime (the ambient shim in vscodeShellIntegration.d.ts
 * only exists so the code typechecks against the pinned 1.67 types).
 */
export function shellIntegrationApi(): ShellIntegrationApi {
    return vscode.window as unknown as ShellIntegrationApi;
}

export function hasShellIntegrationApi(): boolean {
    return typeof shellIntegrationApi().onDidChangeTerminalShellIntegration === "function";
}

/**
 * Live per-agent status in the status bar, for shell-mode terminals only.
 *
 * All wiring is lazy: nothing is created or subscribed until the first
 * shell-mode terminal is tracked, so direct mode never touches the status bar.
 * Terminals are tracked by identity (a WeakMap of marked terminal objects), not by
 * name, so a terminal the user opened themselves can never drive the item.
 */
export class AgentStatus implements vscode.Disposable {
    private readonly tracked = new WeakMap<vscode.Terminal, Harness>();
    private readonly activeExecutions = new Map<vscode.TerminalShellExecution, { terminal: vscode.Terminal; harness: Harness; startedAt: number }>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private item: vscode.StatusBarItem | undefined;
    private hideTimer: NodeJS.Timeout | undefined;
    private lastFinished: { terminal: vscode.Terminal; text: string } | undefined;

    /** Remember a shell-mode terminal and enable the status surface lazily. */
    track(terminal: vscode.Terminal, harness: Harness): void {
        if (this.tracked.has(terminal)) {
            return;
        }
        this.tracked.set(terminal, harness);
        if (!this.item) {
            this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            const api = shellIntegrationApi();
            if (api.onDidStartTerminalShellExecution) {
                this.subscriptions.push(api.onDidStartTerminalShellExecution((event) => this.onStart(event)));
            }
            if (api.onDidEndTerminalShellExecution) {
                this.subscriptions.push(api.onDidEndTerminalShellExecution((event) => this.onEnd(event)));
            }
        }
    }

    private onStart(event: vscode.TerminalShellExecutionStartEvent): void {
        const harness = this.tracked.get(event.terminal);
        if (!harness || !this.item) {
            return;
        }
        this.activeExecutions.delete(event.execution);
        this.activeExecutions.set(event.execution, { terminal: event.terminal, harness, startedAt: Date.now() });
        this.render();
    }

    private onEnd(event: vscode.TerminalShellExecutionEndEvent): void {
        const harness = this.tracked.get(event.terminal);
        if (!harness || !this.item) {
            return;
        }
        const active = this.activeExecutions.get(event.execution);
        this.activeExecutions.delete(event.execution);
        const seconds = active === undefined ? "?" : ((Date.now() - active.startedAt) / 1000).toFixed(1);
        const icon = event.exitCode === 0 ? "$(check)" : "$(error)";
        const exit = event.exitCode === undefined ? "?" : String(event.exitCode);
        this.lastFinished = { terminal: event.terminal, text: `${icon} ${harness.displayName} — ${seconds}s (exit ${exit})` };
        this.render();
    }

    private render(): void {
        if (!this.item) {
            return;
        }
        this.clearHideTimer();
        let latestActive: { harness: Harness } | undefined;
        for (const entry of this.activeExecutions.values()) {
            latestActive = entry;
        }
        if (latestActive) {
            this.item.text = `$(sync~spin) ${latestActive.harness.displayName}`;
            this.item.show();
            return;
        }
        if (this.lastFinished) {
            this.item.text = this.lastFinished.text;
            this.item.show();
            this.hideTimer = setTimeout(() => {
                this.hideTimer = undefined;
                this.lastFinished = undefined;
                this.item?.hide();
            }, STATUS_HIDE_DELAY_MS);
            return;
        }
        this.item.hide();
    }

    private clearHideTimer(): void {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = undefined;
        }
    }

    /** Forget a terminal that closed; keeps the tracked set leak-free. */
    onTerminalClosed(terminal: vscode.Terminal): void {
        let changed = this.tracked.delete(terminal);
        for (const [execution, entry] of this.activeExecutions) {
            if (entry.terminal === terminal) {
                this.activeExecutions.delete(execution);
                changed = true;
            }
        }
        if (this.lastFinished?.terminal === terminal) {
            this.lastFinished = undefined;
            changed = true;
        }
        if (changed) {
            this.render();
        }
    }

    dispose(): void {
        this.clearHideTimer();
        this.activeExecutions.clear();
        this.lastFinished = undefined;
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions.length = 0;
        this.item?.dispose();
        this.item = undefined;
    }
}

export function registerAgentStatus(context: vscode.ExtensionContext): AgentStatus {
    const status = new AgentStatus();
    context.subscriptions.push(status);
    let disposed = false;
    const trackRestored = (terminal: vscode.Terminal): void => {
        const identity = terminalIdentity(terminal);
        if (terminal.exitStatus || identity?.launchMode !== "shell" || !hasShellIntegrationApi()) {
            return;
        }
        const harness = HARNESSES.find((candidate) => candidate.id === identity.harnessId);
        if (harness) {
            status.track(terminal, harness);
        }
    };
    const restore = (terminal: vscode.Terminal): void => {
        if (terminalIdentity(terminal)) {
            trackRestored(terminal);
        } else {
            void restoreTerminalIdentity(terminal).then(() => {
                if (!disposed && vscode.window.terminals.includes(terminal)) {
                    trackRestored(terminal);
                }
            });
        }
    };
    context.subscriptions.push({ dispose: () => { disposed = true; } });
    // Restoration can happen before activation or later as terminals reconnect.
    context.subscriptions.push(vscode.window.onDidOpenTerminal(restore));
    vscode.window.terminals.forEach(restore);
    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => status.onTerminalClosed(terminal)));
    return status;
}
