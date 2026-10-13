// Static manifest checks. Fails (nonzero exit) when any invariant is broken.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const nls = JSON.parse(readFileSync(join(root, "package.nls.json"), "utf8"));

const harnessIds = [
    "claudeCode",
    "codex",
    "openCode",
    "pi",
    "ohMyPi",
    "gemini",
    "copilot",
    "cursorAgent",
    "aider",
    "crush",
    "qwen",
    "goose",
];

const agentCommandIds = harnessIds.map((id) => `multiHarness.open${id.charAt(0).toUpperCase()}${id.slice(1)}`);
const allCommandIds = [...agentCommandIds, "multiHarness.openAgentPicker"];

// The source table must agree with the manifest.
const sourceHarnessIds = [...readFileSync(join(root, "src", "harnesses.ts"), "utf8").matchAll(/id: "([a-z][A-Za-z]*)", displayName: "/g)].map((m) => m[1]);
check(JSON.stringify(sourceHarnessIds) === JSON.stringify(harnessIds), "src/harnesses.ts id order matches the harness id list");
const sourceCommandIds = [...readFileSync(join(root, "src", "harnesses.ts"), "utf8").matchAll(/commandId: "([^"]+)"/g)].map((m) => m[1]);
agentCommandIds.forEach((id, index) => check(sourceCommandIds[index] === id, `src/harnesses.ts command ${index} is ${id}`));

let failures = 0;
function check(condition, message) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures += 1;
        console.error(`FAIL: ${message}`);
    }
}

// Commands + activation events
const commands = manifest.contributes.commands ?? [];
const commandIdList = commands.map((command) => command.command);
check(commandIdList.length === 13, "exactly 13 commands are contributed");
check(new Set(commandIdList).size === 13, "no duplicate command ids");
const activationEvents = manifest.activationEvents ?? [];
for (const id of allCommandIds) {
    check(commandIdList.includes(id), `command ${id} exists`);
    check(activationEvents.includes(`onCommand:${id}`), `activation event onCommand:${id} exists`);
}

// Titles come from nls keys (no hard-coded title strings)
for (const command of commands) {
    check(command.title.startsWith("%") && command.title.endsWith("%"), `command ${command.command} title uses an %nls% placeholder`);
    const key = command.title.slice(1, -1);
    check(typeof nls[key] === "string", `nls key ${key} exists in package.nls.json`);
}

// Icon files exist, picker has none
for (const command of commands) {
    const icon = command.icon;
    if (command.command === "multiHarness.openAgentPicker") {
        check(icon === undefined, "picker command has no icon");
        continue;
    }
    check(typeof icon === "object" && typeof icon.light === "string" && typeof icon.dark === "string", `command ${command.command} declares light+dark icons`);
    check(existsSync(join(root, icon.light)), `icon file ${icon.light} exists`);
    check(existsSync(join(root, icon.dark)), `icon file ${icon.dark} exists`);
}

// Menu entries: exactly the 12 agent commands, same ordering/when as harnesses
const menus = manifest.contributes.menus?.["editor/title"] ?? [];
check(menus.length === 12, "editor/title has exactly 12 menu entries");
const menuIds = menus.map((entry) => entry.command);
check(!menuIds.includes("multiHarness.openAgentPicker"), "picker command has no editor/title menu entry");
agentCommandIds.forEach((id, index) => {
    check(menuIds[index] === id, `editor/title entry ${index} opens ${id}`);
    const entry = menus[index];
    check(/navigation@\d+/.test(entry.group ?? ""), `menu entry ${id} uses navigation group`);
    const expectedWhen = `config.multiHarness.show${harnessIds[index].charAt(0).toUpperCase()}${harnessIds[index].slice(1)}Icon`;
    check(entry.when === expectedWhen, `menu entry ${id} when-clause is ${expectedWhen}`);
});

// Settings
const properties = manifest.contributes.configuration?.properties ?? {};
const settingIds = Object.keys(properties);
check(new Set(settingIds).size === settingIds.length, "no duplicate setting ids");
for (const id of harnessIds) {
    const showId = `multiHarness.show${id.charAt(0).toUpperCase()}${id.slice(1)}Icon`;
    check(properties[showId]?.type === "boolean" && properties[showId]?.default === false && properties[showId]?.scope === "window", `setting ${showId} is boolean/false/window`);
    const execId = `multiHarness.${id}.executablePath`;
    check(properties[execId]?.type === "string" && properties[execId]?.scope === "machine-overridable", `setting ${execId} is string/machine-overridable`);
    const argsId = `multiHarness.${id}.arguments`;
    check(properties[argsId]?.type === "array" && Array.isArray(properties[argsId]?.default) && properties[argsId]?.scope === "resource", `setting ${argsId} is string array/resource`);
}
check(properties["multiHarness.notifyOnExit"]?.type === "boolean" && properties["multiHarness.notifyOnExit"]?.scope === "window", "setting multiHarness.notifyOnExit is boolean/window");
for (const id of settingIds) {
    check(typeof properties[id]?.description === "string" && properties[id].description.startsWith("%"), `setting ${id} description uses an %nls% placeholder`);
    check(typeof nls[properties[id].description.slice(1, -1)] === "string", `nls key for setting ${id} exists in package.nls.json`);
}

// Harness ids unique and lowercase-first (JSON keys)
check(new Set(harnessIds).size === harnessIds.length, "harness ids are unique");
check(harnessIds.every((id) => /^[a-z][A-Za-z]*$/.test(id)), "harness ids are lowercase-first");

// Terminal profiles: one per harness with a matching activation event.
const profiles = manifest.contributes.terminal ?? [];
check(profiles.length === 12, "exactly 12 terminal profiles are contributed");
const profileIds = profiles.map((profile) => profile.id);
harnessIds.forEach((id) => {
    const profileId = `multiHarness.${id}`;
    check(profileIds.includes(profileId), `terminal profile ${profileId} exists`);
    check(profiles.find((profile) => profile.id === profileId)?.title === `%terminal.profile.${id}.title%`, `terminal profile ${profileId} title uses an %nls% placeholder`);
    const nlsKey = profiles.find((profile) => profile.id === profileId)?.title.slice(1, -1);
    check(typeof nls[nlsKey] === "string", `nls key ${nlsKey} exists in package.nls.json`);
    check(activationEvents.includes(`onTerminalProfile:${profileId}`), `activation event onTerminalProfile:${profileId} exists`);
});

// Turkish localization mirrors every key of the default bundle.
let nlsTr;
try {
    nlsTr = JSON.parse(readFileSync(join(root, "package.nls.tr.json"), "utf8"));
} catch {
    nlsTr = undefined;
}
check(nlsTr !== undefined, "package.nls.tr.json is present and valid JSON");
if (nlsTr) {
    check(JSON.stringify(Object.keys(nlsTr).sort()) === JSON.stringify(Object.keys(nls).sort()), "package.nls.tr.json mirrors every package.nls.json key");
}

// Manifest-contract basics
check(manifest.name === "multi-harness-terminal-editor", "extension name matches the contract");
check(manifest.engines?.vscode === "^1.67.0", "engines.vscode is ^1.67.0");
check(["0.1.0", "0.1.1", "0.1.2", "0.2.0"].includes(manifest.version), "published versions are consumed; local 0.2.0 is the fresh one");
check(manifest.extensionKind?.length === 1 && manifest.extensionKind[0] === "workspace", "extensionKind is workspace");
check(manifest.capabilities?.virtualWorkspaces?.supported === false, "virtual workspaces are rejected");
check(manifest.capabilities?.untrustedWorkspaces?.supported === false, "untrusted workspaces are rejected");
check(manifest.dependencies === undefined || Object.keys(manifest.dependencies).length === 0, "no runtime dependencies");

if (failures > 0) {
    console.error(`\n${failures} manifest check(s) failed.`);
    process.exit(1);
}
