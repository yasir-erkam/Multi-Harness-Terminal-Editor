/**
 * Minimal ambient declarations for the terminal shell-integration API family.
 *
 * Why this file exists: that API became stable in VS Code 1.93, while this
 * extension supports `engines.vscode: ^1.67.0` and therefore pins
 * `@types/vscode@1.67.0` (vsce requires `@types/vscode` to be no newer than
 * `engines.vscode`, at the major/minor level — see
 * `@vscode/vsce/out/validation.js` `validateVSCodeTypesCompatibility`).
 *
 * Only the members this extension actually uses are declared. Every use site
 * performs runtime feature detection, so on 1.67–1.92 the APIs are simply
 * `undefined` and the extension falls back to direct-mode launching.
 */
declare module "vscode" {
    /**
     * The shell integration object, offering shell awareness for a terminal.
     * @since 1.93 (declared locally for compatibility with the pinned 1.67 types)
     */
    export interface TerminalShellIntegration {
        /** The current working directory of the terminal, when reported. */
        readonly cwd: Uri | undefined;
        /** Execute a command line exactly as typed. */
        executeCommand(commandLine: string): TerminalShellExecution;
        /** Execute an executable with arguments, letting the shell quote them. */
        executeCommand(executable: string, args: string[]): TerminalShellExecution;
    }

    /** A command execution happening in a shell-integrated terminal. */
    export interface TerminalShellExecution {
        /** The command line that was executed, as reported by the shell. */
        readonly commandLine: string;
    }

    /** Event payload for shell integration activation. */
    export interface TerminalShellIntegrationChangeEvent {
        readonly terminal: Terminal;
        readonly shellIntegration: TerminalShellIntegration;
    }

    /** Event payload for the start of a shell execution. */
    export interface TerminalShellExecutionStartEvent {
        readonly terminal: Terminal;
        readonly shellIntegration: TerminalShellIntegration;
        readonly execution: TerminalShellExecution;
    }

    /** Event payload for the end of a shell execution. */
    export interface TerminalShellExecutionEndEvent {
        readonly terminal: Terminal;
        readonly shellIntegration: TerminalShellIntegration;
        readonly execution: TerminalShellExecution;
        /** Exit code reported by the shell; `undefined` when it did not report one. */
        readonly exitCode: number | undefined;
    }

    export interface Terminal {
        /** Shell integration for this terminal, or `undefined` when unavailable. */
        readonly shellIntegration: TerminalShellIntegration | undefined;
    }

    export namespace window {
        /** Fires when shell integration activates in a terminal (1.93+). */
        export const onDidChangeTerminalShellIntegration: Event<TerminalShellIntegrationChangeEvent>;
        /** Fires when a command starts running in a shell-integrated terminal (1.93+). */
        export const onDidStartTerminalShellExecution: Event<TerminalShellExecutionStartEvent>;
        /** Fires when a command stops running in a shell-integrated terminal (1.93+). */
        export const onDidEndTerminalShellExecution: Event<TerminalShellExecutionEndEvent>;
    }
}
