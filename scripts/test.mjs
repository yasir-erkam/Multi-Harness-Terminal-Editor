// Unit tests: resolveExecutable (pure node module, esbuild-bundled on the fly)
// plus the full manifest validation from validate-manifest.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import process from "node:process";

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
const calls = { commands: [], profiles: [], created: [], errors: [], executed: [] };
module.exports = {
    __calls: calls,
    commands: {
        registerCommand(id, handler) { calls.commands.push({ id, handler }); return { dispose() {} }; },
        executeCommand(id) { calls.executed.push(id); return Promise.resolve(); },
    },
    window: {
        terminals: [],
        activeTerminal: undefined,
        activeTextEditor: undefined,
        registerTerminalProfileProvider(id, provider) { calls.profiles.push({ id, provider }); return { dispose() {} }; },
        onDidCloseTerminal() { return { dispose() {} }; },
        showQuickPick() { return Promise.resolve(undefined); },
        showErrorMessage(message) { calls.errors.push(message); return Promise.resolve(undefined); },
        showInformationMessage() { return Promise.resolve(undefined); },
        createTerminal(options) { calls.created.push(options); return { show() {} }; },
    },
    workspace: {
        workspaceFolders: [],
        getWorkspaceFolder() { return undefined; },
        getConfiguration() { return { get: (_key, fallback) => fallback }; },
    },
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
} catch (error) {
    console.error(`FAIL: headless activation test — ${error.message}`);
    process.exit(1);
} finally {
    rmSync(activationDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Icon sanity: 16x16 viewport, no font-dependent <text>, correct theme fills.
// ---------------------------------------------------------------------------

const HARNESS_IDS = manifest.contributes.terminal.map((t) => t.id.replace("multiHarness.", ""));

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
        const hexes = [...new Set(svg.match(/#[0-9a-fA-F]{6}/g) ?? [])];
        assert.ok(hexes.length > 0, `${id}-${theme}.svg must use an explicit fill/stroke color`);
        const luminance = relativeLuminance(hexes[0]);
        if (theme === "light") {
            assert.ok(luminance < 0.5, `${id}-light.svg must use a dark fill (got ${hexes[0]}, L=${luminance.toFixed(3)})`);
        } else {
            assert.ok(luminance > 0.5, `${id}-dark.svg must use a light fill (got ${hexes[0]}, L=${luminance.toFixed(3)})`);
        }
        fills[theme] = hexes[0];
    }
    fillReport.push(`${id}: light=${fills.light} dark=${fills.dark}`);
}
passed += 1;
console.log(`ok: all ${HARNESS_IDS.length * 2} SVGs are 16x16, text-free, with theme-correct fills`);
console.log(`\nicon fills (light variant = dark ink, dark variant = light ink):\n  ${fillReport.join("\n  ")}`);

await import(pathToFileURL(join(here, "validate-manifest.mjs")).href);

console.log(`\n${passed} test group(s) passed and manifest validation passed.`);
