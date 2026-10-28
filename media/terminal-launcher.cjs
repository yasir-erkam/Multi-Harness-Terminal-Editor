"use strict";

// Keep the child in the terminal's foreground process group and inherit its real
// descriptors: a pipe or detached process would break interactive CLI programs.
const { spawn, spawnSync } = require("node:child_process");
const os = require("node:os");
const { writeFileSync } = require("node:fs");

const args = process.argv.slice(2);
const mode = ["success", "never", "always"].includes(args[0]) ? args.shift() : "success";
const executable = args.shift();
const messages = require(process.env.MULTI_HARNESS_LAUNCHER_LANGUAGE === "tr" ? "../package.nls.tr.json" : "../package.nls.json");
function message(key, values = {}) {
    return messages[`terminalLauncher.${key}`].replace(/\{(\w+)\}/g, (placeholder, name) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
    const original = JSON.parse(env.MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE);
    if (typeof original === "string") env.ELECTRON_RUN_AS_NODE = original;
} catch {
    // An absent original value means the parent added ELECTRON_RUN_AS_NODE.
}
delete env.MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE;
delete env.MULTI_HARNESS_LAUNCHER_LANGUAGE;
const exitFile = env.MULTI_HARNESS_LAUNCHER_EXIT_FILE;
delete env.MULTI_HARNESS_LAUNCHER_EXIT_FILE;
// The parent removes this marker only after its terminal-close event. Removing
// it on process exit would briefly make a dead terminal look reusable again.

// Node only exposes raw-mode restoration, not echo/canonical flags modified by
// a child. Save the actual terminal settings before handing the terminal over.
function stty(args, capture = false) {
    if (process.platform === "win32" || !process.stdin.isTTY) return undefined;
    try {
        const result = spawnSync("stty", args, {
            stdio: ["inherit", capture ? "pipe" : "ignore", "ignore"],
            encoding: "utf8",
        });
        return result.status === 0 ? result.stdout?.trim() : undefined;
    } catch {
        return undefined;
    }
}
const terminalSettings = stty(["-g"], true);
let child;
let finished = false;
let terminating;
let killTimer;
let retentionTimer;
let retaining = false;
let previousRawMode = false;

function restoreTerminal() {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        try { process.stdin.setRawMode(previousRawMode); } catch { /* Terminal may have disconnected. */ }
    }
    stty(terminalSettings ? [terminalSettings] : ["sane"]);
}

function exit(code) {
    clearTimeout(killTimer);
    clearInterval(retentionTimer);
    if (retaining) {
        process.stdin.removeListener("data", dismiss);
        restoreTerminal();
        process.stdin.pause();
        process.stdin.unref?.();
    }
    process.exitCode = code;
}

function dismiss() {
    exit(process.exitCode || 0);
}

function finish(code, signal, error) {
    if (finished) return;
    finished = true;
    if (exitFile) {
        try {
            writeFileSync(exitFile, JSON.stringify({
                code: Number.isInteger(code) ? code : null,
                signal: typeof signal === "string" ? signal : null,
            }), { mode: 0o600 });
        } catch {
            // Storage may disappear when the extension host shuts down; this
            // must not discard the CLI's retained output or change its status.
        }
    }
    if (terminating) {
        exit(128 + (os.constants.signals[terminating] || 1));
        return;
    }
    const exitCode = Number.isInteger(code) ? code : signal ? 128 + (os.constants.signals[signal] || 1) : 1;
    if (error) process.stderr.write(`${message("launchError", { message: error.message })}\n`);
    if (mode === "always" || (mode === "success" && code === 0 && !signal && !error)) {
        exit(exitCode);
        return;
    }

    retaining = true;
    previousRawMode = Boolean(process.stdin.isRaw);
    restoreTerminal();
    if (process.stdout.isTTY) process.stdout.write("\x1b[0m\x1b[?25h\x1b[?2004l");
    const status = error ? message("launchError", { message: error.message })
        : signal ? message("signal", { signal })
            : Number.isInteger(code) ? message("exitCode", { code })
                : message("unknownExit");
    process.stdout.write(`\r\n${message("pressKey", { status })}\r\n`);
    process.exitCode = exitCode;
    // Retain even on EOF: loss of input is not an explicit dismissal.
    retentionTimer = setInterval(() => {}, 0x3fffffff);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        try { process.stdin.setRawMode(true); } catch { /* A disconnected PTY still waits for termination. */ }
    }
    process.stdin.once("data", dismiss);
    process.stdin.resume();
}

function terminate(signal) {
    if (terminating) return;
    terminating = signal;
    if (finished || !child || !child.pid) {
        exit(128 + (os.constants.signals[signal] || 1));
        return;
    }
    // Do not leave a child behind when VS Code closes the wrapper. A child may
    // ignore graceful termination, so keep the wrapper alive until forced exit.
    if (process.platform === "win32") {
        // Batch/PowerShell launchers add an intermediate process. Killing only
        // that process would leave the actual CLI alive after terminal close.
        spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    }
    child.kill(signal);
    killTimer = setTimeout(() => child.kill("SIGKILL"), 750);
}

process.on("SIGHUP", () => terminate("SIGHUP"));
process.on("SIGTERM", () => terminate("SIGTERM"));
process.on("SIGINT", () => {
    if (finished) terminate("SIGINT");
    // While running, the real foreground terminal delivers Ctrl+C to the child
    // too. Forwarding here would deliver it twice to an interactive child.
});

// cmd.exe has its own command-line parser, distinct from Windows argv parsing.
// Escape both layers (and one extra layer for npm's %* forwarding shims).
function cmdArgument(value, doubleEscape) {
    let escaped = String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
    escaped = `"${escaped}"`.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
    return doubleEscape ? escaped.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1") : escaped;
}

function launch() {
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
        const doubleEscape = /[\\/]node_modules[\\/]\.bin[\\/]/i.test(executable);
        const command = executable.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
        const line = [command, ...args.map((arg) => cmdArgument(arg, doubleEscape))].join(" ");
        return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/v:off", "/c", `"${line}"`], {
            env, stdio: "inherit", shell: false, windowsVerbatimArguments: true,
        });
    }
    if (process.platform === "win32" && /\.ps1$/i.test(executable)) {
        return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, ...args], {
            env, stdio: "inherit", shell: false,
        });
    }
    return spawn(executable, args, { env, stdio: "inherit", shell: false });
}

if (!executable) {
    finish(undefined, undefined, new Error(message("missingExecutable")));
} else {
    try {
        child = launch();
        child.once("error", (error) => finish(undefined, undefined, error));
        child.once("exit", (code, signal) => finish(code, signal));
    } catch (error) {
        finish(undefined, undefined, error);
    }
}
