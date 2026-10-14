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
    "primeAgent",
];

const agentCommandIds = harnessIds.map((id) => `multiHarness.open${id.charAt(0).toUpperCase()}${id.slice(1)}`);
const allCommandIds = [...agentCommandIds, "multiHarness.openAgentPicker", "multiHarness.openSettings", "multiHarness.addFavorite", "multiHarness.removeFavorite", "multiHarness.focusSession"];

// The source table must agree with the manifest.
const sourceHarnessIds = [...readFileSync(join(root, "src", "harnesses.ts"), "utf8").matchAll(/id: "([a-z][A-Za-z]*)", displayName: "/g)].map((m) => m[1]);
check(JSON.stringify(sourceHarnessIds) === JSON.stringify(harnessIds), "src/harnesses.ts id order matches the harness id list");
const sourceCommandIds = [...readFileSync(join(root, "src", "harnesses.ts"), "utf8").matchAll(/commandId: "([^"]+)"/g)].map((m) => m[1]);
agentCommandIds.forEach((id, index) => check(sourceCommandIds[index] === id, `src/harnesses.ts command ${index} is ${id}`));

// The registration must use the literal ids from the table, never a
// concatenation (the headless activation test in scripts/test.mjs proves this
// at runtime; this check catches the pattern statically as well).
const extensionSource = readFileSync(join(root, "src", "extension.ts"), "utf8");
check(
    extensionSource.includes("registerCommand(harness.commandId"),
    "src/extension.ts registers the literal harness.commandId"
);
check(
    !/registerCommand\(\s*`/.test(extensionSource),
    "src/extension.ts does not build command ids with a template literal"
);

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
check(commandIdList.length === allCommandIds.length, "all agent and utility commands are contributed");
check(new Set(commandIdList).size === commandIdList.length, "no duplicate command ids");
const activationEvents = manifest.activationEvents ?? [];
const activityContainer = manifest.contributes.viewsContainers?.activitybar?.find((container) => container.id === "multiHarness");
check(activityContainer?.title === "%viewContainer.title%" && typeof nls["viewContainer.title"] === "string", "Activity Bar container uses its localized title");
check(typeof activityContainer?.icon === "string" && existsSync(join(root, activityContainer.icon)), "Activity Bar icon exists");
const agentsView = manifest.contributes.views?.multiHarness?.find((view) => view.id === "multiHarness.agents");
check(agentsView?.name === "%view.agents.name%" && typeof nls["view.agents.name"] === "string", "Agents view has a localized name");
check(activationEvents.includes("onView:multiHarness.agents"), "opening the Agents view activates the extension on VS Code 1.67+");
const sessionsView = manifest.contributes.views?.multiHarness?.find((view) => view.id === "multiHarness.sessions");
check(sessionsView?.name === "%view.sessions.name%" && typeof nls["view.sessions.name"] === "string", "Open Sessions view has a localized name");
check(activationEvents.includes("onView:multiHarness.sessions"), "opening the sessions view activates the extension");
check(manifest.contributes.viewsWelcome?.some((entry) => entry.view === "multiHarness.sessions" && entry.contents === "%view.sessions.welcome%") && typeof nls["view.sessions.welcome"] === "string", "sessions view has a localized empty state");
check(manifest.contributes.menus?.commandPalette?.some((entry) => entry.command === "multiHarness.focusSession" && entry.when === "false"), "session focus command is hidden from the palette because it requires a terminal");
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
    if (["multiHarness.addFavorite", "multiHarness.removeFavorite"].includes(command.command)) {
        check(icon === (command.command === "multiHarness.addFavorite" ? "$(star-empty)" : "$(star-full)"), `favorite command ${command.command} uses its star icon`);
        continue;
    }
    if (command.command === "multiHarness.openSettings") {
        check(icon === "$(gear)", "settings command uses the gear icon");
        continue;
    }
    if (["multiHarness.openAgentPicker", "multiHarness.focusSession"].includes(command.command)) {
        check(icon === undefined, `${command.command} has no icon`);
        continue;
    }
    check(typeof icon === "object" && typeof icon.light === "string" && typeof icon.dark === "string", `command ${command.command} declares light+dark icons`);
    check(existsSync(join(root, icon.light)), `icon file ${icon.light} exists`);
    check(existsSync(join(root, icon.dark)), `icon file ${icon.dark} exists`);
}

// Menu entries: all agent commands, same ordering/when as harnesses
const settingsButton = manifest.contributes.menus?.["view/title"]?.find((entry) => entry.command === "multiHarness.openSettings");
check(settingsButton?.when === "view == multiHarness.agents" && settingsButton?.group === "navigation", "settings button appears in the Agents view toolbar");
for (const [command, contextValue] of [["multiHarness.addFavorite", "agent"], ["multiHarness.removeFavorite", "favoriteAgent"]]) {
    const button = manifest.contributes.menus?.["view/item/context"]?.find((entry) => entry.command === command);
    check(button?.when === `view == multiHarness.agents && viewItem == ${contextValue}` && button?.group === "inline", `${command} appears on the matching agent row`);
    check(manifest.contributes.menus?.commandPalette?.some((entry) => entry.command === command && entry.when === "false"), `${command} is hidden from the palette because it requires an agent row`);
}
const menus = manifest.contributes.menus?.["editor/title"] ?? [];
check(menus.length === harnessIds.length, "editor/title has one menu entry per harness");
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
const launchMode = properties["multiHarness.launchMode"];
check(
    launchMode?.type === "string" && JSON.stringify(launchMode?.enum) === JSON.stringify(["direct", "shell"]) &&
        launchMode?.default === "direct" && launchMode?.scope === "window",
    "setting multiHarness.launchMode is a direct|shell string enum defaulting to direct (window scope)"
);
check(
    Array.isArray(launchMode?.enumDescriptions) && launchMode.enumDescriptions.length === 2,
    "multiHarness.launchMode documents each enum value"
);
for (const id of settingIds) {
    check(typeof properties[id]?.description === "string" && properties[id].description.startsWith("%"), `setting ${id} description uses an %nls% placeholder`);
    check(typeof nls[properties[id].description.slice(1, -1)] === "string", `nls key for setting ${id} exists in package.nls.json`);
}

// Harness ids unique and lowercase-first (JSON keys)
check(new Set(harnessIds).size === harnessIds.length, "harness ids are unique");
check(harnessIds.every((id) => /^[a-z][A-Za-z]*$/.test(id)), "harness ids are lowercase-first");

// Terminal profiles: one per harness with a matching activation event.
const profiles = manifest.contributes.terminal ?? [];
check(profiles.length === harnessIds.length, "one terminal profile is contributed per harness");
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
for (const key of ["launchMode.description", "launchMode.direct.description", "launchMode.shell.description"]) {
    check(typeof nls[key] === "string" && typeof nlsTr?.[key] === "string", `nls key ${key} exists in both bundles`);
}
}

// Settings keys: reads go through the section-relative `settingKey`, while the
// settings UI needs the fully-qualified `fullSettingKey`. The headless
// activation test in scripts/test.mjs proves this at runtime against VS Code's
// real relative-lookup semantics.
const harnessSource = readFileSync(join(root, "src", "harnesses.ts"), "utf8");
const settingKeyBody = harnessSource.match(/export function settingKey[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
check(
    settingKeyBody.includes("return `${harness.id}.${setting}`"),
    "settingKey() returns the section-relative key (no leading multiHarness. prefix)"
);
const fullKeyBody = harnessSource.match(/export function fullSettingKey[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
check(
    fullKeyBody.includes("multiHarness.${settingKey(harness, setting)}"),
    "fullSettingKey() returns the fully-qualified setting id"
);
const launchSource = readFileSync(join(root, "src", "launch.ts"), "utf8");
check(
    /config\.get<[^>]*>\(\s*settingKey\(/.test(launchSource),
    "src/launch.ts reads settings with the relative settingKey()"
);
check(
    /"workbench\.action\.openSettings",\s*\n\s*fullSettingKey\(harness, "executablePath"\)/.test(launchSource),
    "src/launch.ts opens settings with the fully-qualified id"
);

// Shell mode is gated on runtime feature detection because the shell-integration
// API is stable only since VS Code 1.93 while engines stays ^1.67.0.
const launchSrc = readFileSync(join(root, "src", "launch.ts"), "utf8");
check(
    launchSrc.includes("hasShellIntegrationApi()"),
    "src/launch.ts gates shell mode on runtime shell-integration feature detection"
);
check(
    launchSrc.includes("onDidChangeTerminalShellIntegration"),
    "src/launch.ts waits for shell integration via the change event"
);
check(
    readFileSync(join(root, "src", "status.ts"), "utf8").includes("onDidStartTerminalShellExecution"),
    "src/status.ts subscribes to shell execution events"
);

// Manifest-contract basics
check(manifest.name === "multi-harness-terminal-editor", "extension name matches the contract");
check(manifest.engines?.vscode === "^1.67.0", "engines.vscode is ^1.67.0");
check(manifest.version === "0.6.0", "manifest version matches the 0.6.0 development version");
check(manifest.extensionKind?.length === 1 && manifest.extensionKind[0] === "workspace", "extensionKind is workspace");
check(manifest.capabilities?.virtualWorkspaces?.supported === false, "virtual workspaces are rejected");
check(manifest.capabilities?.untrustedWorkspaces?.supported === false, "untrusted workspaces are rejected");
check(manifest.dependencies === undefined || Object.keys(manifest.dependencies).length === 0, "no runtime dependencies");

if (failures > 0) {
    console.error(`\n${failures} manifest check(s) failed.`);
    process.exit(1);
}
