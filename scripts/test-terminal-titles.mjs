import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const directory = mkdtempSync(join(tmpdir(), "mhte-titles-"));
const store = join(directory, "sessions");
mkdirSync(store);
mkdirSync(join(directory, "terminal-sessions"));
const file = join(store, "conversation.jsonl");
const writeTitle = (id, title) => writeFileSync(file, JSON.stringify({ type: "session", id, cwd: directory }) + "\n" + JSON.stringify({ type: "session_info", name: title }) + "\n");
const terminal = { name: "omp", creationOptions: { env: { MULTI_HARNESS_TERMINAL_IDENTITY: JSON.stringify({ version: 1, harnessId: "ohMyPi", launchMode: "direct", terminalSessionId: "title-test" }) } } };
let tick;
let activeChanged;
let releaseRename;
const renamed = () => new Promise((resolve) => { releaseRename = resolve; });
const vscode = {
    window: { activeTerminal: terminal, terminals: [terminal], onDidChangeActiveTerminal(listener) { activeChanged = listener; return { dispose() {} }; } },
    workspace: { getConfiguration: () => ({ get: () => store }) },
    commands: { async executeCommand(command, args) { assert.equal(command, "workbench.action.terminal.renameWithArg"); terminal.name = args.name; releaseRename?.(); } },
};
globalThis.__titleTestVscode = vscode;
const bundle = await build({ entryPoints: ["src/terminalTitles.ts"], bundle: true, platform: "node", format: "cjs", write: false, define: { "process.platform": '"win32"' }, plugins: [{ name: "vscode", setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = globalThis.__titleTestVscode;" })); } }] });
const module = { exports: {} };
new Function("require", "module", "exports", "setInterval", "clearInterval", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, (callback) => { tick = callback; return 1; }, () => {});
const context = { subscriptions: [] };
try {
    writeTitle("first", "🏷️ SEKME: Sekmede ajan yerine oturum konusunu göster");
    writeFileSync(join(directory, "terminal-sessions", "apple-title-test"), `first\n${file}\n`);
    let done = renamed();
    module.exports.registerTerminalTitles(context);
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Initial title timeout")), 3000))]);
    assert.equal(terminal.name, "omp - 🏷️ SEKME: Sekmede ajan yerine oturum konusunu göster");
    writeTitle("second", "Yeni konu");
    done = renamed();
    tick();
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Updated title timeout")), 3000))]);
    assert.equal(terminal.name, "omp - Yeni konu", "session switches in the same terminal follow the breadcrumb file");
    writeTitle("second", "Yanlış sekmeye yazılmamalı");
    done = new Promise((resolve) => setTimeout(resolve, 100));
    tick();
    vscode.window.activeTerminal = undefined;
    activeChanged();
    await done;
    assert.equal(terminal.name, "omp - Yeni konu", "focus changes during disk reads must not rename another terminal");
    console.log("ok: saved OMP topic appears in tab title, follows changes and does not rename after focus changes");
} finally {
    for (const disposable of context.subscriptions) disposable.dispose();
    rmSync(directory, { recursive: true, force: true });
    delete globalThis.__titleTestVscode;
}
