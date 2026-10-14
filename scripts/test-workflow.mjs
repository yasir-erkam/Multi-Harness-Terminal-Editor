import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "mhte-workflow-"));

function write(path, content) {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    writeFileSync(join(fixture, path), content);
}

try {
    write("package.json", JSON.stringify({ name: "test-extension", version: "1.2.3" }));
    mkdirSync(join(fixture, "scripts"));
    copyFileSync(join(here, "dev.mjs"), join(fixture, "scripts/dev.mjs"));
    for (const [file, step] of [
        ["node_modules/typescript/bin/tsc", "check"],
        ["esbuild.mjs", "build"],
        ["scripts/test.mjs", "test"],
        ["scripts/test-workflow.mjs", "workflow-test"],
        ["node_modules/@vscode/vsce/vsce", "package"],
    ]) {
        write(file, `
            ${file.endsWith(".mjs") ? 'import * as fs from "node:fs";' : 'const fs = require("node:fs");'}
            fs.appendFileSync("steps.log", ${JSON.stringify(`${step}\n`)});
            if (process.env.MHTE_FAIL_STEP === "${step}") process.exit(7);
            if ("${step}" === "package") {
                const args = process.argv.slice(2);
                if (!args.includes("--no-dependencies")) process.exit(8);
                fs.writeFileSync(args[args.indexOf("--out") + 1], "test vsix");
            }
        `);
    }

    const run = (action, extraEnv = {}) => spawnSync(process.execPath, [join(fixture, "scripts/dev.mjs"), action], {
        cwd: tmpdir(),
        env: { ...process.env, ...extraEnv },
        encoding: "utf8",
    });
    const packageResult = run("package");
    assert.equal(packageResult.status, 0, packageResult.stderr);
    assert.ok(existsSync(join(fixture, "artifacts/test-extension-1.2.3.vsix")), "VSIX uses manifest identity inside artifacts/");
    assert.ok(!existsSync(join(fixture, "test-extension-1.2.3.vsix")), "packaging leaves the repository root clean");
    const steps = readFileSync(join(fixture, "steps.log"), "utf8");
    assert.equal(steps, "check\nbuild\ntest\nworkflow-test\npackage\n");
    console.log("ok: workflow validates before packaging and uses artifacts/ even from another working directory");

    for (const step of ["check", "build", "test", "workflow-test"]) {
        write("steps.log", "");
        const result = run("package", { MHTE_FAIL_STEP: step });
        assert.notEqual(result.status, 0, `${step} failure propagates`);
        assert.ok(!readFileSync(join(fixture, "steps.log"), "utf8").includes("package"), `${step} failure prevents packaging`);
    }
    console.log("ok: failures in validation prevent packaging");
} finally {
    rmSync(fixture, { recursive: true, force: true });
}
