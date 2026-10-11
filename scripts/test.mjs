// Unit tests: resolveExecutable (pure node module, esbuild-bundled on the fly)
// plus the full manifest validation from validate-manifest.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
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

await import(pathToFileURL(join(here, "validate-manifest.mjs")).href);

console.log(`\n${passed} resolveExecutable test(s) passed and manifest validation passed.`);
