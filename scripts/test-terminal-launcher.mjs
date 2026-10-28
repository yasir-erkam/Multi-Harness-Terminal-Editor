import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launcher = fileURLToPath(new URL("../media/terminal-launcher.cjs", import.meta.url));
const prompt = "Press any key to close this terminal.";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const sessions = new Set();

function start(args, { pty = false, env = {} } = {}) {
    const command = [process.execPath, launcher, ...args];
    const child = pty
        ? spawn("script", ["-q", "-e", "-f", "-c", `exec ${command.map(quote).join(" ")}`, "/dev/null"], { env: { ...process.env, ...env }, stdio: "pipe" })
        : spawn(command[0], command.slice(1), { env: { ...process.env, ...env }, stdio: "pipe" });
    const session = { child, output: "", closed: false, waiters: new Set(), wrapperPid: undefined };
    sessions.add(session);
    const collect = (data) => {
        session.output += data.toString();
        const match = session.output.match(/WRAPPER:(\d+)/);
        if (match) session.wrapperPid = Number(match[1]);
        for (const wake of session.waiters) wake();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    session.done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (session.wrapperPid) {
                try { process.kill(session.wrapperPid, "SIGTERM"); } catch { /* Already exited. */ }
            }
            child.kill("SIGKILL");
            reject(new Error(`Launcher timeout: ${session.output}`));
        }, 10000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("close", (code, signal) => {
            clearTimeout(timer);
            session.closed = true;
            for (const wake of session.waiters) wake();
            resolve({ code, signal });
        });
    });
    // A failed wait must not leave an unobserved timeout rejection.
    session.done.catch(() => {});
    session.until = (text) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(`Missing ${JSON.stringify(text)}: ${session.output}`)), 5000);
        function finish(error) {
            clearTimeout(timer);
            session.waiters.delete(check);
            if (error) reject(error); else resolve();
        }
        function check() {
            if (session.output.includes(text)) finish();
            else if (session.closed) finish(new Error(`Exited before ${JSON.stringify(text)}: ${session.output}`));
        }
        session.waiters.add(check);
        check();
    });
    return session;
}

async function retained(session, text = prompt) {
    await session.until(text);
    assert.equal(session.closed, false, "retained output waits for an explicit key");
    session.child.stdin.write("x");
    return session.done;
}

try {
    for (const mode of ["success", "always"]) {
        const session = start([mode, process.execPath, "-e", "console.log('completed')"]);
        assert.equal((await session.done).code, 0);
        assert.match(session.output, /completed/);
        assert.ok(!session.output.includes(prompt));
    }

    const literalArgs = ["a b", "'quoted'", '"double"', "$HOME; echo injected", "", "Türkçe", "line\nbreak"];
    const environment = start(["always", process.execPath, "-e", `console.log(JSON.stringify({ args: process.argv.slice(1), electron: process.env.ELECTRON_RUN_AS_NODE, language: process.env.MULTI_HARNESS_LAUNCHER_LANGUAGE, original: process.env.MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE, identity: process.env.MULTI_HARNESS_TERMINAL_IDENTITY, tty: Boolean(process.stdin.isTTY) }))`, "--", ...literalArgs], {
        env: { ELECTRON_RUN_AS_NODE: "1", MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE: JSON.stringify("original"), MULTI_HARNESS_LAUNCHER_LANGUAGE: "tr", MULTI_HARNESS_TERMINAL_IDENTITY: "identity-value" },
    });
    assert.equal((await environment.done).code, 0);
    assert.deepEqual(JSON.parse(environment.output), { args: literalArgs, electron: "original", identity: "identity-value", tty: false });

    const stripped = start(["always", process.execPath, "-e", "console.log(JSON.stringify({ electron: process.env.ELECTRON_RUN_AS_NODE, original: process.env.MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE, language: process.env.MULTI_HARNESS_LAUNCHER_LANGUAGE }))"], {
        env: { ELECTRON_RUN_AS_NODE: "1", MULTI_HARNESS_ORIGINAL_ELECTRON_RUN_AS_NODE: "null", MULTI_HARNESS_LAUNCHER_LANGUAGE: "en" },
    });
    assert.equal((await stripped.done).code, 0);
    assert.deepEqual(JSON.parse(stripped.output), {});

    const failureAlways = start(["always", process.execPath, "-e", "process.exit(7)"]);
    assert.equal((await failureAlways.done).code, 7);
    assert.ok(!failureAlways.output.includes(prompt));
    const missingAlways = start(["always", fileURLToPath(new URL("./missing-launcher-test-executable", import.meta.url))]);
    assert.equal((await missingAlways.done).code, 1);
    assert.match(missingAlways.output, /Unable to start program/);

    const markerDirectory = mkdtempSync(join(tmpdir(), "mhte-exit-marker-"));
    try {
        const exitFile = join(markerDirectory, "exit.json");
        const cases = [
            { code: "process.exit(0)", status: { code: 0, signal: null } },
            { code: "process.exit(7)", status: { code: 7, signal: null } },
        ];
        if (process.platform !== "win32") cases.push({ code: "process.kill(process.pid, 'SIGTERM')", status: { code: null, signal: "SIGTERM" } });
        for (const test of cases) {
            const session = start(["never", process.execPath, "-e", `console.log('EXIT_ENV:' + String(process.env.MULTI_HARNESS_LAUNCHER_EXIT_FILE)); ${test.code}`], {
                env: { MULTI_HARNESS_LAUNCHER_EXIT_FILE: exitFile },
            });
            await session.until(prompt);
            assert.match(session.output, /EXIT_ENV:undefined/, "marker paths do not leak into the CLI environment");
            assert.deepEqual(JSON.parse(readFileSync(exitFile, "utf8")), test.status, "exit status is published before retention begins");
            if (process.platform !== "win32") assert.equal(statSync(exitFile).mode & 0o777, 0o600);
            session.child.stdin.write("x");
            await session.done;
            assert.equal(existsSync(exitFile), true, "the marker persists until the parent handles terminal closure");
            assert.deepEqual(JSON.parse(readFileSync(exitFile, "utf8")), test.status);
            rmSync(exitFile);
        }
    } finally {
        rmSync(markerDirectory, { recursive: true, force: true });
    }

    if (process.platform === "win32") {
        const directory = mkdtempSync(join(tmpdir(), "mhte launcher "));
        try {
            const output = join(directory, "arguments.cjs");
            writeFileSync(output, "console.log(JSON.stringify(process.argv.slice(2)));");
            const windowsArgs = ["a b", "amp&ersand", "pipe|literal", "<redirect>", "paren(test)", "semi;colon", "dollar$value", "caret^value"];
            for (const npmShim of [false, true]) {
                const folder = npmShim ? join(directory, "node_modules", ".bin") : directory;
                mkdirSync(folder, { recursive: true });
                const batch = join(folder, "agent.cmd");
                writeFileSync(batch, `@echo off\r\n"${process.execPath}" "${output}" %*\r\n`);
                const session = start(["always", batch, ...windowsArgs]);
                assert.equal((await session.done).code, 0, session.output);
                assert.deepEqual(JSON.parse(session.output), windowsArgs, "batch launchers preserve literal spaces and shell metacharacters");
            }
            const powershell = join(directory, "agent.ps1");
            writeFileSync(powershell, `& '${process.execPath.replaceAll("'", "''")}' '${output.replaceAll("'", "''")}' @args\r\nexit $LASTEXITCODE\r\n`);
            const session = start(["always", powershell, ...windowsArgs]);
            assert.equal((await session.done).code, 0, session.output);
            assert.deepEqual(JSON.parse(session.output), windowsArgs, "PowerShell scripts receive literal arguments");
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    if (process.platform !== "win32") {
        for (const [mode, code] of [["success", 7], ["never", 0], ["never", 9]]) {
            const session = start([mode, process.execPath, "-e", `console.log('CHILD OUTPUT'); process.exit(${code})`], { pty: true });
            assert.equal((await retained(session)).code, code);
            assert.match(session.output, /CHILD OUTPUT/);
            assert.ok(session.output.includes(`exit code: ${code}`));
        }
        const defaultMode = start([process.execPath, "-e", "process.exit(4)"], { pty: true });
        assert.equal((await retained(defaultMode)).code, 4);

        const unknown = start(["success", fileURLToPath(new URL("./missing-launcher-test-executable", import.meta.url))], { pty: true });
        assert.equal((await retained(unknown)).code, 1);
        assert.match(unknown.output, /Unable to start program/);

        const localized = start(["never", process.execPath, "-e", "process.exit(0)"], { pty: true, env: { MULTI_HARNESS_LAUNCHER_LANGUAGE: "tr" } });
        assert.equal((await retained(localized, "Terminali kapatmak için bir tuşa basın.")).code, 0);
        assert.match(localized.output, /çıkış kodu: 0/);

        const signalExit = start(["success", process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"], { pty: true });
        assert.equal((await retained(signalExit)).code, 143);
        assert.match(signalExit.output, /signal: SIGTERM/);

        const signalAlways = start(["always", process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"]);
        assert.equal((await signalAlways.done).code, 143);
        assert.ok(!signalAlways.output.includes(prompt));

        const interactive = start(["never", process.execPath, "-e", `if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(8); process.stdin.setRawMode(true); process.stdin.once('data', data => { console.log('CHILD RECEIVED:' + data.toString()); process.exit(0); }); console.log('INPUT READY');`], { pty: true });
        await interactive.until("INPUT READY");
        interactive.child.stdin.write("z");
        await interactive.until("CHILD RECEIVED:z");
        assert.equal((await retained(interactive)).code, 0, "input remains owned by the child until it exits");

        const ctrlC = start(["success", process.execPath, "-e", `let count = 0; process.on('SIGINT', () => { count++; console.log('INTERRUPTS:' + count); setTimeout(() => process.exit(6), 100); }); setInterval(() => {}, 1000); console.log('INTERRUPT READY');`], { pty: true });
        await ctrlC.until("INTERRUPT READY");
        ctrlC.child.stdin.write("\x03");
        assert.equal((await retained(ctrlC)).code, 6, ctrlC.output);
        assert.match(ctrlC.output, /INTERRUPTS:1/);
        assert.ok(!ctrlC.output.includes("INTERRUPTS:2"), "foreground Ctrl+C is neither swallowed nor forwarded twice");

        const eof = start(["never", process.execPath, "-e", "process.exit(0)"]);
        await eof.until(prompt);
        eof.child.stdin.end();
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(eof.closed, false, "EOF is not an explicit key press");
        eof.child.kill("SIGTERM");
        assert.equal((await eof.done).code, 143);

        const changedTerminal = start(["never", process.execPath, "-e", `require('node:child_process').spawnSync('stty', ['-echo', '-icanon'], { stdio: 'inherit' }); process.exit(0);`], { pty: true });
        assert.equal((await retained(changedTerminal)).code, 0, "a child leaving noncanonical input still permits single-key dismissal");

        // A real child that ignores graceful shutdown must still die before its
        // wrapper exits, even when only the wrapper receives the close signal.
        for (const signal of ["SIGTERM", "SIGHUP"]) {
            const session = start(["never", process.execPath, "-e", `process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('WRAPPER:' + process.ppid); console.log('CHILD:' + process.pid); console.log('TERMINATION READY'); setInterval(() => {}, 1000);`], { pty: true });
            await session.until("TERMINATION READY");
            const childPid = Number(session.output.match(/CHILD:(\d+)/)[1]);
            process.kill(session.wrapperPid, signal);
            assert.equal((await session.done).code, signal === "SIGTERM" ? 143 : 129);
            assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" }, "terminated wrappers do not orphan the child");
            assert.ok(!session.output.includes(prompt), "closing the terminal never enters retention");
        }
    }
    console.log("ok: terminal launcher modes, literal arguments, environment, real PTY input, Ctrl+C and termination");
} finally {
    for (const session of sessions) {
        if (session.closed) continue;
        if (session.wrapperPid) {
            try { process.kill(session.wrapperPid, "SIGTERM"); } catch { /* Already exited. */ }
        }
        session.child.kill("SIGTERM");
    }
}
