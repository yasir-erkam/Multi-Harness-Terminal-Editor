import * as vscode from "vscode";
import { type Harness } from "./harnesses";

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
 * Terminals are tracked by identity (a Set of the objects we created), not by
 * name, so a terminal the user opened themselves can never drive the item.
 */
export class AgentStatus implements vscode.Disposable {
    private readonly tracked = new WeakMap<vscode.Terminal, Harness>();
    private readonly startTimes = new WeakMap<vscode.TerminalShellExecution, number>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private item: vscode.StatusBarItem | undefined;
    private hideTimer: NodeJS.Timeout | undefined;
    private current: Harness | undefined;

    /** Remember a shell-mode terminal and enable the status surface lazily. */
    track(terminal: vscode.Terminal, harness: Harness): void {
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
        this.startTimes.set(event.execution, Date.now());
        this.current = harness;
        this.clearHideTimer();
        this.item.text = `$(sync~spin) ${harness.displayName}`;
        this.item.show();
    }

    private onEnd(event: vscode.TerminalShellExecutionEndEvent): void {
        const harness = this.tracked.get(event.terminal);
        if (!harness || !this.item) {
            return;
        }
        const startedAt = this.startTimes.get(event.execution);
        this.startTimes.delete(event.execution);
        const seconds = startedAt === undefined ? "?" : ((Date.now() - startedAt) / 1000).toFixed(1);
        const icon = event.exitCode === 0 ? "$(check)" : "$(error)";
        const exit = event.exitCode === undefined ? "?" : String(event.exitCode);
        this.current = harness;
        this.item.text = `${icon} ${harness.displayName} — ${seconds}s (exit ${exit})`;
        this.item.show();
        this.hideTimer = setTimeout(() => {
            this.hideTimer = undefined;
            this.item?.hide();
        }, STATUS_HIDE_DELAY_MS);
    }

    private clearHideTimer(): void {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = undefined;
        }
    }

    /** Forget a terminal that closed; keeps the tracked set leak-free. */
    onTerminalClosed(terminal: vscode.Terminal): void {
        this.tracked.delete(terminal);
        if (this.current && terminal.name === this.current.displayName) {
            this.clearHideTimer();
        }
    }

    dispose(): void {
        this.clearHideTimer();
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.item?.dispose();
        this.item = undefined;
    }
}

export function registerAgentStatus(context: vscode.ExtensionContext): AgentStatus {
    const status = new AgentStatus();
    context.subscriptions.push(status);
    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => status.onTerminalClosed(terminal)));
    return status;
}
