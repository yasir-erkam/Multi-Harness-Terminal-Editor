// Unit tests: resolveExecutable (pure node module, esbuild-bundled on the fly)
// plus the full manifest validation from validate-manifest.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import process from "node:process";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const outdir = join(projectRoot, ".build");
mkdirSync(outdir, { recursive: true });

await build({
    entryPoints: [join(projectRoot, "src", "resolveExecutable.ts")],
    outfile: join(outdir, "resolveExecutable.test.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});
const { resolveExecutable } = await import(pathToFileURL(join(outdir, "resolveExecutable.test.mjs")).href);

let passed = 0;
function test(name, fn) {
    const rootDir = mkdtempSync(join(tmpdir(), "mhte-test-"));
    try {
        fn(rootDir);
        passed += 1;
        console.log(`ok: ${name}`);
    } finally {
        rmSync(rootDir, { recursive: true, force: true });
    }
}

// 1. Absolute path hit
test("absolute path to an existing file resolves", (dir) => {
    const script = join(dir, "agent-cli");
    writeFileSync(script, "#!/bin/sh\n");
    chmodSync(script, 0o755);
    assert.equal(resolveExecutable(script), script);
    assert.equal(resolveExecutable(join(dir, "missing-cli")), undefined);
});

// 2. Name found in an injected PATH-like array
test("bare name found in provided directory list", (dir) => {
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(join(dir, "claude"), 0o755);
    assert.equal(resolveExecutable("claude", { nextPathDirs: [dir] }), join(dir, "claude"));
});

// 3. Workspace node_modules/.bin wins over user dirs and injected PATH
test("rootFolder/node_modules/.bin is searched first", (dir) => {
    const bin = join(dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "omp"), "#!/bin/sh\n");
    chmodSync(join(bin, "omp"), 0o755);
    assert.equal(resolveExecutable("omp", { rootFolder: dir, nextPathDirs: [dir], user: { home: dir } }), join(bin, "omp"));
});

// 4. win32 suffix resolution via the injectable platform param
test("win32 extension-less command resolves .cmd/.exe suffixes", (dir) => {
    // Deliberately NOT executable and NOT present under the plain name: only
    // the win32 F_OK + suffix walk can find these, the posix X_OK walk cannot.
    writeFileSync(join(dir, "agent.cmd"), "@echo off\n");
    writeFileSync(join(dir, "helper.exe"), "binary");
    assert.equal(
        resolveExecutable("agent", {
            platform: "win32",
            nextPathDirs: [dir],
            user: { home: dir, appData: undefined, localAppData: undefined },
        }),
        join(dir, "agent.cmd")
    );
    assert.equal(
        resolveExecutable("helper", {
            platform: "win32",
            nextPathDirs: [dir],
            user: { home: dir, appData: undefined, localAppData: undefined },
        }),
        join(dir, "helper.exe")
    );
});

// 5. Extension-less name without executable bit is not found on posix
test("non-executable file is not resolved on posix; missing name yields undefined", (dir) => {
    writeFileSync(join(dir, "aider"), "not executable\n");
    assert.equal(resolveExecutable("aider", { nextPathDirs: [dir], user: { home: dir } }), undefined);
    assert.equal(resolveExecutable("definitely-not-installed", { nextPathDirs: [dir], user: { home: dir } }), undefined);
});

// 6. win32 candidate with an explicit extension is used as-is
test("win32 explicit .ps1 path resolves without adding suffixes", (dir) => {
    writeFileSync(join(dir, "tools.ps1"), "Write-Host\n");
    assert.equal(
        resolveExecutable(join(dir, "tools.ps1"), { platform: "win32", user: { home: dir } }),
        join(dir, "tools.ps1")
    );
});

// ---------------------------------------------------------------------------
// Headless activation test.
//
// Guards the class of bug where the extension registers command ids that the
// manifest never contributed (e.g. building them with a template literal
// instead of using the literal ids in src/harnesses.ts): every title-bar button
// and the picker then fail with "command ... not found".
//
// Approach: esbuild-bundle src/extension.ts into a temp dir as `extension.cjs`,
// drop a recording `node_modules/vscode` stub next to it and `require` the
// bundle. The stub is resolved from the bundle's own directory, so no loader
// patching is needed, and `createRequire` gives the test the very same stub
// instance the bundle sees.
// ---------------------------------------------------------------------------

const VSCODE_STUB = `
const calls = { commands: [], profiles: [], views: [], created: [], errors: [], infos: [], executed: [], configGets: [],
    terminals: [], sendTexts: [], statusItems: [], statusShown: [], statusHidden: [], statusDisposed: 0,
    shellIntegrationHandlers: [], executionStartHandlers: [], executionEndHandlers: [] };

// Mirrors the real semantics: getConfiguration(section) hands back the subtree
// at \`section\`, and get(key) walks the (dotted) key RELATIVE to that subtree.
// A key that repeats the section (\`multiHarness.x.y\` under section
// \`multiHarness\`) therefore resolves to undefined — exactly like VS Code,
// where ExtHostConfiguration#get does lookUp(sectionSubtree, key) and
// getConfigurationValue walks the parts without stripping a repeated prefix.
const FIXTURE = {
    multiHarness: {
        notifyOnExit: false,
        launchMode: "direct",
        ohMyPi: { executablePath: "/custom/omp", arguments: ["--continue"] },
        pi: { executablePath: "/custom/missing-cli", arguments: [] },
    },
};

function walk(tree, key) {
    let node = tree;
    for (const part of String(key).split(".")) {
        if (node === undefined || node === null || typeof node !== "object") {
            return undefined;
        }
        node = node[part];
    }
    return node;
}

function getConfiguration(section, _scope) {
    const base = section ? walk(FIXTURE, section) : FIXTURE;
    return {
        get(key, fallback) {
            calls.configGets.push({ section, key });
            const value = walk(base, key);
            return value === undefined ? fallback : value;
        },
        has(key) { return walk(base, key) !== undefined; },
    };
}

module.exports = {
    __calls: calls,
    __fixture: FIXTURE,
    StatusBarAlignment: { Left: 1, Right: 2 },
    commands: {
        registerCommand(id, handler) { calls.commands.push({ id, handler }); return { dispose() {} }; },
        executeCommand(...args) { calls.executed.push(...args); return Promise.resolve(); },
    },
    window: {
        terminals: [],
        activeTerminal: undefined,
        activeTextEditor: undefined,
        registerTerminalProfileProvider(id, provider) { calls.profiles.push({ id, provider }); return { dispose() {} }; },
        registerTreeDataProvider(id, provider) {
            const view = { id, provider, disposed: false };
            calls.views.push(view);
            return { dispose() { view.disposed = true; } };
        },
        onDidCloseTerminal() { return { dispose() {} }; },
        showQuickPick() { return Promise.resolve(undefined); },
        showErrorMessage(message) { calls.errors.push(message); return Promise.resolve(undefined); },
        showInformationMessage(message) { calls.infos.push(message); return Promise.resolve(undefined); },
        createTerminal(options) {
            const terminal = {
                name: options.name,
                shellIntegration: undefined,
                shown: 0,
                show() { this.shown += 1; },
                sendText(text) { calls.sendTexts.push({ name: options.name, text }); },
                dispose() {},
            };
            calls.created.push({ options, terminal });
            calls.terminals.push(terminal);
            return terminal;
        },
        createStatusBarItem(alignment) {
            const item = {
                alignment,
                text: "",
                visible: false,
                show() { this.visible = true; calls.statusShown.push(this.text); },
                hide() { this.visible = false; calls.statusHidden.push(this.text); },
                dispose() { calls.statusDisposed += 1; },
            };
            calls.statusItems.push(item);
            return item;
        },
        // shell-integration API family (1.93+): handlers are recorded so the
        // test can fire them, mirroring VS Code 1.93's relative-lookup world.
        onDidChangeTerminalShellIntegration(handler) { calls.shellIntegrationHandlers.push(handler); return { dispose() {} }; },
        onDidStartTerminalShellExecution(handler) { calls.executionStartHandlers.push(handler); return { dispose() {} }; },
        onDidEndTerminalShellExecution(handler) { calls.executionEndHandlers.push(handler); return { dispose() {} }; },
    },
    workspace: { workspaceFolders: [], getWorkspaceFolder() { return undefined; }, getConfiguration },
    Uri: { joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join("/"), path: parts.join("/") }) },
    ViewColumn: { Beside: -2 },
    TerminalProfile: class TerminalProfile { constructor(options) { this.options = options; } },
};
`;

const manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const contributedCommands = manifest.contributes.commands.map((c) => c.command).sort();
const contributedProfiles = manifest.contributes.terminal.map((t) => t.id).sort();

const activationDir = mkdtempSync(join(tmpdir(), "mhte-activate-"));
try {
    await build({
        entryPoints: [join(projectRoot, "src", "extension.ts")],
        outfile: join(activationDir, "extension.cjs"),
        bundle: true,
        format: "cjs",
        platform: "node",
        external: ["vscode"],
        logLevel: "silent",
    });
    const stubDir = join(activationDir, "node_modules", "vscode");
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(join(stubDir, "package.json"), JSON.stringify({ name: "vscode", main: "index.js" }));
    writeFileSync(join(stubDir, "index.js"), VSCODE_STUB);

    const { createRequire } = await import("node:module");
    const requireFrom = createRequire(join(activationDir, "loader.cjs"));
    const vscodeStub = requireFrom(join(stubDir, "index.js"));
    const extension = requireFrom(join(activationDir, "extension.cjs"));

    const context = {
        subscriptions: [],
        extensionUri: { fsPath: join(projectRoot) },
        extensionPath: join(projectRoot),
    };
    extension.activate(context);

    // The configured path must exist to reach createTerminal, so point the
    // fixture at a real temp executable (the stub exposes the live fixture).
    const fakeCli = join(activationDir, "custom-omp");
    writeFileSync(fakeCli, "#!/bin/sh\n");
    chmodSync(fakeCli, 0o755);
    vscodeStub.__fixture.multiHarness.ohMyPi.executablePath = fakeCli;

    const registeredCommands = vscodeStub.__calls.commands.map((c) => c.id).sort();
    const registeredProfiles = vscodeStub.__calls.profiles.map((p) => p.id).sort();

    assert.deepEqual(
        registeredCommands,
        contributedCommands,
        `registered command ids must equal the contributed ids exactly (got ${JSON.stringify(registeredCommands)})`
    );
    assert.deepEqual(
        registeredProfiles,
        contributedProfiles,
        `registered terminal profile ids must equal the contributed ids exactly (got ${JSON.stringify(registeredProfiles)})`
    );
    passed += 1;
    console.log(`ok: activation registers exactly the ${contributedCommands.length} contributed command ids`);

    // The sidebar lists every harness even while editor-title icons are disabled.
    assert.equal(vscodeStub.__calls.views.length, 1);
    const agentsView = vscodeStub.__calls.views[0];
    assert.equal(agentsView.id, manifest.contributes.views.multiHarness[0].id);
    const agents = agentsView.provider.getChildren();
    assert.equal(agents.length, contributedProfiles.length);
    assert.deepEqual(
        agents.map((agent) => agentsView.provider.getTreeItem(agent).command.command).sort(),
        contributedCommands.filter((id) => !["multiHarness.openAgentPicker", "multiHarness.openSettings"].includes(id))
    );
    for (const agent of agents) {
        const item = agentsView.provider.getTreeItem(agent);
        assert.equal(item.id, agent.id);
        assert.equal(item.label, agent.displayName);
        assert.deepEqual(agentsView.provider.getChildren(agent), []);
        for (const theme of ["light", "dark"]) {
            assert.equal(item.iconPath[theme].fsPath, join(projectRoot, "media", `${agent.id}-${theme}.svg`));
            assert.ok(existsSync(item.iconPath[theme].fsPath));
        }
    }
    const sidebarItem = agentsView.provider.getTreeItem(agents.find((agent) => agent.id === "ohMyPi"));
    await vscodeStub.__calls.commands.find((command) => command.id === sidebarItem.command.command).handler();
    assert.equal(vscodeStub.__calls.created.at(-1)?.options.shellPath, fakeCli);
    assert.deepEqual(vscodeStub.__calls.created.at(-1)?.options.shellArgs, ["--continue"]);
    passed += 1;
    console.log("ok: Activity Bar lists all harnesses with themed icons and launches through configured commands");

    // The user's click path: the handler registered for the literal id must run
    // without throwing (resolution failure is fine — it reports an error).
    const ohMyPi = vscodeStub.__calls.commands.find((c) => c.id === "multiHarness.openOhMyPi");
    assert.ok(ohMyPi, "multiHarness.openOhMyPi must be registered under its literal contributed id");
    await ohMyPi.handler();
    assert.ok(
        vscodeStub.__calls.created.length > 0 || vscodeStub.__calls.errors.length > 0,
        "the openOhMyPi handler must either create a terminal or report a resolution error"
    );
    passed += 1;
    console.log("ok: invoking multiHarness.openOhMyPi runs the real open path without throwing");

    // Settings plumbing: reads must use the SECTION-RELATIVE key, otherwise the
    // value silently falls back to the default (the double-prefix bug).
    vscodeStub.__calls.created.length = 0;
    vscodeStub.__calls.configGets.length = 0;
    vscodeStub.window.terminals.length = 0;
    await ohMyPi.handler();
    const readKeys = vscodeStub.__calls.configGets.map((c) => `${c.section}|${c.key}`);
    assert.ok(
        readKeys.includes("multiHarness|ohMyPi.executablePath"),
        `settings must be read with the section-relative key (saw ${JSON.stringify(readKeys)})`
    );
    assert.ok(
        readKeys.includes("multiHarness|ohMyPi.arguments"),
        `arguments must be read with the section-relative key (saw ${JSON.stringify(readKeys)})`
    );
    assert.ok(
        !readKeys.some((k) => k.includes("multiHarness|multiHarness.")),
        `no read may repeat the section prefix (saw ${JSON.stringify(readKeys)})`
    );
    const created = vscodeStub.__calls.created.at(-1)?.options;
    assert.equal(created?.shellPath, fakeCli, `createTerminal must use the configured executablePath (got ${created?.shellPath})`);
    assert.deepEqual(created?.shellArgs, ["--continue"], "createTerminal must use the configured arguments");
    passed += 1;
    console.log("ok: configured executablePath and arguments are read with relative keys and reach createTerminal");

    // The Open Settings path must use the FULL id (that API wants the complete key).
    vscodeStub.__calls.executed.length = 0;
    vscodeStub.window.showErrorMessage = (message) => {
        vscodeStub.__calls.errors.push(message);
        return Promise.resolve("Open Settings");
    };
    const piHarness = vscodeStub.__calls.commands.find((c) => c.id === "multiHarness.openPi");
    await piHarness.handler();
    assert.deepEqual(
        vscodeStub.__calls.executed,
        ["workbench.action.openSettings", "multiHarness.pi.executablePath"],
        `Open Settings must receive the fully-qualified id (saw ${JSON.stringify(vscodeStub.__calls.executed)})`
    );
    passed += 1;
    console.log("ok: unresolved executable opens settings with the fully-qualified setting id");

    // Picker forwards to the literal ids too.
    const picker = vscodeStub.__calls.commands.find((c) => c.id === "multiHarness.openAgentPicker");
    assert.ok(picker, "multiHarness.openAgentPicker is registered");
    vscodeStub.__calls.executed.length = 0;
    vscodeStub.window.showQuickPick = () =>
        Promise.resolve({ label: "Oh My Pi", harness: { commandId: "multiHarness.openOhMyPi" } });
    await picker.handler();
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.openOhMyPi"], "picker dispatches the harness commandId");
    passed += 1;
    console.log("ok: agent picker dispatches the harness commandId");

    const settings = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.openSettings");
    vscodeStub.__calls.executed.length = 0;
    await settings.handler();
    assert.deepEqual(vscodeStub.__calls.executed, [
        "workbench.action.openSettings",
        `@ext:${manifest.publisher}.${manifest.name}`,
    ], "settings button opens settings filtered to this extension");
    passed += 1;
    console.log("ok: settings button opens only Multi-Harness settings");

    // -----------------------------------------------------------------------
    // Shell mode + status surface.
    //
    // Older runtimes matter here: VS Code 1.93 (first release with shell
    // integration) ships Electron 30.4.0 / Node 20.15.1, which has no
    // Promise.withResolvers. Delete it from the globals so the whole block runs
    // like Node 20 would, and restore it afterwards.
    // -----------------------------------------------------------------------
    const realWithResolvers = Promise.withResolvers;
    delete Promise.withResolvers;
    assert.equal(typeof Promise.withResolvers, "undefined", "the test really runs without Promise.withResolvers");

    // (i) direct mode is unchanged: the terminal has shellPath and nothing in
    // this mode touches the status bar or the shell-integration API.
    const baseline = () => {
        vscodeStub.__calls.created.length = 0;
        vscodeStub.__calls.statusItems.length = 0;
        vscodeStub.__calls.sendTexts.length = 0;
        vscodeStub.__calls.executed.length = 0;
        vscodeStub.__calls.infos.length = 0;
        vscodeStub.window.terminals.length = 0;
        vscodeStub.__fixture.multiHarness.launchMode = "direct";
    };
    baseline();
    await ohMyPi.handler();
    const directOptions = vscodeStub.__calls.created.at(-1)?.options;
    assert.equal(directOptions?.shellPath, fakeCli, "direct mode must still set shellPath");
    assert.equal(vscodeStub.__calls.statusItems.length, 0, "direct mode must not create a status-bar item");
    assert.equal(vscodeStub.__calls.infos.length, 0, "direct mode must not announce shell-integration fallback");
    passed += 1;
    console.log("ok: direct mode sets shellPath and never creates a status-bar item");

    // (ii) shell mode: no shellPath, and the agent runs through the two-argument
    // executeCommand overload once shell integration activates.
    baseline();
    vscodeStub.__fixture.multiHarness.launchMode = "shell";
    const shellPromise = ohMyPi.handler();
    await new Promise((resolve) => setImmediate(resolve));
    const shellOptions = vscodeStub.__calls.created.at(-1)?.options;
    assert.ok(shellOptions, "shell mode must create a terminal");
    assert.equal(shellOptions.shellPath, undefined, "shell mode must not override shellPath");
    assert.equal(shellOptions.name, "Oh My Pi", "shell mode keeps the terminal name");
    assert.equal(shellOptions.cwd, homedir(), "shell mode uses the same cwd resolution as direct mode (homedir without a workspace)");
    assert.equal(vscodeStub.__calls.statusItems.length, 1, "the first shell-mode terminal creates the status item lazily");
    const shellTerminal = vscodeStub.__calls.created.at(-1).terminal;
    const shellExecuteCalls = [];
    shellTerminal.shellIntegration = undefined;
    vscodeStub.__calls.shellIntegrationHandlers.forEach((handler) =>
        handler({
            terminal: shellTerminal,
            shellIntegration: {
                cwd: undefined,
                executeCommand(executable, args) {
                    shellExecuteCalls.push({ executable, args });
                    return { commandLine: `${executable} ${args.join(" ")}` };
                },
            },
        })
    );
    await shellPromise;
    assert.deepEqual(
        shellExecuteCalls,
        [{ executable: fakeCli, args: ["--continue"] }],
        `shell mode must call executeCommand(executable, args) — saw ${JSON.stringify(shellExecuteCalls)}`
    );
    assert.deepEqual(vscodeStub.__calls.sendTexts, [], "no sendText fallback on the happy path");
    passed += 1;
    console.log("ok: shell mode omits shellPath and runs the agent via executeCommand(executable, args)");

    // (iii) start/end events drive the status-bar text.
    const statusItem = vscodeStub.__calls.statusItems.at(-1);
    const execution = { commandLine: "omp --continue" };
    const integration = shellTerminal.shellIntegration ?? { cwd: undefined, executeCommand: () => execution };
    vscodeStub.__calls.executionStartHandlers.forEach((handler) =>
        handler({ terminal: shellTerminal, shellIntegration: integration, execution })
    );
    assert.equal(statusItem.text, "$(sync~spin) Oh My Pi", `start text (saw ${statusItem.text})`);
    assert.equal(statusItem.visible, true, "status item is shown while running");
    vscodeStub.__calls.executionEndHandlers.forEach((handler) =>
        handler({ terminal: shellTerminal, shellIntegration: integration, execution, exitCode: 0 })
    );
    assert.ok(statusItem.text.startsWith("$(check) Oh My Pi — "), `end text (saw ${statusItem.text})`);
    assert.ok(statusItem.text.endsWith("(exit 0)"), `end text carries the exit code (saw ${statusItem.text})`);
    // undefined exit code must show "exit ?"
    const unknownExecution = { commandLine: "omp" };
    vscodeStub.__calls.executionStartHandlers.forEach((handler) =>
        handler({ terminal: shellTerminal, shellIntegration: integration, execution: unknownExecution })
    );
    vscodeStub.__calls.executionEndHandlers.forEach((handler) =>
        handler({ terminal: shellTerminal, shellIntegration: integration, execution: unknownExecution, exitCode: undefined })
    );
    assert.ok(statusItem.text.startsWith("$(error) Oh My Pi — "), `unknown-exit text (saw ${statusItem.text})`);
    assert.ok(statusItem.text.endsWith("(exit ?)"), `unknown exit code renders as ? (saw ${statusItem.text})`);
    passed += 1;
    console.log("ok: start/end shell executions drive the status-bar text (exit code included)");

    // (iv) the timeout path degrades to a quoted sendText plus one message.
    baseline();
    vscodeStub.__fixture.multiHarness.launchMode = "shell";
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const pendingTimeouts = [];
    globalThis.setTimeout = (callback, delay) => {
        pendingTimeouts.push({ callback, delay });
        return { __fake: true };
    };
    globalThis.clearTimeout = () => {};
    const fallbackPromise = ohMyPi.handler();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(vscodeStub.__calls.sendTexts.length, 0, "nothing is sent before the timeout fires");
    assert.ok(pendingTimeouts.length >= 1, "shell mode arms the integration timeout");
    assert.equal(pendingTimeouts[0].delay, 10000, `integration timeout is 10s (saw ${pendingTimeouts[0].delay})`);
    pendingTimeouts[0].callback();
    await fallbackPromise;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    const sendText = vscodeStub.__calls.sendTexts.at(-1)?.text ?? "";
    assert.equal(sendText, `'${fakeCli}' '--continue'`, `fallback quoting rule (saw ${sendText})`);
    assert.equal(vscodeStub.__calls.infos.length, 1, "exactly one information message on the degrade path");
    assert.ok(
        /status tracking is unavailable/i.test(vscodeStub.__calls.infos[0]),
        `degrade message explains the limitation (saw ${vscodeStub.__calls.infos[0]})`
    );
    passed += 1;
    console.log("ok: shell mode without integration falls back to a quoted command line with one message");

    Promise.withResolvers = realWithResolvers;
    passed += 1;
    console.log("ok: shell mode works on runtimes without Promise.withResolvers (Node 20 / VS Code 1.93)");

    // Disposing the extension must cancel the pending status-hide timer —
    // otherwise this very test would sit on the 30s timer before exiting.
    for (const subscription of context.subscriptions) {
        subscription.dispose();
    }
    assert.equal(vscodeStub.__calls.statusDisposed, 1, "dispose() disposes the status-bar item");
    passed += 1;
    console.log("ok: disposing the extension cancels the pending status timer and disposes the item");
    assert.equal(agentsView.disposed, true, "extension disposal unregisters the Activity Bar provider");
} catch (error) {
    console.error(`FAIL: headless activation test — ${error.message}`);
    process.exit(1);
} finally {
    rmSync(activationDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Icon sanity: standalone 16px assets, brand colors and themed foregrounds.
// ---------------------------------------------------------------------------

const HARNESS_IDS = manifest.contributes.terminal.map((t) => t.id.replace("multiHarness.", ""));
const iconSources = JSON.parse(readFileSync(join(projectRoot, "media", "sources", "icons.json"), "utf8"));
assert.deepEqual(Object.keys(iconSources), HARNESS_IDS, "every harness has an attributed icon source");
execFileSync(process.execPath, [join(here, "gen-icons.mjs"), "--check"], { stdio: "inherit" });

function relativeLuminance(hex) {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

const fillReport = [];
for (const id of HARNESS_IDS) {
    const fills = {};
    for (const theme of ["light", "dark"]) {
        const file = join(projectRoot, "media", `${id}-${theme}.svg`);
        const svg = readFileSync(file, "utf8");
        assert.ok(svg.includes('viewBox="0 0 16 16"'), `${id}-${theme}.svg must declare viewBox="0 0 16 16"`);
        assert.ok(svg.includes('width="16" height="16"'), `${id}-${theme}.svg must declare width="16" height="16"`);
        assert.ok(!svg.includes("<text"), `${id}-${theme}.svg must not use <text> (font-dependent rendering)`);
        assert.ok(!/<(?:script|foreignObject)\b/i.test(svg), `${id}-${theme}.svg must be a static image`);
        assert.ok(!/(?:href|src)="(?!#|data:image\/png;base64,)/i.test(svg), `${id}-${theme}.svg must not load external assets`);
        assert.ok(!svg.includes("currentColor"), `${id}-${theme}.svg must resolve foreground colors explicitly`);
        const hexes = [...new Set(svg.match(/#[0-9a-fA-F]{6}/g) ?? [])];
        assert.ok(hexes.length > 0, `${id}-${theme}.svg must use an explicit fill/stroke color`);
        const luminance = relativeLuminance(hexes[0]);
        if (!iconSources[id].themeColors) {
            // Full-color application icons retain their original palette in both themes.
            assert.ok(svg.includes("<image") || svg.includes("<path"), `${id}-${theme}.svg contains brand artwork`);
        } else if (theme === "light") {
            assert.ok(luminance < 0.5, `${id}-light.svg must use a dark fill (got ${hexes[0]}, L=${luminance.toFixed(3)})`);
        } else {
            assert.ok(luminance > 0.5, `${id}-dark.svg must use a light fill (got ${hexes[0]}, L=${luminance.toFixed(3)})`);
        }
        fills[theme] = hexes[0];
    }
    fillReport.push(`${id}: light=${fills.light} dark=${fills.dark}`);
}
passed += 1;
console.log(`ok: all ${HARNESS_IDS.length * 2} SVGs are standalone 16px assets with brand colors or themed foregrounds`);
console.log(`\nicon fills (light variant = dark ink, dark variant = light ink):\n  ${fillReport.join("\n  ")}`);

await import(pathToFileURL(join(here, "validate-manifest.mjs")).href);

console.log(`\n${passed} test group(s) passed and manifest validation passed.`);
