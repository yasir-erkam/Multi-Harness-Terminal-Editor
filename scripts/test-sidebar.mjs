// Exercise browser event handlers, including the refresh between two clicks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this.className = "";
        this.value = "";
    }
    append(...nodes) {
        for (const node of nodes) {
            node.parent = this;
            this.children.push(node);
        }
    }
    insertBefore(node, before) {
        node.parent = this;
        this.children.splice(this.children.indexOf(before), 0, node);
    }
    replaceChildren(...nodes) {
        this.children.forEach((node) => { node.parent = undefined; });
        this.children = [];
        this.append(...nodes);
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
    dispatch(type, event = {}) { this.listeners[type]?.forEach((handler) => handler(event)); }
    matches(selector) {
        if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
        if (selector === "button[data-action]") return this.tag === "button" && Boolean(this.dataset.action);
        return this.tag === selector;
    }
    querySelectorAll(selector) {
        return this.children.flatMap((node) => [ ...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector) ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    focus() { document.activeElement = this; }
    get classList() {
        return { toggle: (name, active) => {
            const classes = new Set(this.className.split(" "));
            if (active) classes.add(name); else classes.delete(name);
            this.className = [...classes].join(" ");
        } };
    }
}

const app = new Element("main");
const document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
    getElementById: () => app,
    documentElement: { lang: "en" },
};
const messages = [];
let receive;
runInNewContext(readFileSync(new URL("../media/sidebar.js", import.meta.url), "utf8"), {
    document,
    window: {
        sidebarLabels: JSON.parse(readFileSync(new URL("../package.nls.json", import.meta.url), "utf8")),
        addEventListener: (_type, handler) => { receive = handler; },
    },
    acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message), getState: () => ({}), setState() {} }),
});

const agent = { id: "codex", name: "Codex", favorite: false, selected: false, lightIcon: "light.svg", darkIcon: "dark.svg" };
const state = { type: "state", agents: [agent], sessions: [], saved: [] };
receive({ data: state });
const launch = app.querySelector(".launch");
messages.length = 0;
launch.focus();
launch.dispatch("click");
assert.equal(messages.length, 1);
assert.equal(messages[0].action, "selectAgent", "one click only selects the history filter");
assert.equal(messages[0].id, "codex");
receive({ data: { ...state, agents: [{ ...agent, selected: true }] } });
assert.equal(app.querySelector(".launch"), launch, "selection refresh preserves the DOM target for a browser double click");
assert.ok(launch.closest(".agent-card").className.includes("selected-agent"));
launch.dispatch("click");
launch.dispatch("dblclick");
assert.equal(messages.filter((message) => message.action === "open").length, 1, "double click opens exactly once");
messages.length = 0;
launch.dispatch("keydown", { key: "Enter", preventDefault() {} });
assert.equal(messages[0].action, "open", "Enter remains an explicit keyboard launch");
console.log("ok: card single click selects history; refresh preserves double click and keyboard launch");

const terminals = [
    { id: "terminal-1", label: "Prime Agent #1", active: false },
    { id: "terminal-2", label: "Prime Agent #2", active: true },
];
receive({ data: { ...state, sessions: terminals } });
const closeButtons = app.querySelectorAll(".close-terminal");
assert.equal(closeButtons.length, 2, "each open terminal has a close button");
assert.equal(closeButtons[1].attributes["aria-label"], "Close Terminal: Prime Agent #2");
assert.equal(closeButtons[1].parent, app.querySelectorAll(".session")[1].parent);
assert.equal(closeButtons[1].closest(".session"), undefined, "close is separate from the focus button");
messages.length = 0;
closeButtons[1].dispatch("click");
assert.equal(messages.length, 1);
assert.equal(messages[0].action, "close");
assert.equal(messages[0].id, "terminal-2", "close targets the selected terminal identity");
receive({ data: { ...state, sessions: [terminals[0]] } });
assert.equal(app.querySelectorAll(".close-terminal").length, 1, "closed terminals disappear after refresh");
messages.length = 0;
app.querySelector(".session").dispatch("click");
assert.equal(messages[0].action, "focus", "the remaining terminal can still be focused");
assert.equal(messages[0].id, "terminal-1");
console.log("ok: each card terminal closes by identity with an accessible button separate from focus");

const savedRows = [
    { key: "codex:first", title: "First conversation", harness: "Codex", project: "example", cwd: "/example", modified: new Date(2026, 9, 19, 15).getTime() },
    { key: "codex:second", title: "Second conversation", harness: "Codex", project: "example", cwd: "/example", modified: new Date(2026, 9, 19, 9).getTime() },
];
const olderRow = { ...savedRows[0], key: "codex:older", title: "Older conversation", modified: new Date(2026, 9, 18, 23, 59).getTime() };
const midnightRow = { ...savedRows[0], key: "codex:midnight", title: "Midnight conversation", modified: new Date(2026, 9, 19, 0, 1).getTime() };
const groupedRows = [olderRow, savedRows[1], midnightRow, savedRows[0]];
document.documentElement.lang = "de";
receive({ data: { ...state, saved: groupedRows, savedUnreadable: true } });
const dayGroups = app.querySelectorAll(".saved-day");
assert.equal(dayGroups.length, 2, "history groups by local calendar date, including either side of midnight");
assert.deepEqual(app.querySelectorAll(".saved-session").map((row) => row.dataset.id),
    ["codex:first", "codex:second", "codex:midnight", "codex:older"], "days and sessions are newest first regardless of input order");
const dayHeading = dayGroups[0].querySelector("h3");
assert.equal(dayHeading.textContent, new Date(savedRows[0].modified).toLocaleDateString("de", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
}), "day headings use the webview language and include the year");
assert.equal(dayGroups[0].attributes["aria-labelledby"], dayHeading.id, "each day region is named by its heading");
assert.equal(dayGroups[0].querySelectorAll(".saved-session").length, 3);
assert.equal(dayGroups[1].querySelectorAll(".saved-session").length, 1);
const savedList = app.querySelector(".saved-list");
assert.equal(savedList.parent.querySelector(".count").textContent, "4", "the count includes sessions, not headings or notices");
assert.ok(savedList.querySelector(".empty"), "an unreadable notice remains visible alongside grouped sessions");
const groupedSearch = app.querySelector(".search");
groupedSearch.value = "older";
groupedSearch.dispatch("input");
assert.equal(app.querySelectorAll(".saved-day").length, 1, "filtering removes empty day groups");
assert.equal(app.querySelector(".saved-session").dataset.id, "codex:older");
assert.equal(savedList.parent.querySelector(".count").textContent, "1");
groupedSearch.value = "no matching conversation";
groupedSearch.dispatch("input");
assert.equal(app.querySelectorAll(".saved-day").length, 0, "no-results renders without orphan day headings");
assert.equal(savedList.parent.querySelector(".count").textContent, "0");
assert.equal(savedList.querySelectorAll(".empty").length, 2, "no-results and unreadable notices both remain visible");
groupedSearch.value = "";
document.documentElement.lang = "en";
console.log("ok: localized accessible local-day history groups preserve ordering, filtering, counts and unreadable notices");
receive({ data: { ...state, saved: savedRows, savedSelection: { mode: false, busy: false, keys: [] } } });
messages.length = 0;
app.querySelector(".saved-session").dispatch("click");
assert.equal(messages[0].action, "resume", "normal clicks still resume a conversation");
messages.length = 0;
app.querySelector(".delete-session").dispatch("click");
assert.equal(messages[0].action, "delete");
assert.equal(messages[0].id, "codex:first");
messages.length = 0;
app.querySelector(".selection-mode").dispatch("click");
assert.equal(messages[0].action, "selectionMode");
receive({ data: { ...state, saved: savedRows, savedSelection: { mode: true, busy: false, keys: ["codex:first"] } } });
const checkbox = app.querySelector(".session-checkbox");
assert.equal(checkbox.checked, true);
assert.equal(app.querySelectorAll(".session-checkbox").length, 2);
messages.length = 0;
checkbox.focus();
checkbox.dispatch("change");
assert.equal(messages[0].action, "toggleSelection");
receive({ data: { ...state, saved: savedRows, savedSelection: { mode: true, busy: false, keys: ["codex:first"] } } });
assert.equal(document.activeElement, app.querySelector(".session-checkbox"), "selection refresh restores keyboard focus");
assert.equal(app.querySelector(".delete-selected").textContent, "Delete Selected (1)");
messages.length = 0;
app.querySelector(".saved-session").dispatch("click");
assert.equal(messages[0].action, "toggleSelection", "selection mode never resumes on row clicks");
const search = app.querySelector(".search");
search.value = "second";
search.dispatch("input");
assert.equal(app.querySelectorAll(".saved-session").length, 1);
messages.length = 0;
app.querySelector(".select-all").dispatch("click");
assert.deepEqual(Array.from(messages[0].keys), ["codex:second"], "Select All only requests search-visible conversations");
receive({ data: { ...state, saved: savedRows, savedSelection: { mode: true, busy: true, keys: ["codex:first"] } } });
assert.equal(app.querySelector(".selection-mode").disabled, true);
assert.equal(app.querySelector(".delete-selected").disabled, true);
assert.equal(app.querySelector(".session-checkbox").disabled, true);
assert.equal(app.querySelector(".delete-session").disabled, true);
console.log("ok: card selection, filtered Select All, trash actions, selected count and busy controls preserve normal resume behavior");

search.value = "";
receive({ data: { ...state, saved: groupedRows, savedSelection: { mode: true, busy: false, keys: ["codex:first", "codex:older"] } } });
assert.equal(app.querySelectorAll(".session-checkbox").length, 4, "only sessions receive checkboxes, never day headings");
assert.equal(app.querySelectorAll(".session-checkbox").filter((node) => node.checked).length, 2, "selection spans day groups");
messages.length = 0;
app.querySelector(".select-all").dispatch("click");
assert.deepEqual(Array.from(messages[0].keys), ["codex:first", "codex:second", "codex:midnight", "codex:older"], "Select All crosses day groups without including headings");
search.value = "older";
search.dispatch("input");
assert.equal(app.querySelector(".delete-selected").textContent, "Delete Selected (2)", "search does not discard selected sessions in hidden day groups");
messages.length = 0;
app.querySelector(".saved-session").dispatch("click");
assert.equal(messages[0].action, "toggleSelection");
assert.equal(messages[0].id, "codex:older", "grouped selection still targets the session identity");
console.log("ok: selection spans day groups while headings stay outside checkbox and Select All actions");
