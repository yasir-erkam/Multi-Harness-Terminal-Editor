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

const savedRows = [
    { key: "codex:first", title: "First conversation", harness: "Codex", project: "example", cwd: "/example", modified: Date.now() },
    { key: "codex:second", title: "Second conversation", harness: "Codex", project: "example", cwd: "/example", modified: Date.now() },
];
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
