// Shared local/CI workflow. Uses installed tools directly, including without npm.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const action = process.argv[2];
const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` };

function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} failed (${result.signal ?? result.status}).`);
    }
}

function node(script, args = []) {
    run(process.execPath, [join(root, script), ...args]);
}

try {
    if (!["compile", "package", "install"].includes(action)) {
        throw new Error("Usage: node scripts/dev.mjs <compile|package|install>");
    }
    console.log(`Development workflow: ${action} (Node.js ${process.versions.node})`);
    node("node_modules/typescript/bin/tsc", ["-p", "tsconfig.json", "--noEmit"]);
    node("esbuild.mjs");
    node("scripts/test.mjs");
    node("scripts/test-workflow.mjs");

    if (action !== "compile") {
        const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        const outputDir = join(root, "artifacts");
        const vsix = join(outputDir, `${manifest.name}-${manifest.version}.vsix`);
        mkdirSync(outputDir, { recursive: true });
        node("node_modules/@vscode/vsce/vsce", ["package", "--no-dependencies", "--out", vsix]);
        console.log(`VSIX: ${vsix}`);

        if (action === "install") {
            const helper = "/usr/local/bin/install-extension";
            const codeServer = "/app/code-server/bin/code-server";
            if (existsSync(helper)) {
                run(helper, [vsix, "--force"]);
            } else if (existsSync(codeServer)) {
                run(codeServer, ["--install-extension", vsix, "--force"]);
            } else {
                throw new Error(`code-server installer unavailable. Install ${vsix} using Extensions > Install from VSIX.`);
            }
            console.log("Installed locally. Run Developer: Reload Window in code-server to load the updated extension.");
        }
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
