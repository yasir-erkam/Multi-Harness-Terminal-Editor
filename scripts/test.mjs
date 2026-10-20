// Unit tests: resolveExecutable (pure node module, esbuild-bundled on the fly)
// plus the full manifest validation from validate-manifest.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, utimesSync, symlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, sep, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { zstdCompressSync } from "node:zlib";

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
await build({
    entryPoints: [join(projectRoot, "src", "resolveExecutable.ts")],
    outfile: join(outdir, "resolveExecutable.windows.test.mjs"),
    bundle: true, format: "esm", platform: "node", logLevel: "silent",
    define: { "process.platform": '"win32"' },
});
const { resolveExecutable: resolveWindowsExecutable } = await import(pathToFileURL(join(outdir, "resolveExecutable.windows.test.mjs")).href);

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

function fileSymlink(target, link) {
    try {
        symlinkSync(target, link, "file");
        return true;
    } catch (error) {
        if (process.platform !== "win32" || error.code !== "EPERM") throw error;
        console.log("skip: file-symlink scenario requires Windows Developer Mode or elevation");
        return false;
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
test("Prime Agent resolves from its default local-bin install directory without PATH", (dir) => {
    const bin = join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, "prime-agent");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    assert.equal(resolveExecutable("prime-agent", { platform: "linux", user: { home: dir } }), executable);
});

test("Antigravity CLI resolves from its Linux/macOS local-bin install without PATH", (dir) => {
    const bin = join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, "agy");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    for (const platform of ["linux", "darwin"]) {
        assert.equal(resolveExecutable("agy", { platform, user: { home: dir } }), executable);
    }
});

test("Antigravity CLI resolves its Windows installer directory without PATH", (dir) => {
    const bin = join(dir, "AppData", "Local", "agy", "bin");
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, "agy.exe");
    writeFileSync(executable, "binary");
    assert.equal(resolveWindowsWithoutPath("agy", {
        user: { home: dir, localAppData: join(dir, "AppData", "Local") },
    }), executable);
    const override = join(dir, "custom-agy.exe");
    writeFileSync(override, "binary");
    assert.equal(resolveWindowsExecutable(override, {
        user: { home: dir, localAppData: join(dir, "AppData", "Local") },
    }), override);
});

test("Antigravity agy resolves from ~/.local/bin with an empty PATH", (dir) => {
    const bin = join(dir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, "agy");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    const originalPath = process.env.PATH;
    try {
        process.env.PATH = "";
        assert.equal(resolveExecutable("agy", { platform: "linux", user: { home: dir } }), executable);
    } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
    }
});

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
    if (process.platform === "win32") return; // Windows does not enforce POSIX executable bits.
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

test("Windows host searches npm user directory without an explicit platform option", (dir) => {
    const appData = join(dir, "AppData", "Roaming");
    const bin = join(appData, "npm");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "codex.cmd"), "@echo off\n");
    assert.equal(resolveWindowsExecutable("codex", { user: { home: dir, appData } }), join(bin, "codex.cmd"));
});

function fnmFixture(dir) {
    const appData = join(dir, "AppData", "Roaming");
    const localAppData = join(dir, "AppData", "Local");
    return { home: dir, appData, localAppData, fnmDir: join(appData, "fnm") };
}

function installFnmCli(root, version) {
    const bin = join(root, "node-versions", version, "installation");
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, "codex.cmd");
    writeFileSync(executable, "@echo off\n");
    return executable;
}

function resolveWindowsWithoutPath(target, options) {
    const previous = process.env.PATH;
    process.env.PATH = "";
    try {
        return resolveWindowsExecutable(target, options);
    } finally {
        if (previous === undefined) delete process.env.PATH;
        else process.env.PATH = previous;
    }
}

test("Windows fnm discovery finds a CLI installed after an unsuccessful lookup", (dir) => {
    const user = fnmFixture(dir);
    const options = { user };
    assert.equal(resolveWindowsWithoutPath("codex", options), undefined);
    const executable = installFnmCli(user.fnmDir, "v22.10.0");
    assert.equal(resolveWindowsWithoutPath("codex", options), executable);
});

test("Windows fnm discovery honors a custom FNM_DIR environment variable", (dir) => {
    const user = fnmFixture(dir);
    delete user.fnmDir;
    const root = join(dir, "custom-fnm");
    const executable = installFnmCli(root, "v22.10.0");
    const previous = process.env.FNM_DIR;
    process.env.FNM_DIR = root;
    try {
        assert.equal(resolveWindowsWithoutPath("codex", { user }), executable);
    } finally {
        if (previous === undefined) delete process.env.FNM_DIR;
        else process.env.FNM_DIR = previous;
    }
});

test("Windows fnm discovery resolves the default junction before newer versions", (dir) => {
    const user = fnmFixture(dir);
    const executable = installFnmCli(user.fnmDir, "v20.10.0");
    installFnmCli(user.fnmDir, "v22.10.0");
    mkdirSync(join(user.fnmDir, "aliases"), { recursive: true });
    symlinkSync(dirname(executable), join(user.fnmDir, "aliases", "default"), "junction");
    assert.equal(resolveWindowsWithoutPath("codex", { user }), executable);
});

test("Windows fnm fallback selects the newest installed version numerically", (dir) => {
    const user = fnmFixture(dir);
    installFnmCli(user.fnmDir, "v22.9.0");
    const executable = installFnmCli(user.fnmDir, "v22.10.0");
    assert.equal(resolveWindowsWithoutPath("codex", { user }), executable);
});

test("Windows fnm fallback preserves PATH precedence", (dir) => {
    const user = fnmFixture(dir);
    installFnmCli(user.fnmDir, "v22.10.0");
    const executable = join(dir, "codex.cmd");
    writeFileSync(executable, "@echo off\n");
    const previous = process.env.PATH;
    process.env.PATH = dir;
    try {
        assert.equal(resolveWindowsExecutable("codex", { user }), executable);
    } finally {
        if (previous === undefined) delete process.env.PATH;
        else process.env.PATH = previous;
    }
});

test("Windows fnm fallback handles LocalAppData, legacy roots and broken defaults", (dir) => {
    for (const location of ["local", "legacy"]) {
        const home = join(dir, location);
        const user = fnmFixture(home);
        const root = location === "local" ? join(user.localAppData, "fnm") : join(home, ".fnm");
        const executable = installFnmCli(root, "v22.10.0");
        mkdirSync(join(root, "aliases"), { recursive: true });
        symlinkSync(join(root, "missing"), join(root, "aliases", "default"), "junction");
        assert.equal(resolveWindowsWithoutPath("codex", { user }), executable);
        assert.equal(resolveWindowsWithoutPath(join(home, "missing", "codex"), { user }), undefined);
    }
});

// ---------------------------------------------------------------------------
// Saved conversation discovery is tested independently from open terminals.
await build({
    entryPoints: [join(projectRoot, "src", "savedSessions.ts")],
    outfile: join(outdir, "savedSessions.test.mjs"),
    bundle: true, format: "esm", platform: "node", logLevel: "silent",
});
const { scanSavedSessions, resumeArguments, sessionRoots, supportsSessionDeletion } = await import(pathToFileURL(join(outdir, "savedSessions.test.mjs")).href);
await build({
    entryPoints: [join(projectRoot, "src", "deleteSession.ts")],
    outfile: join(outdir, "deleteSession.test.mjs"),
    bundle: true, format: "esm", platform: "node", logLevel: "silent",
});
const { validateSessionDeletion } = await import(pathToFileURL(join(outdir, "deleteSession.test.mjs")).href);
const deletionDir = mkdtempSync(join(tmpdir(), "mhte-delete-"));
try {
    const roots = sessionRoots(deletionDir, {});
    for (const root of roots.filter((root) => supportsSessionDeletion(root.harnessId))) {
        mkdirSync(root.directory, { recursive: true });
        const id = `delete-${root.harnessId}`;
        const header = root.harnessId === "codex" ? { type: "session_meta", payload: { id, cwd: deletionDir } }
            : root.harnessId === "claudeCode" ? { type: "user", sessionId: id, cwd: deletionDir }
            : { type: "session", id, cwd: deletionDir };
        const file = join(root.directory, "session.jsonl");
        writeFileSync(file, JSON.stringify(header) + "\n");
        const [session] = (await scanSavedSessions([root])).sessions;
        await validateSessionDeletion(session, roots);
        const moved = root.harnessId === "codex" ? { ...header, payload: { ...header.payload, cwd: root.directory } }
            : { ...header, cwd: root.directory };
        writeFileSync(file, JSON.stringify(moved) + "\n");
        await assert.rejects(validateSessionDeletion(session, roots), /record changed/);
        // Detect another conversation even outside the bounded metadata window.
        const foreign = root.harnessId === "codex" ? { type: "session_meta", payload: { id: "other" } }
            : root.harnessId === "claudeCode" ? { sessionId: "other" }
            : { type: "session", id: "other" };
        writeFileSync(file, JSON.stringify(header) + "\n" + "{}\n".repeat(100_000) + JSON.stringify(foreign) + "\n");
        await assert.rejects(validateSessionDeletion(session, roots), /another conversation/);
        assert.ok(existsSync(file));
        writeFileSync(file, JSON.stringify(foreign) + "\n");
        await assert.rejects(validateSessionDeletion(session, roots), /another conversation/);
        const outside = join(deletionDir, `outside-${root.harnessId}.jsonl`);
        writeFileSync(outside, JSON.stringify(header) + "\n");
        await assert.rejects(validateSessionDeletion({ ...session, file: outside }, roots), /outside/);
        rmSync(file);
        if (fileSymlink(outside, file)) {
            await assert.rejects(validateSessionDeletion(session, roots), /regular JSONL/);
        }
    }
    const dshRoot = roots.find((root) => root.harnessId === "deepseek");
    const zstdFile = join(dshRoot.directory, "session.v4.jsonl.zstd");
    const zstdHeader = Buffer.concat([
        zstdCompressSync(Buffer.from(JSON.stringify({ type: "session", version: 4, id: "delete-zstd", cwd: deletionDir }) + "\n")),
        zstdCompressSync(Buffer.from(JSON.stringify({ type: "session/title", seq: 0, data: { title: "Zstd session" } }) + "\n")),
    ]);
    writeFileSync(zstdFile, zstdHeader);
    const [zstdSession] = (await scanSavedSessions([dshRoot])).sessions;
    assert.equal(zstdSession.id, "delete-zstd");
    await validateSessionDeletion(zstdSession, roots);
    await assert.rejects(validateSessionDeletion({ ...zstdSession, harnessId: "pi" }, roots), /regular JSONL/);
    writeFileSync(zstdFile, Buffer.concat([
        zstdHeader,
        zstdCompressSync(Buffer.from(JSON.stringify({ type: "session", id: "other", cwd: deletionDir }) + "\n")),
    ]));
    await assert.rejects(validateSessionDeletion(zstdSession, roots), /another conversation/);
    writeFileSync(zstdFile, Buffer.concat([zstdHeader, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])]));
    await assert.rejects(validateSessionDeletion(zstdSession, roots), /record changed/);
    passed += 1;
    console.log("ok: all six session stores validate identity (including multi-frame .jsonl.zstd), reject shared/replaced files and prevent deletion outside their roots");
} finally {
    rmSync(deletionDir, { recursive: true, force: true });
}
const datedDir = mkdtempSync(join(tmpdir(), "mhte-dated-"));
try {
    const writeDated = (id, timestamp, mtime) => {
        const file = join(datedDir, `${id}.jsonl`);
        writeFileSync(file, [
            { type: "session", id, cwd: datedDir, timestamp: "2026-01-01T00:00:00Z" },
            { type: "message", timestamp, message: { role: "assistant", content: "Answer" } },
            { type: "session_info", name: id, timestamp: "2026-10-19T23:00:00Z" },
        ].map(JSON.stringify).join("\n"));
        utimesSync(file, mtime / 1000, mtime / 1000);
    };
    writeDated("renamed-old", "2026-10-17T20:00:00Z", Date.parse("2026-10-19T00:00:00Z"));
    writeDated("latest-message", "2026-10-18T20:00:00Z", Date.parse("2026-10-18T21:00:00Z"));
    const result = await scanSavedSessions([{ harnessId: "pi", directory: datedDir }], 1);
    assert.deepEqual(result.sessions.map((session) => session.id), ["latest-message"], "last message sorting must happen before the result limit, regardless of rename mtime");
    assert.equal(result.sessions[0].modified, Date.parse("2026-10-18T20:00:00Z"), "header and title timestamps must not replace the last message timestamp");
    passed += 1;
    console.log("ok: history uses last message timestamps rather than creation, title changes or file modification order");
} finally {
    rmSync(datedDir, { recursive: true, force: true });
}
const savedDir = mkdtempSync(join(tmpdir(), "mhte-saved-"));
try {
    const roots = sessionRoots(savedDir, {}).filter((root) => supportsSessionDeletion(root.harnessId));
    const fixture = (harnessId, id, cwd, title, modified) => {
        const root = roots.find((candidate) => candidate.harnessId === harnessId);
        mkdirSync(root.directory, { recursive: true });
        const file = join(root.directory, `${id}.jsonl`);
        const header = harnessId === "codex" ? { type: "session_meta", payload: { id, cwd } }
            : harnessId === "claudeCode" ? { type: "user", sessionId: id, cwd, message: { role: "user", content: title } }
            : { type: "session", id, cwd };
        const rows = [header, { type: "session_info", name: title }];
        if (harnessId === "ohMyPi") rows.unshift({ type: "title", title });
        writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + '\n{"partial":');
        utimesSync(file, modified / 1000, modified / 1000);
        return file;
    };
    const now = Date.now();
    for (const [index, root] of roots.entries()) {
        fixture(root.harnessId, `saved-${root.harnessId}`, savedDir, `${root.harnessId} conversation`, now - index * 1000);
    }
    const ompRoot = roots.find((root) => root.harnessId === "ohMyPi");
    const ompArtifacts = join(ompRoot.directory, "saved-ohMyPi");
    mkdirSync(join(ompArtifacts, "Worker"), { recursive: true });
    for (const child of ["__advisor.jsonl", "__advisor.security.jsonl", "Worker.jsonl", "Worker/Nested.jsonl"]) {
        writeFileSync(join(ompArtifacts, child), JSON.stringify({ type: "session", id: child.replace(/[^a-zA-Z]/g, ""), cwd: savedDir }) + "\n"
            + JSON.stringify({ type: "message", message: { role: "user", content: "commit" } }) + "\n");
    }
    assert.deepEqual((await scanSavedSessions([ompRoot])).sessions.map((session) => session.id), ["saved-ohMyPi"],
        "OMP advisor and nested task transcripts must not appear as independent saved sessions");
    const ompBucket = join(ompRoot.directory, "project-bucket");
    mkdirSync(ompBucket);
    const bucketSession = join(ompBucket, "bucket-session.jsonl");
    writeFileSync(bucketSession, JSON.stringify({ type: "session", id: "bucket-session", cwd: savedDir }) + "\n");
    assert.deepEqual(new Set((await scanSavedSessions([ompRoot])).sessions.map((session) => session.id)),
        new Set(["saved-ohMyPi", "bucket-session"]), "OMP project buckets remain discoverable alongside custom flat session roots");
    const orphanArtifacts = join(ompBucket, "deleted-owner");
    const orphanParent = `${orphanArtifacts}.jsonl`;
    mkdirSync(join(orphanArtifacts, "Worker"), { recursive: true });
    const ompCases = [
        { file: join(orphanArtifacts, "__advisor.jsonl"), id: "orphan-advisor", internal: true },
        { file: join(orphanArtifacts, "__advisor.security.jsonl"), id: "orphan-named-advisor", internal: true },
        { file: join(orphanArtifacts, "Worker.jsonl"), id: "orphan-worker", parentSession: orphanParent, internal: true },
        { file: join(orphanArtifacts, "Worker", "Nested.jsonl"), id: "orphan-nested", parentSession: orphanParent, internal: true },
        { file: join(ompBucket, "legitimate-fork.jsonl"), id: "legitimate-fork", parentSession: orphanParent },
        { file: join(ompBucket, "legitimate-id-fork.jsonl"), id: "legitimate-id-fork", parentSession: "deleted-owner-id" },
        { file: join(ompBucket, "legitimate-update.jsonl"), id: "legitimate-update", title: "[session update]" },
    ];
    for (const entry of ompCases) {
        writeFileSync(entry.file, [
            { type: "title", title: entry.title || "Ordinary transcript title" },
            { type: "session", version: 3, id: entry.id, cwd: savedDir, parentSession: entry.parentSession },
            { type: "message", message: { role: "user", content: "[session update]" } },
        ].map((row) => JSON.stringify(row)).join("\n") + "\n");
        utimesSync(entry.file, (now + (entry.internal ? 20000 : 10000)) / 1000, (now + (entry.internal ? 20000 : 10000)) / 1000);
    }
    const legitimateOmpIds = ["saved-ohMyPi", "bucket-session", "legitimate-fork", "legitimate-id-fork", "legitimate-update"];
    const orphanScan = await scanSavedSessions([ompRoot]);
    assert.deepEqual(new Set(orphanScan.sessions.map((session) => session.id)), new Set(legitimateOmpIds),
        "OMP internal classification survives missing owners without rejecting sibling forks, project buckets or session-update titles");
    assert.deepEqual(orphanScan.unreadable, []);
    const limitedOmpScan = await scanSavedSessions([ompRoot], 1);
    assert.equal(limitedOmpScan.sessions.length, 1,
        "newer internal transcripts must not consume the saved-session result limit");
    assert.ok(legitimateOmpIds.includes(limitedOmpScan.sessions[0].id));
    rmSync(ompBucket, { recursive: true });
    const codexRoot = roots.find((root) => root.harnessId === "codex");
    writeFileSync(join(codexRoot.directory, "..", "session_index.jsonl"), JSON.stringify({ id: "saved-codex", thread_name: "Renamed Codex conversation" }) + "\n");
    writeFileSync(join(codexRoot.directory, "invalid.jsonl"), "not JSON\n");
    fileSymlink(join(codexRoot.directory, "saved-codex.jsonl"), join(codexRoot.directory, "linked.jsonl"));
    const scan = await scanSavedSessions(roots);
    assert.equal(scan.sessions.length, 6);
    assert.deepEqual(scan.unreadable, []);
    assert.deepEqual(scan.sessions.map((session) => session.harnessId), roots.map((root) => root.harnessId));
    assert.equal(scan.sessions[0].title, "Renamed Codex conversation");
    assert.equal(scan.sessions[3].title, "ohMyPi conversation");
    assert.equal((await scanSavedSessions(roots, 2)).sessions.length, 2);
    for (const session of scan.sessions) {
        const args = resumeArguments(session);
        assert.equal(args[0], session.harnessId === "codex" ? "resume" : session.harnessId === "pi" ? "--session" : "--resume");
        assert.equal(args[1], ["codex", "claudeCode", "deepseek"].includes(session.harnessId) ? session.id : session.file);
    }
    const prime = scan.sessions.find((session) => session.harnessId === "primeAgent");
    writeFileSync(prime.file, JSON.stringify({ type: "session", id: prime.id, cwd: savedDir }) + "\n" + " ".repeat(600000) + '\n{"type":"session_info","name":"Renamed large session"}\n');
    assert.equal((await scanSavedSessions(roots)).sessions.find((session) => session.id === prime.id).title, "Renamed large session");
    writeFileSync(join(codexRoot.directory, "subagent.jsonl"), JSON.stringify({ type: "session_meta", payload: {id: "child", cwd: savedDir, source: {subagent: {}}} }) + "\n");
    assert.equal((await scanSavedSessions(roots)).sessions.length, 6);
    assert.deepEqual((await scanSavedSessions([{ harnessId: "codex", directory: join(savedDir, "missing") }])).sessions, []);
    assert.deepEqual(await scanSavedSessions([{ harnessId: "codex", directory: prime.file }]), { sessions: [], unreadable: [] }, "a session directory replaced by a file behaves like a missing store");
    assert.deepEqual((await scanSavedSessions([{ harnessId: "codex", directory: "relative-root" }])).unreadable, ["codex"]);
    const overrides = sessionRoots(savedDir, { CODEX_HOME: "~/custom-codex", PRIME_AGENT_SESSION_DIR: "~/prime-sessions", DSH_HOME: "~/custom-dsh" });
    assert.equal(overrides[0].directory, join(savedDir, "custom-codex", "sessions"));
    assert.equal(normalize(overrides[4].directory), join(savedDir, "prime-sessions"));
    assert.equal(overrides[6].directory, join(savedDir, "custom-dsh", "sessions"));
    const workspace = join(savedDir, "project");
    const sibling = join(savedDir, "project-other");
    mkdirSync(workspace);
    mkdirSync(sibling);
    fixture("codex", "matching-project", workspace, "Matching session", now - 5000);
    fixture("primeAgent", "wrong-agent", workspace, "Other agent", now);
    for (let index = 0; index < 105; index++) {
        fixture("codex", `unrelated-${index}`, sibling, "Other project", now + index);
    }
    const scoped = await scanSavedSessions(roots, 1, { harnessId: "codex", cwd: workspace });
    assert.deepEqual(scoped.sessions.map((session) => session.id), ["matching-project"], "scope filtering happens before the result limit");
    const alias = join(savedDir, "project-alias");
    symlinkSync(workspace, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal((await scanSavedSessions(roots, 100, { harnessId: "codex", cwd: alias })).sessions[0].id, "matching-project", "symlink aliases resolve to the same project");
    passed += 1;
    console.log("ok: saved sessions read real metadata independently of terminals, tolerate partial files and use provider resume arguments");

    const piRoot = roots.find((root) => root.harnessId === "pi");
    const piFile = join(piRoot.directory, "malformed-content.jsonl");
    for (const content of [
        [null, 7, {}, { type: "text", text: {} }, { type: "text", text: "Valid title" }],
        [null, { type: "text", text: 42 }],
    ]) {
        writeFileSync(piFile, [
            { type: "session", id: "malformed-content", cwd: workspace },
            { type: "message", message: { role: "user", content } },
        ].map((row) => JSON.stringify(row)).join("\n"));
        const result = await scanSavedSessions([piRoot], 100, { harnessId: "pi", cwd: workspace });
        assert.deepEqual(result.unreadable, [], "malformed blocks do not make a readable session unreadable");
        assert.equal(result.sessions.length, 1);
        assert.equal(result.sessions[0].title, content.length === 5 ? "Valid title" : "malformed-content");
    }
    passed += 1;
    console.log("ok: malformed content blocks preserve valid saved sessions and readable titles");

    const taskStore = join(savedDir, "copied-omp");
    const copiedArtifacts = join(taskStore, "copied-parent");
    mkdirSync(copiedArtifacts, { recursive: true });
    const originalParent = join(savedDir, "original-parent.jsonl");
    const writeOmp = (file, id, attribution, parentSession) => writeFileSync(file, [
        { type: "session", id, cwd: workspace, parentSession },
        { type: "message", message: { role: "user", attribution, content: "Complete assignment thoroughly: group sessions" } },
        { type: "message", message: { role: "user", attribution: "user", content: "Continue" } },
    ].map((row) => JSON.stringify(row)).join("\n"));
    writeOmp(join(copiedArtifacts, "Task.jsonl"), "copied-task", "agent", originalParent);
    writeOmp(join(taskStore, "detached-task.jsonl"), "detached-task", "agent", undefined);
    writeOmp(join(taskStore, "fork.jsonl"), "user-fork", "user", originalParent);
    writeOmp(join(taskStore, "ordinary.jsonl"), "ordinary", undefined, undefined);
    const taskScan = await scanSavedSessions([{ harnessId: "ohMyPi", directory: taskStore }]);
    assert.deepEqual(taskScan.unreadable, []);
    assert.deepEqual(taskScan.sessions.map((session) => session.id).sort(), ["ordinary", "user-fork"],
        "copied and detached agent tasks stay hidden while real forks and untagged conversations remain visible");
    passed += 1;
    console.log("ok: OMP agent-attributed task sessions stay hidden after copying without hiding user conversations");

    const changedStore = join(savedDir, "renamed-store");
    const movedStore = join(savedDir, "new-store");
    mkdirSync(changedStore);
    writeFileSync(join(changedStore, "changed-format.jsonl"), JSON.stringify({ type: "new-session-format", metadata: { id: "future", cwd: workspace } }));
    assert.deepEqual(await scanSavedSessions([{ harnessId: "pi", directory: changedStore }]), { sessions: [], unreadable: [] });
    const { renameSync } = await import("node:fs");
    renameSync(changedStore, movedStore);
    assert.deepEqual(await scanSavedSessions([{ harnessId: "pi", directory: changedStore }]), { sessions: [], unreadable: [] });
    const aborted = new AbortController();
    aborted.abort();
    assert.deepEqual(await scanSavedSessions(roots, 100, undefined, { signal: aborted.signal }), { sessions: [], unreadable: [] });
    const interrupted = new AbortController();
    const interruptedScan = scanSavedSessions(roots, 100, { harnessId: "pi", cwd: workspace }, { signal: interrupted.signal });
    interrupted.abort();
    assert.deepEqual(await interruptedScan, { sessions: [], unreadable: [] }, "cancellation during a scan returns an empty result");
    const bounded = await scanSavedSessions(roots, 100, undefined, { maxEntries: 2 });
    assert.ok(bounded.unreadable.length > 0, "bounded scans identify incomplete results");
    assert.ok(bounded.sessions.length <= 2);
    writeFileSync(join(piRoot.directory, "invalid-cwd.jsonl"), JSON.stringify({ type: "session", id: "invalid-cwd", cwd: workspace + "\0" }));
    assert.equal((await scanSavedSessions([piRoot])).sessions.some((session) => session.id === "invalid-cwd"), false);
    passed += 1;
    console.log("ok: changed stores and formats show empty history; scans support cancellation and bounded traversal");
} finally {
    rmSync(savedDir, { recursive: true, force: true });
}

const openCodeDir = mkdtempSync(join(tmpdir(), "mhte-opencode-"));
try {
    const cwd = join(openCodeDir, "project");
    mkdirSync(cwd);
    const root = { harnessId: "openCode", directory: join(openCodeDir, "data") };
    const legacy = join(root.directory, "storage", "session", "project-id");
    mkdirSync(legacy, { recursive: true });
    const legacyFile = join(legacy, "ses_legacy.json");
    writeFileSync(legacyFile, JSON.stringify({ id: "ses_legacy", directory: cwd, title: "Legacy title", time: { updated: 10 } }));
    writeFileSync(join(legacy, "partial.json"), "{");
    assert.equal((await scanSavedSessions([root])).sessions[0].file, legacyFile);
    const file = join(root.directory, "opencode.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_updated INTEGER, parent_id TEXT, time_archived INTEGER)");
    const insert = db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)");
    insert.run("ses_main", cwd, "Main title", 100, null, null);
    insert.run("ses_other", openCodeDir, "Other project", 200, null, null);
    insert.run("ses_child", cwd, "Child", 300, "ses_main", null);
    insert.run("ses_archived", cwd, "Archived", 400, null, 400);
    db.close();
    const before = readFileSync(file);
    const all = await scanSavedSessions([root]);
    assert.deepEqual(all.unreadable, []);
    assert.deepEqual(all.sessions.map((session) => session.id), ["ses_other", "ses_main"], "SQLite is authoritative over leftover legacy metadata");
    const scoped = await scanSavedSessions([root], 100, { harnessId: "openCode", cwd });
    assert.deepEqual(scoped.sessions.map((session) => session.id), ["ses_main"]);
    assert.equal(scoped.sessions[0].title, "Main title");
    assert.equal(scoped.sessions[0].modified, 100);
    assert.equal(scoped.sessions[0].file, file);
    assert.deepEqual(resumeArguments(scoped.sessions[0]), ["--session", "ses_main"]);
    assert.equal(supportsSessionDeletion("openCode"), false);
    await assert.rejects(validateSessionDeletion(scoped.sessions[0], [root]));
    assert.deepEqual(readFileSync(file), before, "OpenCode discovery never modifies its database");
    assert.equal(sessionRoots(openCodeDir, {}).find((candidate) => candidate.harnessId === "openCode").directory, join(openCodeDir, ".local", "share", "opencode"));
    assert.equal(sessionRoots(openCodeDir, { XDG_DATA_HOME: "~/xdg" }).find((candidate) => candidate.harnessId === "openCode").directory, join(openCodeDir, "xdg", "opencode"));
    writeFileSync(file, "corrupt database");
    assert.deepEqual(await scanSavedSessions([root]), { sessions: [], unreadable: ["openCode"] }, "corrupt SQLite must not resurrect stale JSON history");
    rmSync(file);
    mkdirSync(file);
    assert.deepEqual(await scanSavedSessions([root]), { sessions: [], unreadable: ["openCode"] }, "nonregular SQLite paths must not resurrect stale JSON history");
    passed += 1;
    console.log("ok: OpenCode SQLite and legacy history preserve project scope, resume IDs and read-only deletion protection");
} finally { rmSync(openCodeDir, { recursive: true, force: true }); }

function antigravityFixture(directory, cwd) {
    mkdirSync(join(directory, "conversations"), { recursive: true });
    const db = new DatabaseSync(join(directory, "conversation_summaries.db"));
    db.exec("CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, last_modified_time TEXT, workspace_uris TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, step_count INTEGER)");
    const insert = db.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const add = (id, overrides = {}) => {
        const row = { title: "Antigravity conversation", preview: "Preview", time: "2026-10-16 16:50:09.831811299+00:00", uris: JSON.stringify([pathToFileURL(cwd).href]), parent: "", depth: 0, steps: 3, ...overrides };
        insert.run(id, row.title, row.preview, row.time, row.uris, row.parent, row.depth, row.steps);
        if (!id.includes("/")) writeFileSync(join(directory, "conversations", id + ".db"), "fixture trajectory");
    };
    return { db, add };
}
const agyDir = mkdtempSync(join(tmpdir(), "mhte-agy-"));
try {
    const cwd = join(agyDir, "project with spaces");
    mkdirSync(cwd);
    const directory = join(agyDir, "store");
    const { db, add } = antigravityFixture(directory, cwd);
    try {
        add("main");
        add("preview", { title: "", time: "2026-10-15 16:50:09+00:00" });
        add("child", { parent: "main", depth: 1 });
        add("empty", { steps: 0 });
        add("other-project", { uris: JSON.stringify([pathToFileURL(agyDir).href]) });
        add("multi-workspace", { uris: JSON.stringify([pathToFileURL(agyDir).href, pathToFileURL(cwd).href]) });
        add("malformed", { uris: "not JSON" });
        add("remote", { uris: '["https://example.com"]' });
        add("../escape");
        add("missing");
        rmSync(join(directory, "conversations", "missing.db"));
    } finally { db.close(); }
    const roots = [{ harnessId: "antigravity", directory }];
    const scan = await scanSavedSessions(roots, 100, { harnessId: "antigravity", cwd });
    assert.deepEqual(scan.unreadable, []);
    assert.deepEqual(scan.sessions.map((session) => session.id).sort(), ["main", "multi-workspace", "preview"]);
    assert.equal(scan.sessions[0].modified, Date.parse("2026-10-16T16:50:09.831Z"));
    assert.equal(scan.sessions.find((session) => session.id === "preview").title, "Preview");
    assert.deepEqual(resumeArguments(scan.sessions[0]), ["--conversation", scan.sessions[0].id]);
    assert.equal((await scanSavedSessions(roots, 1, { harnessId: "antigravity", cwd })).sessions.length, 1);
    const alias = join(agyDir, "alias");
    symlinkSync(cwd, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal((await scanSavedSessions(roots, 100, { harnessId: "antigravity", cwd: alias })).sessions.length, 3);
    assert.equal(sessionRoots(agyDir, {}).find((root) => root.harnessId === "antigravity").directory, join(agyDir, ".gemini", "antigravity-cli"));
    const before = readFileSync(join(directory, "conversation_summaries.db"));
    await scanSavedSessions(roots);
    assert.deepEqual(readFileSync(join(directory, "conversation_summaries.db")), before, "discovery leaves the index unchanged");
    writeFileSync(join(directory, "conversation_summaries.db"), "corrupt index");
    assert.deepEqual(await scanSavedSessions(roots), { sessions: [], unreadable: ["antigravity"] });
    assert.deepEqual(await scanSavedSessions([{ harnessId: "antigravity", directory: join(agyDir, "missing") }]), { sessions: [], unreadable: [] });
    passed += 1;
    console.log("ok: Antigravity SQLite history filters projects and children, decodes file URIs, resumes by ID and tolerates unavailable indexes");
} finally { rmSync(agyDir, { recursive: true, force: true }); }

const dshDir = mkdtempSync(join(tmpdir(), "mhte-dsh-"));
try {
    const cwd = join(dshDir, "workspace");
    mkdirSync(cwd);
    const store = join(dshDir, "sessions");
    const writeZstdFrames = (file, frameRows) => {
        mkdirSync(dirname(file), { recursive: true });
        const buffers = frameRows.map((rows) => zstdCompressSync(Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n")));
        writeFileSync(file, Buffer.concat(buffers));
    };
    const mainDir = join(store, "--workspace--", "dsh-main");
    writeZstdFrames(join(mainDir, "session.v3.jsonl.zstd"), [
        [{ type: "session", version: 3, id: "dsh-main", cwd }],
        [{ type: "session/title", seq: 0, data: { title: "Stale v3 title" } }],
    ]);
    writeZstdFrames(join(mainDir, "session.v4.jsonl.zstd"), [
        [{ type: "session", version: 4, id: "dsh-main", cwd }],
        [{ type: "user/message", seq: 0, data: { content: [{ type: "text", text: "Initial user prompt" }], source: { kind: "user" } } }],
        [{ type: "session/title", seq: 1, data: { title: "Updated v4 title" } }],
    ]);
    // Even if an older generation file has a newer mtime, the highest generation wins in the same session directory.
    const now = Date.now();
    utimesSync(join(mainDir, "session.v3.jsonl.zstd"), (now + 5000) / 1000, (now + 5000) / 1000);
    utimesSync(join(mainDir, "session.v4.jsonl.zstd"), now / 1000, now / 1000);
    writeZstdFrames(join(store, "--workspace--", "dsh-fallback", "session.v4.jsonl.zstd"), [
        [{ type: "session", version: 4, id: "dsh-fallback", cwd }],
        [{ type: "user/message", seq: 0, data: { content: [{ type: "text", text: "Synthetic notification" }], source: { kind: "subagent_notification" } } }],
        [{ type: "user/message", seq: 1, data: { content: [{ type: "text", text: "Human prompt fallback" }], source: { kind: "user" } } }],
    ]);
    writeZstdFrames(join(store, "--workspace--", "dsh-subagent", "session.v4.jsonl.zstd"), [
        [{ type: "session", version: 4, id: "dsh-subagent", cwd, origin: "subagent", delegationDepth: 1 }],
        [{ type: "session/title", seq: 0, data: { title: "Subagent session" } }],
    ]);
    mkdirSync(join(store, "--workspace--", "dsh-corrupt"), { recursive: true });
    writeFileSync(join(store, "--workspace--", "dsh-corrupt", "session.v4.jsonl.zstd"), Buffer.from("not-valid-zstd"));
    const roots = [{ harnessId: "deepseek", directory: store }];
    const scan = await scanSavedSessions(roots, 100, { harnessId: "deepseek", cwd });
    assert.deepEqual(scan.unreadable, []);
    assert.deepEqual(scan.sessions.map((session) => session.id).sort(), ["dsh-fallback", "dsh-main"]);
    assert.equal(scan.sessions.find((session) => session.id === "dsh-main").title, "Updated v4 title");
    assert.equal(scan.sessions.find((session) => session.id === "dsh-main").file, join(mainDir, "session.v4.jsonl.zstd"));
    assert.equal(scan.sessions.find((session) => session.id === "dsh-fallback").title, "Human prompt fallback");
    assert.deepEqual(resumeArguments(scan.sessions[0]), ["--resume", scan.sessions[0].id]);
    passed += 1;
    console.log("ok: DeepSeek Harness multi-frame .jsonl.zstd sessions decode titles, pick highest generation, skip subagents and tolerate corrupt files");
} finally { rmSync(dshDir, { recursive: true, force: true }); }

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
const calls = { commands: [], profiles: [], views: [], webviews: [], configUpdates: [], created: [], errors: [], infos: [], executed: [], configGets: [], warnings: [], warningResults: [], fsDeletes: [],
    terminals: [], sendTexts: [], statusItems: [], statusShown: [], statusHidden: [], statusDisposed: 0,
    shellIntegrationHandlers: [], executionStartHandlers: [], executionEndHandlers: [],
    terminalOpenHandlers: [], terminalCloseHandlers: [], activeTerminalHandlers: [], activeEditorHandlers: [], workspaceFolderHandlers: [] };
const scopedFixtures = new Map();

function subscribeTerminalEvent(handlers, handler) {
    handlers.push(handler);
    return { dispose() { const index = handlers.indexOf(handler); if (index >= 0) handlers.splice(index, 1); } };
}

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

function getConfiguration(section, scope) {
    const base = section ? walk(FIXTURE, section) : FIXTURE;
    const scoped = section ? walk(scopedFixtures.get(scope?.fsPath), section) : scopedFixtures.get(scope?.fsPath);
    return {
        get(key, fallback) {
            calls.configGets.push({ section, key, scope: scope?.fsPath });
            const value = walk(scoped, key) ?? walk(base, key);
            return value === undefined ? fallback : value;
        },
        has(key) { return walk(base, key) !== undefined; },
        async update(key, value, target) { calls.configUpdates.push({ section, key, value, target }); base[key] = value; },
    };
}

module.exports = {
    __calls: calls,
    __fixture: FIXTURE,
    __scopedFixtures: scopedFixtures,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    env: { language: "en" },
    EventEmitter: class EventEmitter {
        listeners = new Set();
        event = (listener) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(value) { for (const listener of this.listeners) { listener(value); } }
        dispose() { this.listeners.clear(); }
    },
    commands: {
        registerCommand(id, handler) { calls.commands.push({ id, handler }); return { dispose() {} }; },
        executeCommand(...args) {
            calls.executed.push(...args);
            if (args[0] === "workbench.action.joinAllGroups") {
                module.exports.window.tabGroups.all = [{ tabs: module.exports.window.tabGroups.all.flatMap((group) => group.tabs ?? []) }];
            }
            return Promise.resolve();
        },
    },
    window: {
        tabGroups: { all: [] },
        terminals: [],
        activeTerminal: undefined,
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor(handler) { return subscribeTerminalEvent(calls.activeEditorHandlers, handler); },
        createTreeView(id, options) {
            const selectionHandlers = [];
            const checkboxHandlers = [];
            const view = { id, provider: options.treeDataProvider, disposed: false,
                checkboxHandlers, options,
                onDidChangeCheckboxState(handler) { return subscribeTerminalEvent(checkboxHandlers, handler); },
                selectionHandlers,
                onDidChangeSelection(handler) { return subscribeTerminalEvent(selectionHandlers, handler); },
                dispose() { this.disposed = true; } };
            calls.views.push(view);
            return view;
        },
        registerWebviewViewProvider(id, provider) { calls.webviews.push({ id, provider }); return { dispose() {} }; },
        registerTerminalProfileProvider(id, provider) { calls.profiles.push({ id, provider }); return { dispose() {} }; },
        registerTreeDataProvider(id, provider) {
            const view = { id, provider, disposed: false };
            calls.views.push(view);
            return { dispose() { view.disposed = true; } };
        },
        onDidOpenTerminal(handler) { return subscribeTerminalEvent(calls.terminalOpenHandlers, handler); },
        onDidCloseTerminal(handler) { return subscribeTerminalEvent(calls.terminalCloseHandlers, handler); },
        onDidChangeActiveTerminal(handler) { return subscribeTerminalEvent(calls.activeTerminalHandlers, handler); },
        showQuickPick() { return Promise.resolve(undefined); },
        showErrorMessage(message) { calls.errors.push(message); return Promise.resolve(undefined); },
        showWarningMessage(message, options, ...items) { calls.warnings.push({ message, options, items }); return Promise.resolve(calls.warningResults.shift()); },
        showInformationMessage(message) { calls.infos.push(message); return Promise.resolve(undefined); },
        createTerminal(options) {
            const terminal = {
                name: options.name ?? options.shellPath ?? "shell",
                creationOptions: options,
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
    workspace: { workspaceFolders: [], getWorkspaceFolder() { return undefined; }, getConfiguration,
        fs: { async delete(uri, options) { calls.fsDeletes.push({ file: uri.fsPath, options }); await require("node:fs/promises").unlink(uri.fsPath); } },
        onDidChangeWorkspaceFolders(handler) { return subscribeTerminalEvent(calls.workspaceFolderHandlers, handler); },
        onDidChangeConfiguration() { return { dispose() {} }; } },
    Uri: { file: (fsPath) => ({ fsPath }), joinPath: (base, ...parts) => ({ fsPath: require("node:path").join(base.fsPath, ...parts), path: parts.join("/") }) },
    ViewColumn: { Active: -1, Beside: -2 },
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
    await build({
        entryPoints: [join(projectRoot, "src", "launch.ts")],
        outfile: join(activationDir, "launch.cjs"), bundle: true, format: "cjs", platform: "node", external: ["vscode"], logLevel: "silent",
    });
    const resumeLauncher = requireFrom(join(activationDir, "launch.cjs"));

    const savedState = new Map();
    const globalState = {
        get(key, fallback) { return savedState.get(key) ?? fallback; },
        async update(key, value) { savedState.set(key, value); },
    };
    const context = {
        subscriptions: [],
        globalState,
        workspaceState: { get(key, fallback) { return savedState.get('workspace:' + key) ?? fallback; }, async update(key, value) { savedState.set('workspace:' + key, value); } },
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
    assert.equal(vscodeStub.__calls.views.length, 3);
    const agentsView = vscodeStub.__calls.views[0];
    assert.equal(agentsView.id, manifest.contributes.views.multiHarness[0].id);
    const agents = agentsView.provider.getChildren();
    assert.equal(agents.length, contributedProfiles.length);
    assert.deepEqual(agents.map((agent) => `multiHarness.${agent.id}`), manifest.contributes.terminal.map((profile) => profile.id), "a fresh installation shares the default agent and contributed profile order");
    assert.deepEqual(vscodeStub.__calls.profiles.map((profile) => profile.id), manifest.contributes.terminal.map((profile) => profile.id), "profile providers register in the default agent order");
    assert.ok(agents.every((agent) => agentsView.provider.getTreeItem(agent).command.command === "multiHarness.selectSessionAgent"));
    for (const agent of agents) {
        const item = agentsView.provider.getTreeItem(agent);
        assert.equal(item.id, agent.id);
        assert.equal(item.label, agent.displayName);
        assert.deepEqual(item.command.arguments, [agent.id, true]);
        assert.deepEqual(agentsView.provider.getChildren(agent), []);
        for (const theme of ["light", "dark"]) {
            assert.equal(item.iconPath[theme].fsPath, join(projectRoot, "media", `${agent.id}-${theme}.svg`));
            assert.ok(existsSync(item.iconPath[theme].fsPath));
        }
    }
    const sidebarItem = agentsView.provider.getTreeItem(agents.find((agent) => agent.id === "ohMyPi"));
    const activateAgent = vscodeStub.__calls.commands.find((command) => command.id === sidebarItem.command.command).handler;
    const sidebarLaunches = () => vscodeStub.__calls.executed.filter((value) => typeof value === "string" && value.startsWith("multiHarness.open"));
    const realNow = Date.now;
    let clickTime = realNow();
    Date.now = () => clickTime;
    try {
        const terminalsBeforeClick = vscodeStub.__calls.created.length;
        vscodeStub.__calls.executed.length = 0;
        agentsView.selectionHandlers.forEach((handler) => handler({ selection: [agents.find((agent) => agent.id === "ohMyPi")] }));
        await activateAgent(...sidebarItem.command.arguments);
        assert.equal(savedState.get("workspace:selectedSessionAgent"), "ohMyPi");
        assert.equal(vscodeStub.__calls.created.length, terminalsBeforeClick, "single click selects the history filter without creating a terminal");
        assert.deepEqual(sidebarLaunches(), []);
        clickTime += 100;
        await activateAgent(...sidebarItem.command.arguments);
        assert.deepEqual(sidebarLaunches(), ["multiHarness.openOhMyPi"], "double click opens the selected agent once");
        vscodeStub.__calls.executed.length = 0;
        clickTime += 1000;
        await activateAgent("codex", true);
        clickTime += 100;
        await activateAgent("ohMyPi", true);
        assert.deepEqual(sidebarLaunches(), [], "clicks on different agents cannot open a console");
        clickTime += 1000;
        await activateAgent("ohMyPi", true);
        assert.deepEqual(sidebarLaunches(), [], "separate single clicks do not count as a double click");
        vscodeStub.__fixture.workbench = { list: { openMode: "doubleClick" } };
        await activateAgent("ohMyPi", true);
        assert.deepEqual(sidebarLaunches(), ["multiHarness.openOhMyPi"], "honor native doubleClick mode without requiring four clicks");
        delete vscodeStub.__fixture.workbench;
    } finally {
        Date.now = realNow;
    }
    await vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.openOhMyPi").handler();
    assert.equal(vscodeStub.__calls.created.at(-1)?.options.shellPath, fakeCli);
    assert.deepEqual(vscodeStub.__calls.created.at(-1)?.options.shellArgs, ["--continue"]);
    passed += 1;
    console.log("ok: Activity Bar single clicks select history and double clicks dispatch the configured launch command");

    const addFavorite = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.addFavorite");
    const removeFavorite = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.removeFavorite");
    let favoriteRefreshes = 0;
    agentsView.provider.onDidChangeTreeData(() => { favoriteRefreshes += 1; });
    const codex = agents.find((agent) => agent.id === "codex");
    const goose = agents.find((agent) => agent.id === "goose");
    await addFavorite.handler(goose);
    await addFavorite.handler(codex);
    assert.deepEqual(agentsView.provider.getChildren().map((agent) => agent.id), [
        "codex", "goose", ...agents.filter((agent) => !["codex", "goose"].includes(agent.id)).map((agent) => agent.id),
    ], "favorites appear first with the original order preserved in both groups");
    assert.equal(agentsView.provider.getTreeItem(codex).contextValue, "favoriteAgent");
    assert.equal(agentsView.provider.getTreeItem(codex).description, "★");
    assert.equal(agentsView.provider.getTreeItem(goose).command.command, "multiHarness.selectSessionAgent");
    await addFavorite.handler(codex);
    await addFavorite.handler();
    await addFavorite.handler({ id: "unknown" });
    assert.equal(favoriteRefreshes, 2, "duplicate and invalid requests do not refresh the list");
    await removeFavorite.handler(goose);
    assert.equal(agentsView.provider.getTreeItem(goose).contextValue, "agent");
    assert.equal(agentsView.provider.getTreeItem(goose).description, undefined);
    assert.deepEqual(agentsView.provider.getChildren().map((agent) => agent.id), [
        "codex", ...agents.filter((agent) => agent.id !== "codex").map((agent) => agent.id),
    ]);
    assert.deepEqual(globalState.get("favoriteAgents"), ["codex"]);
    assert.equal(favoriteRefreshes, 3, "each favorite change refreshes the list");
    passed += 1;
    console.log("ok: favorite stars update ordering and context while preserving launch commands");

    const primeAgent = agents.find((agent) => agent.id === "primeAgent");
    assert.equal(primeAgent.defaultExecutable, "prime-agent");
    vscodeStub.__fixture.multiHarness.primeAgent = { executablePath: fakeCli, arguments: ["--resume"] };
    await vscodeStub.__calls.commands.find((command) => command.id === primeAgent.commandId).handler();
    const primeTerminal = vscodeStub.__calls.created.at(-1).options;
    assert.equal(primeTerminal.shellPath, fakeCli);
    assert.deepEqual(primeTerminal.shellArgs, ["--resume"]);
    const primeProfile = vscodeStub.__calls.profiles.find((profile) => profile.id === "multiHarness.primeAgent");
    const profileOptions = primeProfile.provider.provideTerminalProfile({}).options;
    assert.equal(profileOptions.shellPath, fakeCli);
    assert.deepEqual(profileOptions.shellArgs, ["--resume"]);
    await addFavorite.handler(primeAgent);
    assert.equal(agentsView.provider.getTreeItem(primeAgent).contextValue, "favoriteAgent");
    await removeFavorite.handler(primeAgent);
    passed += 1;
    console.log("ok: Prime Agent command, profile and favorites use the configured executable and arguments");

    const antigravity = agents.find((agent) => agent.id === "antigravity");
    assert.equal(antigravity.defaultExecutable, "agy");
    assert.equal(antigravity.commandId, "multiHarness.openAntigravity");
    vscodeStub.__fixture.multiHarness.antigravity = { executablePath: fakeCli, arguments: ["--model", "test-model"] };
    await vscodeStub.__calls.commands.find((command) => command.id === antigravity.commandId).handler();
    const antigravityTerminal = vscodeStub.__calls.created.at(-1).options;
    assert.equal(antigravityTerminal.shellPath, fakeCli);
    assert.deepEqual(antigravityTerminal.shellArgs, ["--model", "test-model"]);
    const antigravityProfile = vscodeStub.__calls.profiles.find((profile) => profile.id === "multiHarness.antigravity");
    const antigravityOptions = antigravityProfile.provider.provideTerminalProfile({}).options;
    assert.equal(antigravityOptions.shellPath, fakeCli);
    assert.deepEqual(antigravityOptions.shellArgs, ["--model", "test-model"]);
    await addFavorite.handler(antigravity);
    assert.equal(agentsView.provider.getTreeItem(antigravity).contextValue, "favoriteAgent");
    await removeFavorite.handler(antigravity);
    assert.equal(agentsView.provider.getTreeItem(antigravity).contextValue, "agent");
    passed += 1;
    console.log("ok: Antigravity CLI command, profile and favorites use the configured executable and arguments");

    const deepseek = agents.find((agent) => agent.id === "deepseek");
    assert.equal(deepseek.displayName, "DeepSeek Harness");
    assert.equal(deepseek.defaultExecutable, "dsh");
    assert.deepEqual(deepseek.defaultArgs, ["--profile", "tui"]);
    assert.equal(deepseek.commandId, "multiHarness.openDeepseek");
    vscodeStub.__fixture.multiHarness.deepseek = { executablePath: fakeCli };
    await vscodeStub.__calls.commands.find((command) => command.id === deepseek.commandId).handler();
    const deepseekDefaultTerminal = vscodeStub.__calls.created.at(-1).options;
    assert.equal(deepseekDefaultTerminal.shellPath, fakeCli);
    assert.deepEqual(deepseekDefaultTerminal.shellArgs, ["--profile", "tui"]);
    const deepseekProfile = vscodeStub.__calls.profiles.find((profile) => profile.id === "multiHarness.deepseek");
    const deepseekProfileOptions = deepseekProfile.provider.provideTerminalProfile({}).options;
    assert.equal(deepseekProfileOptions.shellPath, fakeCli);
    assert.deepEqual(deepseekProfileOptions.shellArgs, ["--profile", "tui"]);
    vscodeStub.window.terminals = [];
    vscodeStub.__fixture.multiHarness.deepseek = { executablePath: fakeCli, arguments: ["web", "--port", "8080"] };
    await vscodeStub.__calls.commands.find((command) => command.id === deepseek.commandId).handler();
    assert.deepEqual(vscodeStub.__calls.created.at(-1).options.shellArgs, ["web", "--port", "8080"]);
    vscodeStub.window.terminals = [];
    await addFavorite.handler(deepseek);
    assert.equal(agentsView.provider.getTreeItem(deepseek).contextValue, "favoriteAgent");
    await removeFavorite.handler(deepseek);
    assert.equal(agentsView.provider.getTreeItem(deepseek).contextValue, "agent");
    passed += 1;
    console.log("ok: DeepSeek Harness command, profile and favorites use default tui profile args and custom overrides");

    assert.equal(antigravity.displayName, "Antigravity CLI");
    assert.equal(antigravity.defaultExecutable, "agy");
    assert.equal(antigravity.commandId, "multiHarness.openAntigravity");
    const agyCli = join(activationDir, "custom agy");
    writeFileSync(agyCli, "#!/bin/sh\n");
    chmodSync(agyCli, 0o755);
    const agyArgs = ["--model", "model with spaces", "literal;$value"];
    vscodeStub.__fixture.multiHarness.antigravity = { executablePath: agyCli, arguments: agyArgs };
    await vscodeStub.__calls.commands.find((command) => command.id === antigravity.commandId).handler();
    const agyTerminal = vscodeStub.__calls.created.at(-1).options;
    assert.equal(agyTerminal.shellPath, agyCli);
    assert.deepEqual(agyTerminal.shellArgs, agyArgs);
    const agyProfile = vscodeStub.__calls.profiles.find((profile) => profile.id === "multiHarness.antigravity");
    const agyProfileOptions = agyProfile.provider.provideTerminalProfile({}).options;
    assert.equal(agyProfileOptions.shellPath, agyCli);
    assert.deepEqual(agyProfileOptions.shellArgs, agyArgs);
    assert.deepEqual(agyProfileOptions.iconPath, agyTerminal.iconPath);
    vscodeStub.__fixture.multiHarness.antigravity.executablePath = join(activationDir, "missing-agy");
    assert.equal(agyProfile.provider.provideTerminalProfile({}), undefined);
    vscodeStub.__fixture.multiHarness.antigravity.executablePath = agyCli;
    await addFavorite.handler(antigravity);
    assert.equal(agentsView.provider.getTreeItem(antigravity).contextValue, "favoriteAgent");
    assert.ok(globalState.get("favoriteAgents").includes("antigravity"));
    await removeFavorite.handler(antigravity);
    const originalQuickPick = vscodeStub.window.showQuickPick;
    try {
        vscodeStub.window.showQuickPick = async (items) => {
            assert.deepEqual(items.map((item) => item.harness.id), agents.map((agent) => agent.id), "the agent picker follows the default order");
            const item = items.find((candidate) => candidate.harness?.id === "antigravity");
            assert.equal(item.label, "Antigravity CLI");
            return item;
        };
        vscodeStub.__calls.executed.length = 0;
        await vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.openAgentPicker").handler();
        assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.openAntigravity"]);
    } finally {
        vscodeStub.window.showQuickPick = originalQuickPick;
    }
    assert.equal(sessionRoots().some((root) => root.harnessId === "antigravity"), true);
    passed += 1;
    console.log("ok: Antigravity picker, command, profile and favorites preserve custom path and arguments");

    const sessionsView = vscodeStub.__calls.views.find((view) => view.id === "multiHarness.sessions");
    assert.deepEqual(sessionsView.provider.getChildren(), []);
    let sessionRefreshes = 0;
    sessionsView.provider.onDidChangeTreeData(() => { sessionRefreshes += 1; });
    const firstPrime = { name: "Prime Agent", shown: 0, disposed: 0, show() { this.shown += 1; }, dispose() { this.disposed += 1; } };
    const secondPrime = { name: "Prime Agent", shown: 0, disposed: 0, show() { this.shown += 1; }, dispose() { this.disposed += 1; } };
    vscodeStub.window.terminals = [firstPrime, { name: "bash" }, secondPrime];
    vscodeStub.__calls.terminalOpenHandlers.forEach((handler) => handler(secondPrime));
    const openSessions = sessionsView.provider.getChildren();
    assert.equal(openSessions.length, 2, "ordinary shell terminals are excluded");
    assert.equal(sessionsView.provider.getTreeItem(openSessions[0]).label, "Prime Agent #1");
    assert.equal(sessionsView.provider.getTreeItem(openSessions[1]).label, "Prime Agent #2");
    assert.notEqual(openSessions[0].id, openSessions[1].id);
    assert.equal(sessionsView.provider.getChildren()[0].id, openSessions[0].id, "refresh preserves session identity");
    vscodeStub.window.activeTerminal = secondPrime;
    vscodeStub.__calls.activeTerminalHandlers.forEach((handler) => handler(secondPrime));
    assert.equal(sessionsView.provider.getTreeItem(openSessions[1]).description, "●");
    assert.equal(sessionsView.provider.getTreeItem(openSessions[0]).description, undefined);
    const sessionItem = sessionsView.provider.getTreeItem(openSessions[1]);
    const focusSession = vscodeStub.__calls.commands.find((command) => command.id === sessionItem.command.command);
    const createdBeforeFocus = vscodeStub.__calls.created.length;
    const editorTabs = [{ label: "file.ts" }, { label: "Prime Agent" }];
    vscodeStub.window.tabGroups.all = [{ tabs: [editorTabs[0]] }, { tabs: [editorTabs[1]] }];
    await focusSession.handler(...sessionItem.command.arguments);
    assert.equal(secondPrime.shown, 1);
    assert.equal(firstPrime.shown, 0, "focus selects the exact terminal even when names match");
    assert.equal(vscodeStub.window.tabGroups.all.length, 1, "focusing a session joins existing editor splits");
    assert.deepEqual(vscodeStub.window.tabGroups.all[0].tabs, editorTabs, "joining groups preserves open tabs");
    const splitGroups = [{ tabs: [editorTabs[0]] }, { tabs: [editorTabs[1]] }];
    vscodeStub.window.tabGroups.all = splitGroups;
    vscodeStub.__fixture.multiHarness.useFullEditorArea = false;
    await focusSession.handler(...sessionItem.command.arguments);
    assert.equal(vscodeStub.window.tabGroups.all, splitGroups, "disabled full area preserves the existing layout when focusing sessions");
    delete vscodeStub.__fixture.multiHarness.useFullEditorArea;
    vscodeStub.window.terminals = [firstPrime];
    vscodeStub.__calls.terminalCloseHandlers.forEach((handler) => handler(secondPrime));
    await focusSession.handler(secondPrime);
    await focusSession.handler();
    assert.equal(secondPrime.shown, 2, "stale session clicks do not focus closed terminals");
    assert.equal(vscodeStub.__calls.created.length, createdBeforeFocus, "focusing sessions never launches new terminals");
    assert.equal(sessionsView.provider.getChildren().length, 1);
    assert.equal(sessionsView.provider.getTreeItem(openSessions[0]).label, "Prime Agent");
    assert.equal(sessionRefreshes, 3, "open, focus and close events refresh sessions");
    const closeSession = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.closeSession");
    assert.equal(sessionItem.contextValue, "openTerminal");
    vscodeStub.window.terminals = [firstPrime, secondPrime];
    vscodeStub.__calls.terminalOpenHandlers.forEach((handler) => handler(secondPrime));
    closeSession.handler(openSessions[1]);
    assert.equal(secondPrime.disposed, 1, "closing a row targets the exact terminal when names match");
    assert.equal(firstPrime.disposed, 0, "closing a row leaves the other terminal running");
    // The close notification can arrive before VS Code updates its terminal list.
    vscodeStub.__calls.terminalCloseHandlers.forEach((handler) => handler(secondPrime));
    assert.deepEqual(sessionsView.provider.getChildren(), [openSessions[0]], "close event removes the closed terminal row");
    closeSession.handler(openSessions[1]);
    closeSession.handler();
    closeSession.handler({ terminal: firstPrime });
    assert.equal(secondPrime.disposed, 1, "stale close actions are ignored");
    assert.equal(firstPrime.disposed, 0, "unrecognized close arguments cannot close terminals");
    vscodeStub.window.terminals = [];
    vscodeStub.window.activeTerminal = undefined;
    const titledTerminal = {
        name: "Fix login validation",
        creationOptions: { env: { MULTI_HARNESS_TERMINAL_IDENTITY: JSON.stringify({ version: 1, harnessId: "primeAgent", launchMode: "direct" }) } },
    };
    vscodeStub.window.terminals = [titledTerminal];
    const titledSession = sessionsView.provider.getChildren()[0];
    assert.equal(titledSession.harness.id, "primeAgent", "conversation titles do not hide agent terminals");
    assert.equal(sessionsView.provider.getTreeItem(titledSession).label, "Fix login validation");
    titledTerminal.name = "Validate login and logout";
    assert.equal(sessionsView.provider.getChildren()[0].id, titledSession.id, "title changes preserve terminal identity");
    assert.equal(sessionsView.provider.getTreeItem(titledSession).label, "Validate login and logout");
    titledTerminal.exitStatus = { code: 0 };
    assert.deepEqual(sessionsView.provider.getChildren(), [], "exited terminals are not active sessions even while their tabs linger");
    delete titledTerminal.exitStatus;
    const ompTerminal = {
        name: "Session updated",
        creationOptions: { env: { MULTI_HARNESS_TERMINAL_IDENTITY: JSON.stringify({ version: 1, harnessId: "ohMyPi", launchMode: "direct" }) } },
    };
    vscodeStub.window.terminals = [ompTerminal];
    assert.equal(sessionsView.provider.getChildren()[0].harness.id, "ohMyPi");
    vscodeStub.__calls.terminalCloseHandlers.forEach((handler) => handler(ompTerminal));
    assert.deepEqual(sessionsView.provider.getChildren(), [], "closing an OMP tab removes its Session updated row before the terminal snapshot catches up");
    vscodeStub.window.terminals = [];
    passed += 1;
    console.log("ok: sessions track terminal lifecycle and focus exact terminals without launching duplicates");

    // Closed conversations are discoverable without any terminal tab and resume
    // in their recorded project instead of revealing an unrelated agent tab.
    const savedView = vscodeStub.__calls.views.find((view) => view.id === "multiHarness.savedSessions");
    const savedSessionRows = async () => (await Promise.all((await savedView.provider.getChildren()).map((item) =>
        "day" in item ? savedView.provider.getChildren(item) : []))).flat();
    const savedRoot = join(activationDir, "saved-conversations");
    for (const id of ["codex", "claudeCode", "pi", "ohMyPi", "primeAgent", "antigravity", "deepseek", "openCode"]) {
        vscodeStub.__fixture.multiHarness[id] ??= {};
        vscodeStub.__fixture.multiHarness[id].sessionDirectory = join(savedRoot, id);
    }
    const projectDirectory = join(activationDir, "recorded-project");
    mkdirSync(projectDirectory);
    const primeSessions = vscodeStub.__fixture.multiHarness.primeAgent.sessionDirectory;
    mkdirSync(primeSessions, { recursive: true });
    const savedFile = join(primeSessions, "recorded.jsonl");
    writeFileSync(savedFile, JSON.stringify({type: "session", id: "recorded-prime", cwd: projectDirectory}) + '\n{"type":"session_info","name":"A saved conversation"}\n');
    const recordedTime = new Date(2026, 9, 19, 0, 1);
    utimesSync(savedFile, recordedTime, recordedTime);
    const selectSessionAgent = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.selectSessionAgent");
    await selectSessionAgent.handler("primeAgent");
    assert.deepEqual(await savedView.provider.getChildren(), [], "no project never falls back to all session history");
    const otherFile = join(primeSessions, "other-project.jsonl");
    writeFileSync(otherFile, JSON.stringify({ type: "session", id: "other-project", cwd: activationDir }) + "\n");
    const otherTime = new Date(2026, 9, 18, 23, 59);
    utimesSync(otherFile, otherTime, otherTime);
    const newerFile = join(primeSessions, "newer-conversation.jsonl");
    writeFileSync(newerFile, JSON.stringify({ type: "session", id: "newer-conversation", cwd: activationDir }) + "\n");
    const newerTime = new Date(2026, 9, 19, 15);
    utimesSync(newerFile, newerTime, newerTime);
    const toggleLocationScope = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.toggleSessionLocationScope");
    await toggleLocationScope.handler();
    const nativeDays = await savedView.provider.getChildren();
    assert.equal(nativeDays.length, 2, "native history separates local dates on either side of midnight");
    assert.deepEqual((await savedSessionRows()).map((session) => session.id), ["newer-conversation", "recorded-prime", "other-project"], "native history orders day groups and sessions within each group newest first");
    const previousLanguage = vscodeStub.env.language;
    vscodeStub.env.language = "de";
    const dayItem = savedView.provider.getTreeItem(nativeDays[0]);
    assert.equal(dayItem.label, recordedTime.toLocaleDateString("de", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    assert.equal(dayItem.accessibilityInformation.label, dayItem.label, "native groups have localized accessible names");
    assert.equal(dayItem.collapsibleState, 2, "native day groups start expanded");
    assert.equal(dayItem.command, undefined, "day groups never resume sessions");
    assert.equal(dayItem.checkboxState, undefined, "day groups never receive selection checkboxes");
    vscodeStub.env.language = previousLanguage;
    assert.deepEqual(await savedView.provider.getChildren((await savedView.provider.getChildren(nativeDays[0]))[0]), [], "session rows remain leaves");
    rmSync(newerFile);
    await toggleLocationScope.handler();
    assert.deepEqual(await savedView.provider.getChildren(), [], "returning to current location restores the folder requirement");
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: projectDirectory } }];
    vscodeStub.__calls.activeEditorHandlers.forEach((handler) => handler(undefined));
    const savedRows = await savedSessionRows();
    assert.equal(savedRows.length, 1);
    assert.equal(savedRows[0].id, "recorded-prime", "current location excludes other projects");
    await toggleLocationScope.handler();
    assert.deepEqual(new Set((await savedSessionRows()).map((session) => session.id)), new Set(["recorded-prime", "other-project"]));
    await selectSessionAgent.handler("codex");
    assert.deepEqual(await savedView.provider.getChildren(), [], "all locations retains agent isolation");
    await selectSessionAgent.handler("primeAgent");
    await toggleLocationScope.handler();
    assert.deepEqual((await savedSessionRows()).map((session) => session.id), ["recorded-prime"], "switching back discards all-location scan results");
    rmSync(otherFile);
    const savedItem = savedView.provider.getTreeItem(savedRows[0]);
    assert.equal(savedItem.label, "A saved conversation");
    assert.ok(savedItem.description.includes("Prime Agent"));
    assert.ok(savedItem.description.includes("recorded-project"));
    const resume = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.resumeSession");
    vscodeStub.__fixture.multiHarness.primeAgent.arguments = ["--model", "test-model"];
    vscodeStub.window.terminals = [firstPrime];
    vscodeStub.window.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    await resume.handler(...savedItem.command.arguments);
    const resumed = vscodeStub.__calls.created.at(-1);
    assert.equal(firstPrime.shown, 0);
    assert.equal(resumed.options.cwd, projectDirectory);
    assert.equal(vscodeStub.window.tabGroups.all.length, 1, "resuming a session joins existing editor splits");
    assert.deepEqual(resumed.options.location, { viewColumn: vscodeStub.ViewColumn.Active }, "saved conversations open without creating a split");
    assert.deepEqual(resumed.options.shellArgs, ["--resume", savedFile, "--model", "test-model"]);
    vscodeStub.window.terminals = [resumed.terminal];
    const countBeforeReuse = vscodeStub.__calls.created.length;
    vscodeStub.window.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    await resume.handler(...savedItem.command.arguments);
    assert.equal(vscodeStub.__calls.created.length, countBeforeReuse);
    assert.equal(vscodeStub.window.tabGroups.all.length, 1, "revealing an existing session also joins splits");
    resumed.terminal.name = "Prime Agent — renamed conversation";
    await resume.handler(...savedItem.command.arguments);
    assert.equal(vscodeStub.__calls.created.length, countBeforeReuse, "a changed terminal title still reuses the saved identity");
    const sameTitleFile = join(primeSessions, "same-title.jsonl");
    writeFileSync(sameTitleFile, JSON.stringify({ type: "session", id: "different-prime", cwd: projectDirectory }) + '\n{"type":"session_info","name":"A saved conversation"}\n');
    vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.refreshSessions").handler();
    resumed.terminal.name = "Prime Agent — A saved conversation";
    await resume.handler({ harnessId: "primeAgent", id: "different-prime" });
    const sameTitleTerminal = vscodeStub.__calls.created.at(-1);
    assert.equal(vscodeStub.__calls.created.length, countBeforeReuse + 1, "different identities sharing a title open separate terminals");
    sameTitleTerminal.terminal.name = resumed.terminal.name;
    assert.deepEqual(sameTitleTerminal.options.shellArgs, ["--resume", sameTitleFile, "--model", "test-model"]);
    vscodeStub.window.terminals = [sameTitleTerminal.terminal, resumed.terminal];
    const shownBeforeReuse = resumed.terminal.shown;
    await resume.handler(...savedItem.command.arguments);
    assert.equal(vscodeStub.__calls.created.length, countBeforeReuse + 1);
    assert.equal(resumed.terminal.shown, shownBeforeReuse + 1, "same-title terminals focus the requested identity");
    rmSync(sameTitleFile);
    vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.refreshSessions").handler();
    vscodeStub.__fixture.multiHarness.useFullEditorArea = false;
    const preservedResumeGroups = [{ tabs: [] }, { tabs: [] }];
    vscodeStub.window.tabGroups.all = preservedResumeGroups;
    await resume.handler(...savedItem.command.arguments);
    assert.equal(vscodeStub.window.tabGroups.all, preservedResumeGroups, "disabled full area preserves splits when revealing an existing saved session");
    vscodeStub.window.terminals = [];
    await resume.handler(...savedItem.command.arguments);
    assert.equal(vscodeStub.window.tabGroups.all, preservedResumeGroups, "disabled full area preserves splits when creating a resumed terminal");
    vscodeStub.window.terminals = [resumed.terminal];
    // The additional resume above created a terminal; subsequent stale-request
    // checks compare against this new baseline.
    const countAfterLayoutChecks = vscodeStub.__calls.created.length;
    delete vscodeStub.__fixture.multiHarness.useFullEditorArea;
    assert.equal(sessionsView.provider.getChildren()[0].harness.id, "primeAgent");
    await resume.handler({ harnessId: "primeAgent", id: "unlisted" });
    assert.equal(vscodeStub.__calls.created.length, countAfterLayoutChecks);
    vscodeStub.window.terminals = [];
    rmSync(savedFile);
    await resume.handler(...savedItem.command.arguments);
    assert.equal(vscodeStub.__calls.created.length, countAfterLayoutChecks);
    assert.deepEqual(await savedView.provider.getChildren(), []);
    const missingDirectory = join(activationDir, "not-a-project");
    writeFileSync(savedFile, JSON.stringify({type: "session", id: "missing-project", cwd: missingDirectory}) + "\n");
    const refreshSaved = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.refreshSessions");
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: missingDirectory } }];
    refreshSaved.handler();
    const missingProject = (await savedSessionRows())[0];
    await resume.handler({ harnessId: missingProject.harnessId, id: missingProject.id });
    assert.equal(vscodeStub.__calls.created.length, countAfterLayoutChecks);
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: projectDirectory } }];
    vscodeStub.__calls.activeEditorHandlers.forEach((handler) => handler(undefined));
    assert.deepEqual(await savedView.provider.getChildren(), [], "changing projects refreshes and excludes records for the previous folder");
    writeFileSync(savedFile, JSON.stringify({type: "session", id: "recorded-prime", cwd: projectDirectory}) + "\n");
    refreshSaved.handler();
    assert.equal((await savedSessionRows()).length, 1);
    await selectSessionAgent.handler("codex");
    assert.deepEqual(await savedView.provider.getChildren(), [], "selecting another agent excludes the previous agent's sessions");
    await selectSessionAgent.handler("antigravity");
    assert.deepEqual(await savedView.provider.getChildren(), [], "Antigravity never displays another agent's saved history");
    const englishStrings = JSON.parse(readFileSync(join(projectRoot, "package.nls.json"), "utf8"));
    assert.equal(savedView.message, undefined);
    const agyStore = vscodeStub.__fixture.multiHarness.antigravity.sessionDirectory;
    const agyHistory = antigravityFixture(agyStore, projectDirectory);
    agyHistory.add("recorded-agy");
    agyHistory.db.close();
    refreshSaved.handler();
    const agySaved = (await savedSessionRows())[0];
    assert.equal(agySaved.id, "recorded-agy");
    assert.equal(savedView.provider.getTreeItem(agySaved).contextValue, "savedSessionReadOnly");
    const beforeAgyResume = vscodeStub.__calls.created.length;
    await resume.handler({ harnessId: "antigravity", id: "recorded-agy" });
    assert.equal(vscodeStub.__calls.created.length, beforeAgyResume + 1);
    assert.deepEqual(vscodeStub.__calls.created.at(-1).options.shellArgs, ["--conversation", "recorded-agy", ...agyArgs]);
    assert.equal(vscodeStub.__calls.created.at(-1).options.cwd, projectDirectory);
    rmSync(agyStore, { recursive: true, force: true });
    refreshSaved.handler();
    vscodeStub.__fixture.multiHarness.openCode.executablePath = fakeCli;
    vscodeStub.__fixture.multiHarness.openCode.arguments = ["--model", "test-model"];
    const openCodeStore = vscodeStub.__fixture.multiHarness.openCode.sessionDirectory;
    mkdirSync(openCodeStore, { recursive: true });
    const openCodeDb = new DatabaseSync(join(openCodeStore, "opencode.db"));
    openCodeDb.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_updated INTEGER, parent_id TEXT, time_archived INTEGER)");
    openCodeDb.prepare("INSERT INTO session VALUES (?, ?, ?, ?, NULL, NULL)").run("ses_recorded", projectDirectory, "OpenCode saved session", Date.now());
    openCodeDb.close();
    await selectSessionAgent.handler("openCode");
    assert.equal(savedView.message, undefined, "OpenCode is a supported saved-session provider");
    const openCodeSaved = (await savedSessionRows())[0];
    assert.equal(openCodeSaved.id, "ses_recorded");
    assert.equal(savedView.provider.getTreeItem(openCodeSaved).contextValue, "savedSessionReadOnly");
    const beforeOpenCodeResume = vscodeStub.__calls.created.length;
    await resume.handler({ harnessId: "openCode", id: "ses_recorded" });
    assert.equal(vscodeStub.__calls.created.length, beforeOpenCodeResume + 1);
    assert.deepEqual(vscodeStub.__calls.created.at(-1).options.shellArgs, ["--session", "ses_recorded", "--model", "test-model"]);
    assert.equal(vscodeStub.__calls.created.at(-1).options.cwd, projectDirectory);
    assert.equal(vscodeStub.__calls.created.at(-1).options.shellPath, fakeCli);
    rmSync(openCodeStore, { recursive: true, force: true });
    refreshSaved.handler();
    delete vscodeStub.__fixture.multiHarness.deepseek.arguments;
    await selectSessionAgent.handler("deepseek");
    assert.equal(savedView.message, undefined, "DeepSeek Harness is a supported saved-session provider");
    const dshStore = vscodeStub.__fixture.multiHarness.deepseek.sessionDirectory;
    const dshSessionDir = join(dshStore, "--recorded-project--", "recorded-deepseek");
    mkdirSync(dshSessionDir, { recursive: true });
    writeFileSync(join(dshSessionDir, "session.v4.jsonl.zstd"), Buffer.concat([
        zstdCompressSync(Buffer.from(JSON.stringify({ type: "session", version: 4, id: "recorded-deepseek", cwd: projectDirectory }) + "\n")),
        zstdCompressSync(Buffer.from(JSON.stringify({ type: "session/title", seq: 0, data: { title: "DeepSeek saved session" } }) + "\n")),
    ]));
    refreshSaved.handler();
    const dshSaved = (await savedSessionRows())[0];
    assert.equal(dshSaved.id, "recorded-deepseek");
    assert.equal(dshSaved.title, "DeepSeek saved session");
    assert.equal(savedView.provider.getTreeItem(dshSaved).contextValue, "savedSession");
    const beforeDshResume = vscodeStub.__calls.created.length;
    await resume.handler({ harnessId: "deepseek", id: "recorded-deepseek" });
    assert.equal(vscodeStub.__calls.created.length, beforeDshResume + 1);
    assert.deepEqual(vscodeStub.__calls.created.at(-1).options.shellArgs, ["--profile", "tui", "--resume", "recorded-deepseek"], "dsh launcher flags precede --resume");
    assert.equal(vscodeStub.__calls.created.at(-1).options.cwd, projectDirectory);
    vscodeStub.window.terminals = [];
    rmSync(dshStore, { recursive: true, force: true });
    refreshSaved.handler();
    await selectSessionAgent.handler("aider");
    assert.equal(savedView.message, englishStrings["sessionScope.unsupported"]);
    await selectSessionAgent.handler("primeAgent");
    assert.equal((await savedSessionRows()).length, 1);
    assert.ok(savedView.description.includes("Prime Agent"));
    assert.equal(savedState.get("workspace:selectedSessionAgent"), "primeAgent");
    vscodeStub.workspace.workspaceFolders = [];
    passed += 1;
    console.log("ok: saved conversations resume by identity in the recorded project and handle deleted files and missing projects");

    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: projectDirectory } }];
    refreshSaved.handler();
    const staleScan = savedView.provider.getChildren();
    await selectSessionAgent.handler("codex");
    assert.deepEqual(await staleScan, [], "in-flight scans cannot restore the previous agent's sessions");
    await selectSessionAgent.handler("primeAgent");
    assert.equal((await savedSessionRows()).length, 1);
    const originalSessionDirectory = vscodeStub.__fixture.multiHarness.primeAgent.sessionDirectory;
    for (const invalid of [null, 42, {}, ["invalid"]]) {
        vscodeStub.__fixture.multiHarness.primeAgent.sessionDirectory = invalid;
        refreshSaved.handler();
        assert.ok(Array.isArray(await savedView.provider.getChildren()), "invalid setting types cannot reject the view request");
    }
    vscodeStub.__fixture.multiHarness.primeAgent.sessionDirectory = join(savedRoot, "moved-away");
    refreshSaved.handler();
    assert.deepEqual(await savedView.provider.getChildren(), [], "a missing configured store leaves the session view empty");
    const originalGetConfiguration = vscodeStub.workspace.getConfiguration;
    vscodeStub.workspace.getConfiguration = () => { throw new Error("configuration unavailable"); };
    refreshSaved.handler();
    const failedRows = await savedView.provider.getChildren();
    assert.equal(failedRows.length, 1);
    assert.equal(failedRows[0].notice, true, "scan setup failures resolve as an empty history with a notice");
    vscodeStub.workspace.getConfiguration = originalGetConfiguration;
    vscodeStub.__fixture.multiHarness.primeAgent.sessionDirectory = originalSessionDirectory;
    refreshSaved.handler();
    assert.equal((await savedSessionRows()).length, 1, "refresh recovers after a transient failure");
    const fsPromises = requireFrom("node:fs/promises");
    const originalOpenDirectory = fsPromises.opendir;
    try {
        fsPromises.opendir = async (directory, ...args) => {
            if (directory === originalSessionDirectory) {
                throw Object.assign(new Error("access denied"), { code: "EACCES" });
            }
            return originalOpenDirectory(directory, ...args);
        };
        refreshSaved.handler();
        const deniedRows = await savedView.provider.getChildren();
        assert.deepEqual(deniedRows, [{ notice: true }], "directory permission failures leave history empty with a notice");
    } finally {
        fsPromises.opendir = originalOpenDirectory;
    }
    refreshSaved.handler();
    assert.equal((await savedSessionRows()).length, 1, "history returns after directory access is restored");
    passed += 1;
    console.log("ok: session views ignore stale scans, tolerate invalid configuration and recover after failure");

    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: projectDirectory } }];
    vscodeStub.__calls.activeEditorHandlers.forEach((handler) => handler(undefined));
    const layoutCommand = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.toggleSidebarLayout");
    vscodeStub.__fixture.multiHarness.sidebarLayout = "native";
    await layoutCommand.handler();
    assert.equal(vscodeStub.__fixture.multiHarness.sidebarLayout, "cards");
    await layoutCommand.handler();
    assert.equal(vscodeStub.__fixture.multiHarness.sidebarLayout, "native");
    assert.equal(vscodeStub.__calls.configUpdates.at(-1).target, vscodeStub.ConfigurationTarget.Global);

    const cardMessages = [];
    let receiveCardMessage;
    const cardsWebview = {
        cspSource: "https://local-webview.invalid",
        asWebviewUri(uri) { return { toString() { return `https://local-webview.invalid${uri.fsPath}`; } }; },
        postMessage(message) { cardMessages.push(message); return Promise.resolve(true); },
        onDidReceiveMessage(handler) { receiveCardMessage = handler; return { dispose() {} }; },
    };
    const cardsProvider = vscodeStub.__calls.webviews.find((view) => view.id === "multiHarness.cards").provider;
    cardsProvider.resolveWebviewView({
        webview: cardsWebview,
        onDidChangeVisibility() { return { dispose() {} }; },
        onDidDispose() { return { dispose() {} }; },
    });
    assert.ok(cardsWebview.options.enableScripts);
    assert.equal(cardsWebview.options.localResourceRoots[0].fsPath, join(projectRoot, "media"));
    assert.ok(cardsWebview.html.includes("default-src 'none'"));
    assert.ok(cardsWebview.html.includes("script-src 'nonce-"));
    await receiveCardMessage({ action: "ready" });
    assert.equal(cardMessages.at(-1).agents.length, agents.length);
    assert.deepEqual(cardMessages.at(-1).agents.map((agent) => agent.id), agentsView.provider.getChildren().map((agent) => agent.id), "cards and native views share the default order with favorites first");
    assert.equal(cardMessages.at(-1).agents.find((agent) => agent.id === "antigravity").name, "Antigravity CLI");
    assert.equal(cardMessages.at(-1).agents[0].id, "codex");
    assert.equal(cardMessages.at(-1).agents[0].favorite, true);
    assert.equal(cardMessages.at(-1).sessions.length, 0);
    assert.equal(cardMessages.at(-1).saved.length, 1, "cards show saved conversations even without terminal tabs");
    assert.equal(cardMessages.at(-1).saved[0].key, "primeAgent:recorded-prime");
    assert.equal(cardMessages.at(-1).scope.agentId, "primeAgent");
    assert.equal(cardMessages.at(-1).scope.project, "recorded-project");
    assert.equal(cardMessages.at(-1).agents.find((agent) => agent.id === "primeAgent").selected, true);
    await selectSessionAgent.handler("antigravity");
    await receiveCardMessage({ action: "ready" });
    assert.equal(cardMessages.at(-1).scope.agentId, "antigravity");
    assert.equal(cardMessages.at(-1).scope.message, undefined);
    assert.deepEqual(cardMessages.at(-1).saved, [], "Antigravity cannot display another agent's saved history");
    await addFavorite.handler(antigravity);
    await receiveCardMessage({ action: "ready" });
    assert.equal(cardMessages.at(-1).agents.find((agent) => agent.id === "antigravity").favorite, true);
    await removeFavorite.handler(antigravity);
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "open", id: "antigravity" });
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.openAntigravity"]);
    await selectSessionAgent.handler("codex");
    await receiveCardMessage({ action: "ready" });
    assert.deepEqual(cardMessages.at(-1).saved, [], "card sessions follow the selected agent filter");
    await selectSessionAgent.handler("primeAgent");
    await receiveCardMessage({ action: "ready" });
    assert.equal(cardMessages.at(-1).saved.length, 1);
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "resume", id: "primeAgent:recorded-prime" });
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.resumeSession", { harnessId: "primeAgent", id: "recorded-prime" }]);
    const messagesBeforeFavorite = cardMessages.length;
    await addFavorite.handler(primeAgent);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cardMessages.length, messagesBeforeFavorite + 1, "native favorite updates refresh the card model");
    assert.equal(cardMessages.at(-1).agents.find((agent) => agent.id === "primeAgent").favorite, true);
    await removeFavorite.handler(primeAgent);
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "open", id: "primeAgent" });
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.openPrimeAgent"]);
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "favorite", id: "codex" });
    assert.equal(vscodeStub.__calls.executed[0], "multiHarness.removeFavorite");
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "settings" });
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.openSettings"]);
    vscodeStub.window.terminals = [firstPrime, secondPrime];
    vscodeStub.__calls.terminalOpenHandlers.forEach((handler) => handler(firstPrime));
    vscodeStub.__calls.terminalOpenHandlers.forEach((handler) => handler(secondPrime));
    await new Promise((resolve) => setImmediate(resolve));
    const cardSession = cardMessages.at(-1).sessions[1];
    assert.equal(cardSession.label, "Prime Agent #2");
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "focus", id: cardSession.id });
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.focusSession", secondPrime]);
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "close", id: cardSession.id });
    assert.equal(vscodeStub.__calls.executed[0], "multiHarness.closeSession");
    assert.equal(vscodeStub.__calls.executed[1].terminal, secondPrime, "cards close the exact terminal by session identity");
    vscodeStub.window.terminals = [];
    vscodeStub.__calls.executed.length = 0;
    for (const message of [null, {}, {action: "open", id: "unknown"}, {action: "focus", id: cardSession.id}, {action: "close", id: cardSession.id}, {action: "close", id: "unknown"}, {action: "resume", id: "primeAgent:unlisted"}, {action: "executeCommand", id: "workbench.action.closeWindow"}]) {
        await receiveCardMessage(message);
    }
    assert.deepEqual(vscodeStub.__calls.executed, [], "unrecognized messages and stale sessions cannot execute commands");
    passed += 1;
    console.log("ok: card and native layouts share favorites, validate actions and focus exact sessions");

    const command = (id) => vscodeStub.__calls.commands.find((entry) => entry.id === `multiHarness.${id}`).handler;
    const selectionMode = command("toggleSessionSelectionMode");
    const cancelSelection = command("cancelSessionSelection");
    const toggleSession = command("toggleSessionSelection");
    const selectAll = command("selectAllSessions");
    const deleteOne = command("deleteSession");
    const deleteSelected = command("deleteSelectedSessions");
    const extraFiles = [join(primeSessions, "second.jsonl"), join(primeSessions, "third.jsonl")];
    const writeSession = (file, id, title = id) => writeFileSync(file,
        JSON.stringify({ type: "session", id, cwd: projectDirectory }) + "\n" + JSON.stringify({ type: "session_info", name: title }) + "\n");
    writeSession(extraFiles[0], "second", "Second conversation");
    writeSession(extraFiles[1], "third", "Third conversation");
    refreshSaved.handler();
    const getRow = async (id) => (await savedSessionRows()).find((row) => row.id === id);
    const deletionTerminal = (id, harnessId = "primeAgent", launchMode = "direct") => ({
        name: "same editable title",
        creationOptions: { env: { MULTI_HARNESS_TERMINAL_IDENTITY: JSON.stringify({ version: 1, harnessId, launchMode, sessionId: id }) } },
        disposed: 0,
        dispose() { this.disposed += 1; },
    });
    const secondTerminal = deletionTerminal("second");
    vscodeStub.window.terminals = [secondTerminal];
    const deletesBeforeCancel = vscodeStub.__calls.fsDeletes.length;
    await deleteOne({ harnessId: "primeAgent", id: "second" });
    assert.equal(vscodeStub.__calls.fsDeletes.length, deletesBeforeCancel, "canceling the first modal never touches disk");
    assert.equal(secondTerminal.disposed, 0, "canceling deletion preserves the linked terminal");
    assert.equal(vscodeStub.__calls.warnings.at(-1).options.modal, true);
    assert.ok(vscodeStub.__calls.warnings.at(-1).options.detail.includes("Second conversation"));
    const warningsBeforeStaleDelete = vscodeStub.__calls.warnings.length;
    await deleteOne({ harnessId: "primeAgent", id: "not-listed", file: extraFiles[0] });
    assert.equal(vscodeStub.__calls.warnings.length, warningsBeforeStaleDelete, "stale identifiers and supplied paths cannot trigger deletion");
    await selectionMode();
    let secondRow = await getRow("second");
    assert.equal(savedView.provider.getTreeItem(secondRow).checkboxState, 0);
    assert.equal(savedView.provider.getTreeItem(secondRow).command.command, "multiHarness.toggleSessionSelection");
    await toggleSession({ harnessId: "primeAgent", id: "second" });
    writeSession(extraFiles[0], "second", "Renamed conversation");
    refreshSaved.handler();
    secondRow = await getRow("second");
    assert.equal(savedView.provider.getTreeItem(secondRow).checkboxState, 1, "selection survives refresh and title changes by identity");
    await cancelSelection();
    await selectionMode();
    await selectAll(["primeAgent:third", "primeAgent:unknown"]);
    assert.equal(savedView.provider.getTreeItem(await getRow("third")).checkboxState, 1);
    assert.equal(savedView.provider.getTreeItem(await getRow("second")).checkboxState, 0, "filtered Select All only selects supplied, listed keys");
    await selectAll();
    await receiveCardMessage({ action: "ready" });
    assert.equal(cardMessages.at(-1).savedSelection.keys.length, 3, "native and card views share selections");
    await selectSessionAgent.handler("codex");
    await selectSessionAgent.handler("primeAgent");
    assert.equal(savedView.provider.getTreeItem(await getRow("second")).checkboxState, undefined, "changing scope exits selection mode");
    await selectionMode();
    secondRow = await getRow("second");
    const selectionDay = (await savedView.provider.getChildren())[0];
    for (const handler of savedView.checkboxHandlers) await handler({ items: [[selectionDay, 1], [{ notice: true }, 1]] });
    assert.equal(savedView.provider.getTreeItem(secondRow).checkboxState, 0, "native checkbox handlers ignore day groups and notices");
    for (const handler of savedView.checkboxHandlers) await handler({ items: [[secondRow, 1]] });
    assert.equal(savedView.provider.getTreeItem(secondRow).checkboxState, 1, "native checkbox events update shared state");
    for (const handler of savedView.checkboxHandlers) await handler({ items: [[secondRow, 0]] });
    await selectAll();
    const originalDelete = vscodeStub.workspace.fs.delete;
    const liveTerminal = firstPrime;
    const linkedTerminals = [deletionTerminal("recorded-prime"), deletionTerminal("recorded-prime", "primeAgent", "shell"), deletionTerminal("third")];
    linkedTerminals[0].name = "renamed conversation";
    const unrelatedTerminals = [liveTerminal, deletionTerminal("different-prime"), deletionTerminal("recorded-prime", "codex")];
    vscodeStub.window.terminals = [...linkedTerminals, secondTerminal, ...unrelatedTerminals];
    vscodeStub.workspace.fs.delete = async (uri, options) => {
        if (uri.fsPath === extraFiles[0] && options.useTrash) throw new Error("trash unavailable");
        return originalDelete(uri, options);
    };
    vscodeStub.__calls.warningResults.push("Move to Trash", undefined);
    await deleteSelected();
    assert.ok(!existsSync(savedFile) && !existsSync(extraFiles[1]), "successful trash deletions disappear");
    assert.ok(existsSync(extraFiles[0]), "declining permanent deletion preserves the failed record");
    assert.equal((await savedSessionRows()).length, 1);
    assert.equal(savedView.provider.getTreeItem(await getRow("second")).checkboxState, 1, "unsuccessful records remain selected");
    assert.ok(linkedTerminals.every((terminal) => terminal.disposed === 1), "bulk trash deletion closes every matching terminal, including renamed and shell terminals");
    assert.ok(unrelatedTerminals.every((terminal) => !terminal.disposed), "other conversations, agents and unlinked terminals stay open");
    assert.equal(secondTerminal.disposed, 0, "declining permanent deletion preserves the linked terminal");
    vscodeStub.window.terminals = [secondTerminal, ...unrelatedTerminals];
    assert.ok(vscodeStub.__calls.fsDeletes.slice(deletesBeforeCancel).every((entry) => entry.options.useTrash && !entry.options.recursive));
    vscodeStub.__calls.warningResults.push("Move to Trash", "Delete Permanently");
    await deleteSelected();
    assert.ok(!existsSync(extraFiles[0]));
    assert.equal(secondTerminal.disposed, 1, "successful permanent deletion closes the linked terminal");
    assert.equal(vscodeStub.__calls.fsDeletes.at(-1).options.useTrash, false, "permanent deletion requires the separate explicit approval");
    writeSession(extraFiles[0], "second");
    refreshSaved.handler();
    await selectAll();
    const failedTerminal = deletionTerminal("second");
    vscodeStub.window.terminals = [failedTerminal];
    vscodeStub.workspace.fs.delete = async () => { throw new Error("permission denied"); };
    vscodeStub.__calls.warningResults.push("Move to Trash", "Delete Permanently");
    const deletionErrorsBeforeFailure = vscodeStub.__calls.errors.length;
    await deleteSelected();
    assert.equal(vscodeStub.__calls.errors.length, deletionErrorsBeforeFailure + 1);
    assert.equal(failedTerminal.disposed, 0, "failed deletion preserves the linked terminal");
    assert.ok(existsSync(extraFiles[0]));
    assert.equal(savedView.provider.getTreeItem(await getRow("second")).checkboxState, 1);
    vscodeStub.workspace.fs.delete = originalDelete;
    // Mutate the cached file after it was listed: deletion must revalidate disk.
    writeFileSync(extraFiles[0], JSON.stringify({ type: "session", id: "second", cwd: projectDirectory }) + "\n" + JSON.stringify({ type: "session", id: "another", cwd: projectDirectory }) + "\n");
    const deletesBeforeSharedFile = vscodeStub.__calls.fsDeletes.length;
    vscodeStub.__calls.warningResults.push("Move to Trash");
    await deleteSelected();
    assert.equal(vscodeStub.__calls.fsDeletes.length, deletesBeforeSharedFile);
    assert.ok(vscodeStub.__calls.errors.at(-1).includes("another conversation"));
    writeSession(extraFiles[0], "second");
    refreshSaved.handler();
    const warningsBeforeConcurrent = vscodeStub.__calls.warnings.length;
    vscodeStub.__calls.warningResults.push("Move to Trash");
    await cancelSelection();
    await Promise.all([deleteOne({ harnessId: "primeAgent", id: "second" }), deleteOne({ harnessId: "primeAgent", id: "second" })]);
    assert.equal(failedTerminal.disposed, 1, "single-session deletion closes its linked terminal once");
    assert.equal(vscodeStub.__calls.warnings.length, warningsBeforeConcurrent + 1, "concurrent deletion commands produce one confirmation and operation");
    assert.ok(!existsSync(extraFiles[0]));
    writeSession(savedFile, "recorded-prime");
    await cancelSelection();
    vscodeStub.window.terminals = [];
    refreshSaved.handler();
    await receiveCardMessage({ action: "ready" });
    assert.equal(cardMessages.at(-1).savedSelection.mode, false);
    for (const [action, expected] of [["delete", "deleteSession"], ["toggleSelection", "toggleSessionSelection"]]) {
        vscodeStub.__calls.executed.length = 0;
        await receiveCardMessage({ action, id: "primeAgent:recorded-prime" });
        assert.deepEqual(vscodeStub.__calls.executed, [`multiHarness.${expected}`, { harnessId: "primeAgent", id: "recorded-prime" }]);
    }
    vscodeStub.__calls.executed.length = 0;
    await receiveCardMessage({ action: "delete", id: "primeAgent:not-listed", file: savedFile });
    assert.deepEqual(vscodeStub.__calls.executed, []);
    passed += 1;
    console.log("ok: native/card selection, cancellation, trash fallback, partial failures, identity revalidation and concurrent deletion preserve the correct conversations");

    // Editor focus may move to an editor-area terminal. All launch surfaces and
    // the saved-session filter must retain the last focused workspace folder.
    const folderA = { uri: { fsPath: join(activationDir, "project-a") } };
    const workspaceCli = process.platform === "win32" ? "workspace-omp.cmd" : "workspace-omp";
    const folderB = { uri: { fsPath: join(activationDir, "project-b") } };
    for (const folder of [folderA, folderB]) {
        mkdirSync(join(folder.uri.fsPath, "node_modules", ".bin"), { recursive: true });
        const cli = join(folder.uri.fsPath, "node_modules", ".bin", workspaceCli);
        writeFileSync(cli, "#!/bin/sh\n");
        chmodSync(cli, 0o755);
        vscodeStub.__scopedFixtures.set(folder.uri.fsPath, { multiHarness: {
            ohMyPi: { executablePath: "workspace-omp", arguments: ["--project", folder.uri.fsPath] },
        } });
    }
    const previousGetFolder = vscodeStub.workspace.getWorkspaceFolder;
    vscodeStub.workspace.getWorkspaceFolder = (uri) => vscodeStub.workspace.workspaceFolders.find((folder) =>
        uri.fsPath === folder.uri.fsPath || uri.fsPath.startsWith(folder.uri.fsPath + sep));
    vscodeStub.workspace.workspaceFolders = [folderA, folderB];
    const focusEditor = (folder) => {
        vscodeStub.window.activeTextEditor = folder ? { document: { uri: { fsPath: join(folder.uri.fsPath, "file.ts") } } } : undefined;
        vscodeStub.__calls.activeEditorHandlers.forEach((handler) => handler(vscodeStub.window.activeTextEditor));
    };
    focusEditor(folderB);
    focusEditor(undefined);
    assert.ok(savedView.description.includes("project-b"));
    const workspaceOpen = vscodeStub.__calls.commands.find((command) => command.id === "multiHarness.openOhMyPi");
    await workspaceOpen.handler();
    const workspaceLaunch = vscodeStub.__calls.created.at(-1).options;
    assert.equal(workspaceLaunch.cwd, folderB.uri.fsPath);
    assert.equal(workspaceLaunch.shellPath, join(folderB.uri.fsPath, "node_modules", ".bin", workspaceCli));
    assert.deepEqual(workspaceLaunch.shellArgs, ["--project", folderB.uri.fsPath]);
    const ompProfile = vscodeStub.__calls.profiles.find((profile) => profile.id === "multiHarness.ohMyPi");
    const workspaceProfile = ompProfile.provider.provideTerminalProfile({});
    assert.equal(workspaceProfile.options.cwd, folderB.uri.fsPath);
    assert.equal(workspaceProfile.options.isTransient, false, "profile terminals allow persistence across reloads");
    assert.deepEqual(workspaceProfile.options.location, { viewColumn: vscodeStub.ViewColumn.Active }, "terminal profiles use the active editor group");
    assert.equal(workspaceProfile.options.shellPath, workspaceLaunch.shellPath);
    vscodeStub.workspace.workspaceFolders = [folderA];
    vscodeStub.__calls.workspaceFolderHandlers.forEach((handler) => handler({}));
    assert.ok(savedView.description.includes("project-a"), "removed folders are no longer retained");
    assert.equal(ompProfile.provider.provideTerminalProfile({}).options.cwd, folderA.uri.fsPath);
    passed += 1;
    console.log("ok: command, profile and sidebar keep the last focused project and forget removed folders");

    // Resume must use the recorded project's resource settings and local CLI,
    // even if another project's editor becomes active after listing sessions.
    vscodeStub.workspace.workspaceFolders = [folderA, folderB];
    const ompSessions = vscodeStub.__fixture.multiHarness.ohMyPi.sessionDirectory;
    mkdirSync(ompSessions, { recursive: true });
    const ompFile = join(ompSessions, "project-b-session.jsonl");
    writeFileSync(ompFile, JSON.stringify({ type: "session", id: "project-b-session", cwd: folderB.uri.fsPath }) + "\n");
    focusEditor(folderB);
    const projectBSession = (await savedSessionRows()).find((session) => session.id === "project-b-session");
    assert.ok(projectBSession);
    // Set the editor directly while retaining the listed session, reproducing
    // the window between a focus change and the view's next refresh.
    vscodeStub.window.activeTextEditor = { document: { uri: { fsPath: join(folderA.uri.fsPath, "file.ts") } } };
    vscodeStub.window.terminals = [];
    const launchesBeforeStaleResume = vscodeStub.__calls.created.length;
    await resume.handler({ harnessId: "ohMyPi", id: projectBSession.id });
    assert.equal(vscodeStub.__calls.created.length, launchesBeforeStaleResume, "a stale request from another project does not open a terminal");
    await resumeLauncher.openAgentTerminal(context, agents.find((agent) => agent.id === "ohMyPi"), undefined, {
        terminalName: "Oh My Pi — project-b-session", cwd: folderB.uri.fsPath, args: ["--resume", ompFile],
    });
    const projectBResume = vscodeStub.__calls.created.at(-1).options;
    assert.equal(projectBResume.cwd, folderB.uri.fsPath);
    assert.equal(projectBResume.isTransient, false, "resumed conversation terminals allow persistence across reloads");
    assert.equal(projectBResume.shellPath, join(folderB.uri.fsPath, "node_modules", ".bin", workspaceCli));
    assert.deepEqual(projectBResume.shellArgs, ["--resume", ompFile, "--project", folderB.uri.fsPath]);
    // External recorded directories use their own resource scope, not the
    // first workspace folder's settings.
    const externalFolder = join(activationDir, "external-project");
    mkdirSync(externalFolder);
    vscodeStub.__scopedFixtures.set(externalFolder, { multiHarness: { ohMyPi: { executablePath: fakeCli, arguments: ["--external"] } } });
    writeFileSync(ompFile, JSON.stringify({ type: "session", id: "external-session", cwd: externalFolder }) + "\n");
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: externalFolder } }];
    focusEditor(undefined);
    assert.equal((await savedSessionRows())[0].id, "external-session");
    vscodeStub.workspace.workspaceFolders = [folderA];
    await resumeLauncher.openAgentTerminal(context, agents.find((agent) => agent.id === "ohMyPi"), undefined, {
        terminalName: "Oh My Pi — external-session", cwd: externalFolder, args: ["--resume", ompFile],
    });
    const externalResume = vscodeStub.__calls.created.at(-1).options;
    assert.equal(externalResume.cwd, externalFolder);
    assert.equal(externalResume.shellPath, fakeCli);
    assert.deepEqual(externalResume.shellArgs, ["--resume", ompFile, "--external"]);
    passed += 1;
    console.log("ok: resuming sessions uses recorded project settings and executable lookup across editor focus changes");

    vscodeStub.__scopedFixtures.clear();
    vscodeStub.workspace.getWorkspaceFolder = previousGetFolder;
    vscodeStub.window.terminals = [];
    focusEditor(undefined);
    vscodeStub.workspace.workspaceFolders = [];
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
    vscodeStub.window.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    await ohMyPi.handler();
    assert.equal(vscodeStub.window.tabGroups.all.length, 1, "new agent launches join existing editor splits");
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
    assert.deepEqual(created?.location, { viewColumn: vscodeStub.ViewColumn.Active }, "direct launches use the active editor group");
    passed += 1;
    console.log("ok: configured executablePath and arguments are read with relative keys and reach createTerminal");

    const preservedLaunchGroups = [{ tabs: [{ label: "file.ts" }] }, { tabs: [] }];
    vscodeStub.window.terminals = [];
    vscodeStub.window.tabGroups.all = preservedLaunchGroups;
    vscodeStub.__fixture.multiHarness.useFullEditorArea = false;
    await ohMyPi.handler();
    const preservedLaunch = vscodeStub.__calls.created.at(-1);
    assert.equal(vscodeStub.window.tabGroups.all, preservedLaunchGroups, "disabled full area preserves groups when opening an agent");
    assert.deepEqual(preservedLaunch.options.location, { viewColumn: vscodeStub.ViewColumn.Active });
    vscodeStub.window.terminals = [preservedLaunch.terminal];
    vscodeStub.__fixture.multiHarness.useFullEditorArea = true;
    const countBeforeLayoutToggle = vscodeStub.__calls.created.length;
    await ohMyPi.handler();
    assert.equal(vscodeStub.window.tabGroups.all.length, 1, "enabling full area affects the next launch without a reload");
    assert.equal(vscodeStub.__calls.created.length, countBeforeLayoutToggle + 1, "opening the same agent starts a fresh conversation");
    assert.equal(preservedLaunch.terminal.shown, 1, "fresh launch does not reveal the previous conversation");
    assert.notEqual(vscodeStub.__calls.created.at(-1).terminal, preservedLaunch.terminal);
    const singleGroup = vscodeStub.window.tabGroups.all;
    await ohMyPi.handler();
    assert.equal(vscodeStub.window.tabGroups.all, singleGroup, "a single group needs no additional layout command");
    delete vscodeStub.__fixture.multiHarness.useFullEditorArea;
    passed += 1;
    console.log("ok: repeated agent launches create separate terminals and honor full editor area changes");

    vscodeStub.window.terminals = [];
    const originalCreateTerminal = vscodeStub.window.createTerminal;
    vscodeStub.window.createTerminal = () => { throw new Error("terminal service unavailable"); };
    const errorsBeforeFailure = vscodeStub.__calls.errors.length;
    await ohMyPi.handler();
    assert.equal(vscodeStub.__calls.errors.length, errorsBeforeFailure + 1);
    assert.ok(vscodeStub.__calls.errors.at(-1).includes("could not be opened"));
    vscodeStub.window.createTerminal = originalCreateTerminal;
    await ohMyPi.handler();
    assert.equal(vscodeStub.__calls.created.at(-1).options.shellPath, fakeCli, "a later launch recovers normally");
    passed += 1;
    console.log("ok: terminal service failures report an error without rejecting agent commands and allow retry");

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
    vscodeStub.__calls.executed.length = 0;
    vscodeStub.window.showQuickPick = (items) => {
        const item = items.find((entry) => entry.harness.id === "antigravity");
        assert.equal(item.label, "Antigravity CLI");
        return Promise.resolve(item);
    };
    await picker.handler();
    assert.deepEqual(vscodeStub.__calls.executed, ["multiHarness.openAntigravity"]);
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
    assert.equal(directOptions.isTransient, false, "direct terminals allow persistence across reloads");
    assert.equal(vscodeStub.__calls.statusItems.length, 0, "direct mode must not create a status-bar item");
    assert.equal(vscodeStub.__calls.infos.length, 0, "direct mode must not announce shell-integration fallback");
    passed += 1;
    console.log("ok: direct mode sets shellPath and never creates a status-bar item");

    // (ii) shell mode: no shellPath, and the agent runs through the two-argument
    // executeCommand overload once shell integration activates.
    baseline();
    vscodeStub.__fixture.multiHarness.launchMode = "shell";
    vscodeStub.window.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    const shellPromise = ohMyPi.handler();
    await new Promise((resolve) => setImmediate(resolve));
    const shellOptions = vscodeStub.__calls.created.at(-1)?.options;
    assert.ok(shellOptions, "shell mode must create a terminal");
    assert.equal(shellOptions.isTransient, false, "shell terminals allow persistence across reloads");
    assert.equal(vscodeStub.window.tabGroups.all.length, 1, "shell-mode sessions join existing editor splits");
    assert.equal(shellOptions.shellPath, undefined, "shell mode must not override shellPath");
    assert.deepEqual(shellOptions.location, { viewColumn: vscodeStub.ViewColumn.Active }, "shell launches use the active editor group");
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
    vscodeStub.__fixture.multiHarness.useFullEditorArea = false;
    const preservedShellGroups = [{ tabs: [] }, { tabs: [] }];
    vscodeStub.window.tabGroups.all = preservedShellGroups;
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
    assert.equal(vscodeStub.window.tabGroups.all, preservedShellGroups, "shell mode also preserves the layout when full area is disabled");
    assert.equal(vscodeStub.__calls.sendTexts.length, 0, "nothing is sent before the timeout fires");
    assert.ok(pendingTimeouts.length >= 1, "shell mode arms the integration timeout");
    assert.equal(pendingTimeouts[0].delay, 10000, `integration timeout is 10s (saw ${pendingTimeouts[0].delay})`);
    pendingTimeouts[0].callback();
    await fallbackPromise;
    delete vscodeStub.__fixture.multiHarness.useFullEditorArea;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    const sendText = vscodeStub.__calls.sendTexts.at(-1)?.text ?? "";
    const expectedFallback = process.platform === "win32" ? `"${fakeCli}" "--continue"` : `'${fakeCli}' '--continue'`;
    assert.equal(sendText, expectedFallback, `fallback quoting rule (saw ${sendText})`);
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
    assert.equal(sessionsView.disposed, true);
    assert.equal(vscodeStub.__calls.terminalOpenHandlers.length, 0);
    assert.equal(vscodeStub.__calls.terminalCloseHandlers.length, 0);
    assert.equal(vscodeStub.__calls.activeTerminalHandlers.length, 0);

    // Recreate API objects and reload the bundle, as an extension-host restart
    // does. Only VS Code's persisted creation options survive, not object identity.
    const restoredTerminal = (options, name = options.name) => ({
        name, creationOptions: JSON.parse(JSON.stringify(options)), shown: 0,
        show() { this.shown += 1; }, dispose() {},
    });
    const restoredConversation = restoredTerminal(resumed.options, "renamed after reload");
    const restoredSameTitle = restoredTerminal(sameTitleTerminal.options, restoredConversation.name);
    const restoredShell = restoredTerminal(shellOptions, "renamed shell");
    const restoredDirect = restoredTerminal(directOptions, "renamed direct");
    const invalidMetadata = restoredTerminal({ env: { MULTI_HARNESS_TERMINAL_IDENTITY: "{broken" } }, "Oh My Pi");
    const foreignTerminal = restoredTerminal({ name: "Oh My Pi" });
    vscodeStub.window.terminals = [restoredSameTitle, restoredConversation, restoredDirect,
        invalidMetadata, foreignTerminal];
    const statusBeforeReload = vscodeStub.__calls.statusItems.length;
    delete requireFrom.cache[requireFrom.resolve(join(activationDir, "extension.cjs"))];
    const freshExtension = requireFrom(join(activationDir, "extension.cjs"));
    const reloadedContext = { ...context, subscriptions: [] };
    freshExtension.activate(reloadedContext);
    assert.equal(vscodeStub.__calls.statusItems.length, statusBeforeReload, "direct, unmarked and malformed terminals do not acquire shell tracking");
    const countBeforeRestore = vscodeStub.__calls.created.length;
    const primeHarness = agents.find((agent) => agent.id === "primeAgent");
    await resumeLauncher.openAgentTerminal(reloadedContext, primeHarness, undefined, {
        sessionId: "recorded-prime", terminalName: "a changed conversation title", cwd: projectDirectory, args: [],
    });
    assert.equal(vscodeStub.__calls.created.length, countBeforeRestore, "cold reload reuses the saved identity without starting a process");
    assert.equal(restoredConversation.shown, 1);
    assert.equal(restoredSameTitle.shown, 0, "identical titles cannot select another conversation");
    await resumeLauncher.openAgentTerminal(reloadedContext, agents.find((agent) => agent.id === "ohMyPi"));
    assert.equal(restoredDirect.shown, 0, "new conversations do not reveal a restored default terminal");
    assert.equal(foreignTerminal.shown, 0);
    assert.equal(vscodeStub.__calls.created.length, countBeforeRestore + 1);

    // A terminal can arrive after activation. Restoring tracking must never
    // send or execute the agent command a second time.
    const sendsBeforeRestore = vscodeStub.__calls.sendTexts.length;
    vscodeStub.window.terminals.push(restoredShell);
    for (const handler of vscodeStub.__calls.terminalOpenHandlers) handler(restoredShell);
    for (const handler of vscodeStub.__calls.terminalOpenHandlers) handler(restoredShell);
    assert.equal(vscodeStub.__calls.statusItems.length, statusBeforeReload + 1, "late shell restoration registers tracking once");
    assert.equal(vscodeStub.__calls.sendTexts.length, sendsBeforeRestore);
    assert.equal(vscodeStub.__calls.created.length, countBeforeRestore + 1);
    const restoredStatus = vscodeStub.__calls.statusItems.at(-1);
    vscodeStub.__calls.executionEndHandlers.at(-1)({ terminal: restoredShell, execution: {}, exitCode: 0 });
    assert.ok(restoredStatus.text.includes("— ?s (exit 0)"), "commands started before reload report unknown duration");
    const restoredExecution = {};
    vscodeStub.__calls.executionStartHandlers.at(-1)({ terminal: restoredShell, execution: restoredExecution });
    assert.equal(restoredStatus.text, "$(sync~spin) Oh My Pi");
    vscodeStub.__calls.executionEndHandlers.at(-1)({ terminal: restoredShell, execution: restoredExecution, exitCode: 0 });
    assert.ok(!restoredStatus.text.includes("?s"), "new commands retain duration tracking after reload");
    passed += 1;
    console.log("ok: cold reload and late restoration preserve conversation identity and shell tracking without relaunching agents");
    const reloadedView = vscodeStub.__calls.views.filter((view) => view.id === "multiHarness.agents").at(-1);
    assert.equal(reloadedView.provider.getChildren()[0].id, "codex");
    assert.equal(reloadedView.provider.getTreeItem(codex).contextValue, "favoriteAgent");
    assert.equal(reloadedView.provider.getChildren().length, agents.length);
    for (const subscription of reloadedContext.subscriptions) {
        subscription.dispose();
    }
    passed += 1;
    console.log("ok: favorites survive extension reactivation through persisted global state");
    const startupContext = { ...context, subscriptions: [] };
    const beforeStartupRestore = vscodeStub.__calls.statusItems.length;
    freshExtension.activate(startupContext);
    assert.equal(vscodeStub.__calls.statusItems.length, beforeStartupRestore + 1, "shell terminals already present at activation regain tracking");
    for (const subscription of startupContext.subscriptions) subscription.dispose();
    vscodeStub.window.terminals = [];

    await build({
        entryPoints: [join(projectRoot, "src", "extension.ts")],
        outfile: join(activationDir, "extension.windows.cjs"), bundle: true, format: "cjs", platform: "node",
        external: ["vscode"], define: { "process.platform": '"win32"' }, logLevel: "silent",
    });
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: projectDirectory } }];
    vscodeStub.window.activeTextEditor = undefined;
    const windowsContext = { ...context, subscriptions: [] };
    requireFrom(join(activationDir, "extension.windows.cjs")).activate(windowsContext);
    const windowsCommand = (id) => vscodeStub.__calls.commands.filter((entry) => entry.id === `multiHarness.${id}`).at(-1).handler;
    const ompRoot = vscodeStub.__fixture.multiHarness.ohMyPi.sessionDirectory;
    mkdirSync(ompRoot, { recursive: true });
    const crumbs = join(ompRoot, "..", "terminal-sessions");
    mkdirSync(crumbs, { recursive: true });
    const freshFile = join(ompRoot, "fresh.jsonl");
    const switchedFile = join(ompRoot, "switched.jsonl");
    writeSession(freshFile, "fresh-omp");
    writeSession(switchedFile, "switched-omp");
    const freshOmp = deletionTerminal(undefined, "ohMyPi");
    const switchedOmp = deletionTerminal("fresh-omp", "ohMyPi", "shell");
    freshOmp.creationOptions.env.MULTI_HARNESS_TERMINAL_IDENTITY = JSON.stringify({ version: 1, harnessId: "ohMyPi", launchMode: "direct", terminalSessionId: "fresh-tab" });
    switchedOmp.creationOptions.env.MULTI_HARNESS_TERMINAL_IDENTITY = JSON.stringify({ version: 1, harnessId: "ohMyPi", launchMode: "shell", sessionId: "fresh-omp", terminalSessionId: "switched-tab" });
    writeFileSync(join(crumbs, "apple-fresh-tab"), `${projectDirectory}\n${freshFile}\nfresh\n`);
    writeFileSync(join(crumbs, "apple-switched-tab"), `${projectDirectory}\n${switchedFile}\n`);
    vscodeStub.window.terminals = [freshOmp, switchedOmp];
    await windowsCommand("selectSessionAgent")("ohMyPi");
    vscodeStub.__calls.warningResults.push("Move to Trash");
    await windowsCommand("deleteSession")({ harnessId: "ohMyPi", id: "fresh-omp" });
    assert.equal(freshOmp.disposed, 1, "deleting a fresh OMP session closes its renamed terminal without a launch session ID");
    assert.equal(switchedOmp.disposed, 0, "an OMP terminal switched to another session stays open despite its old launch ID");
    vscodeStub.__calls.warningResults.push("Move to Trash");
    await windowsCommand("deleteSession")({ harnessId: "ohMyPi", id: "switched-omp" });
    assert.equal(switchedOmp.disposed, 1, "deletion follows the currently active OMP session after an in-process switch");
    for (const subscription of windowsContext.subscriptions) subscription.dispose();
    vscodeStub.window.terminals = [];
    passed += 1;
    console.log("ok: OMP deletion follows live terminal breadcrumbs for fresh and switched sessions");

    if (process.platform === "linux") {
        await build({
            entryPoints: [join(projectRoot, "src", "terminalIdentity.ts")],
            outfile: join(activationDir, "identity.cjs"), bundle: true, format: "cjs", platform: "node", external: ["vscode"], logLevel: "silent",
        });
        const identities = requireFrom(join(activationDir, "identity.cjs"));
        const codexRoot = vscodeStub.__fixture.multiHarness.codex.sessionDirectory;
        mkdirSync(codexRoot, { recursive: true });
        const codexFiles = ["fresh-codex", "switched-codex"].map((id) => join(codexRoot, `${id}.jsonl`));
        for (const [index, file] of codexFiles.entries()) {
            writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { id: ["fresh-codex", "switched-codex"][index], cwd: projectDirectory } }) + "\n");
        }
        const codexScript = `
            const fs = require("node:fs");
            process.title = "codex";
            const files = process.argv.slice(1);
            let fd = fs.openSync(files[0], "a");
            fs.openSync(files[1], "r");
            process.stdout.write("ready\\n");
            process.stdin.on("data", () => {
                fs.closeSync(fd);
                fd = fs.openSync(files[1], "a");
                process.stdout.write("ready\\n");
            });
        `;
        // Exercise a shell/Node wrapper, not only the terminal's immediate PID.
        const wrapperScript = `
            const { spawn } = require("node:child_process");
            const child = spawn(process.execPath, ["-e", ${JSON.stringify(codexScript)}, ...process.argv.slice(1)], { stdio: "inherit" });
            process.on("SIGTERM", () => child.kill());
            child.on("exit", () => process.exit());
        `;
        const codexProcess = spawn(process.execPath, ["-e", wrapperScript, ...codexFiles], {
            env: { ...process.env, MULTI_HARNESS_TERMINAL_IDENTITY: JSON.stringify({ version: 1, harnessId: "codex", launchMode: "shell" }) },
            stdio: ["pipe", "pipe", "inherit"],
        });
        const ready = () => new Promise((resolve, reject) => {
            codexProcess.stdout.once("data", resolve);
            codexProcess.once("error", reject);
        });
        const codexContext = { ...context, subscriptions: [] };
        try {
            await ready();
            const freshCodex = deletionTerminal(undefined, "codex");
            freshCodex.processId = Promise.resolve(codexProcess.pid);
            // The same live process can be restored without its creation options.
            const reconnectedCodex = deletionTerminal(undefined, "codex", "shell");
            reconnectedCodex.creationOptions = {};
            reconnectedCodex.processId = Promise.resolve(codexProcess.pid);
            const otherCodex = deletionTerminal("unrelated-codex", "codex");
            vscodeStub.window.terminals = [freshCodex, reconnectedCodex, otherCodex];
            freshExtension.activate(codexContext);
            const codexCommand = (id) => vscodeStub.__calls.commands.filter((entry) => entry.id === `multiHarness.${id}`).at(-1).handler;
            await codexCommand("selectSessionAgent")("codex");
            assert.deepEqual(await identities.codexTerminalSessionFiles(freshCodex, codexRoot), [codexFiles[0]], "only writable Codex rollouts identify the active conversation");
            vscodeStub.__calls.warningResults.push("Move to Trash");
            await codexCommand("deleteSession")({ harnessId: "codex", id: "switched-codex" });
            assert.equal(freshCodex.disposed, 0, "reading another session does not link its deletion to this terminal");
            // Recreate the second session and switch the running CLI to it.
            writeFileSync(codexFiles[1], JSON.stringify({ type: "session_meta", payload: { id: "switched-codex", cwd: projectDirectory } }) + "\n");
            const switched = ready();
            codexProcess.stdin.write("switch\n");
            await switched;
            freshCodex.creationOptions.env.MULTI_HARNESS_TERMINAL_IDENTITY = JSON.stringify({ version: 1, harnessId: "codex", launchMode: "direct", sessionId: "fresh-codex" });
            vscodeStub.__calls.warningResults.push("Move to Trash");
            await codexCommand("deleteSession")({ harnessId: "codex", id: "fresh-codex" });
            assert.equal(freshCodex.disposed, 0, "live Codex identity overrides the old resumed session ID after a switch");
            await codexCommand("deleteSession")({ harnessId: "codex", id: "switched-codex" });
            assert.equal(freshCodex.disposed, 0, "canceling deletion leaves a fresh Codex terminal open");
            const diskDelete = vscodeStub.workspace.fs.delete;
            try {
                vscodeStub.workspace.fs.delete = async () => { throw new Error("permission denied"); };
                vscodeStub.__calls.warningResults.push("Move to Trash", "Delete Permanently");
                await codexCommand("deleteSession")({ harnessId: "codex", id: "switched-codex" });
                assert.equal(freshCodex.disposed, 0, "failed Codex deletion preserves the terminal");
            } finally {
                vscodeStub.workspace.fs.delete = diskDelete;
            }
            vscodeStub.__calls.warningResults.push("Move to Trash");
            await codexCommand("deleteSession")({ harnessId: "codex", id: "switched-codex" });
            assert.equal(freshCodex.disposed, 1, "successful deletion closes a Codex terminal matched through its live rollout");
            assert.equal(reconnectedCodex.disposed, 1, "successful deletion also closes a renamed reconnected Codex terminal");
            assert.equal(otherCodex.disposed, 0, "unrelated Codex terminals remain open");
            passed += 1;
            console.log("ok: Codex deletion follows live rollout files through wrappers, reconnection and session switches");
        } finally {
            for (const subscription of codexContext.subscriptions) subscription.dispose();
            const exited = new Promise((resolve) => codexProcess.once("exit", resolve));
            codexProcess.kill();
            await exited;
            vscodeStub.window.terminals = [];
        }
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            env: { ...process.env, ...resumed.options.env }, stdio: "ignore",
        });
        const shellChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            env: { ...process.env, ...shellOptions.env }, stdio: "ignore",
        });
        const procContext = { ...context, subscriptions: [] };
        try {
            await Promise.all([child, shellChild].map((process) => new Promise((resolve, reject) => {
                process.once("spawn", resolve); process.once("error", reject);
            })));
            // Browser reconnection can return no original launch options at all.
            const procConversation = restoredTerminal({}, "renamed reconnected conversation");
            procConversation.processId = Promise.resolve(child.pid);
            const procShell = restoredTerminal({}, "renamed reconnected shell");
            procShell.processId = Promise.resolve(shellChild.pid);
            vscodeStub.window.terminals = [procConversation, procShell];
            const countBeforeProc = vscodeStub.__calls.created.length;
            const statusBeforeProc = vscodeStub.__calls.statusItems.length;
            freshExtension.activate(procContext);
            await resumeLauncher.openAgentTerminal(procContext, primeHarness, undefined, {
                sessionId: "recorded-prime", terminalName: "changed title", cwd: projectDirectory, args: [],
            });
            assert.equal(vscodeStub.__calls.created.length, countBeforeProc);
            assert.equal(procConversation.shown, 1, "Linux process metadata reuses a conversation without creation options");
            for (let attempt = 0; attempt < 100 && vscodeStub.__calls.statusItems.length === statusBeforeProc; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            assert.equal(vscodeStub.__calls.statusItems.length, statusBeforeProc + 1, "Linux shell process metadata restores tracking");
            assert.equal((await identities.restoreTerminalIdentity(procConversation)).sessionId, "recorded-prime");
            for (const value of [null, "{broken", "[]", '{"version":2}', '{"version":1,"harnessId":"unknown","launchMode":"shell"}']) {
                assert.equal(await identities.restoreTerminalIdentity(restoredTerminal({ env: { MULTI_HARNESS_TERMINAL_IDENTITY: value } })), undefined);
            }
            assert.equal(await identities.restoreTerminalIdentity({ creationOptions: {}, processId: Promise.resolve(-1) }), undefined);
            assert.equal(await identities.restoreTerminalIdentity({ creationOptions: {}, processId: Promise.resolve(2147483647) }), undefined, "vanished processes fail gracefully");
            passed += 1;
            console.log("ok: real Linux processes restore conversation identity and shell tracking when code-server omits launch metadata");
        } finally {
            for (const subscription of procContext.subscriptions) subscription.dispose();
            const exits = [child, shellChild].map((process) => process.exitCode === null
                ? new Promise((resolve) => process.once("exit", resolve)) : Promise.resolve());
            child.kill(); shellChild.kill();
            await Promise.all(exits);
            vscodeStub.window.terminals = [];
        }
    }
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
assert.deepEqual(Object.keys(iconSources).sort(), [...HARNESS_IDS].sort(), "every harness has an attributed icon source");
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

await import(pathToFileURL(join(here, "test-sidebar.mjs")).href);
passed += 1;
await import(pathToFileURL(join(here, "validate-manifest.mjs")).href);

console.log(`\n${passed} test group(s) passed and manifest validation passed.`);
