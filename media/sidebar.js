/* Shared commands and state come from the extension; the webview only renders. */
const vscode = acquireVsCodeApi();
const labels = window.sidebarLabels;
const t = (key) => labels[key] || key;
let state = { agents: [], sessions: [], saved: [] };
let agentStructure;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, text, action, id, title) {
    const node = element("button", className, text);
    node.type = "button";
    if (title) {
        node.title = title;
        node.setAttribute("aria-label", title);
    }
    if (action) {
        node.dataset.action = action;
        if (id) node.dataset.id = id;
        node.addEventListener("click", () => vscode.postMessage({ action, id }));
    }
    return node;
}

const app = document.getElementById("app");
const header = element("header", "brand");
const name = element("h1", "brand-name", "Multi-Harness");
name.append(element("span", "brand-mark", "YEÖ"));
const settings = button("icon-button settings-button", undefined, "settings", undefined, t("command.openSettings.title"));
const svgNamespace = "http://www.w3.org/2000/svg";
const gear = document.createElementNS(svgNamespace, "svg");
gear.setAttribute("viewBox", "0 0 24 24");
gear.setAttribute("aria-hidden", "true");
gear.setAttribute("focusable", "false");
const teeth = document.createElementNS(svgNamespace, "path");
teeth.setAttribute("d", "M10 2h4l.6 3 2.2 1.3 2.9-.9 2 3.4-2.3 2v2.5l2.3 2-2 3.4-2.9-.9-2.2 1.3-.6 3h-4l-.6-3-2.2-1.3-2.9.9-2-3.4 2.3-2v-2.5l-2.3-2 2-3.4 2.9.9L9.4 5Z");
const center = document.createElementNS(svgNamespace, "circle");
center.setAttribute("cx", "12");
center.setAttribute("cy", "12");
center.setAttribute("r", "3");
gear.append(teeth, center);
settings.append(gear);
header.append(name, settings);

function section(title) {
    const node = element("section");
    const heading = element("h2");
    const count = element("span", "count");
    heading.append(element("span", undefined, title), count);
    const body = element("div");
    node.append(heading, body);
    return { node, body, count };
}

const sessions = section(t("view.sessions.name"));
const saved = section(t("view.savedSessions.name"));
saved.node.querySelector("h2").append(button("icon-button refresh-button", "↻", "refresh", undefined, t("command.refreshSessions.title")));
saved.node.querySelector("h2").append(button("icon-button", "⌄", "selectAgent", undefined, t("command.selectSessionAgent.title")));
const scopeNote = element("p", "support-note scope-note");
saved.node.insertBefore(scopeNote, saved.body);
saved.body.className = "saved-list";
saved.body.append(element("p", "empty", t("sidebar.loading")));
saved.node.append(element("p", "support-note", t("sidebar.savedSupport")));
const agents = section(t("view.agents.name"));
const search = element("input", "search");
search.type = "search";
search.placeholder = t("sidebar.search");
search.setAttribute("aria-label", t("sidebar.search"));
search.value = vscode.getState()?.query || "";
search.addEventListener("input", () => {
    vscode.setState({ query: search.value });
    renderAgents();
    renderSaved();
    renderSessions();
});
agents.body.className = "agent-grid";
sessions.body.className = "session-list";
app.append(header, search, saved.node, sessions.node, agents.node);

function renderSaved() {
    const scope = state.scope || {};
    scopeNote.textContent = [scope.agentName, scope.project].filter(Boolean).join(" · ") || t("command.selectSessionAgent.title");
    scopeNote.title = scope.cwd || "";
    const query = search.value.trim().toLocaleLowerCase();
    const matching = (state.saved || []).filter((session) =>
        `${session.title} ${session.harness} ${session.project}`.toLocaleLowerCase().includes(query));
    saved.count.textContent = String(matching.length);
    saved.body.replaceChildren();
    if (state.savedUnreadable) {
        saved.body.append(element("p", "empty", t("savedSessions.unreadable")));
    }
    if (matching.length === 0) {
        saved.body.append(element("p", "empty", scope.message || t(query ? "sidebar.noResults" : "sidebar.noSavedSessions")));
    }
    for (const session of matching) {
        const row = button("saved-session", undefined, "resume", session.key,
            `${t("command.resumeSession.title")}: ${session.title}\n${session.cwd}`);
        const date = new Date(session.modified).toLocaleDateString(document.documentElement.lang);
        row.append(element("span", "saved-title", session.title),
            element("span", "saved-meta", `${session.harness} · ${session.project} · ${date}`));
        saved.body.append(row);
    }
}

function renderAgents() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = state.agents.filter((agent) => agent.name.toLocaleLowerCase().includes(query));
    agents.count.textContent = String(visible.length);
    const structure = JSON.stringify(visible.map(({ selected, ...agent }) => agent));
    if (structure === agentStructure) {
        // Keep the clicked DOM node alive between the first and second click.
        for (const agent of visible) {
            const launch = Array.from(agents.body.querySelectorAll(".launch")).find((node) => node.dataset.id === agent.id);
            launch.closest(".agent-card").classList.toggle("selected-agent", Boolean(agent.selected));
            if (agent.selected) launch.setAttribute("aria-current", "true");
            else launch.removeAttribute("aria-current");
            launch.querySelector(".agent-hint").textContent = agent.selected ? `${t("sidebar.selected")} · ${t("sidebar.doubleClickOpen")}` : t("sidebar.select");
        }
        return;
    }
    agentStructure = structure;
    agents.body.replaceChildren();
    if (visible.length === 0) {
        agents.body.append(element("p", "empty", t("sidebar.noResults")));
    }
    for (const agent of visible) {
        const card = element("article", `agent-card${agent.favorite ? " favorite" : ""}${agent.selected ? " selected-agent" : ""}`);
        const launch = button("launch", undefined, "selectAgent", agent.id, `${agent.name} — ${t("sidebar.select")}. ${t("sidebar.doubleClickOpen")}.`);
        launch.addEventListener("dblclick", () => vscode.postMessage({ action: "open", id: agent.id }));
        launch.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                vscode.postMessage({ action: "open", id: agent.id });
            }
        });
        if (agent.selected) launch.setAttribute("aria-current", "true");
        const icons = element("span", "agent-icon");
        for (const theme of ["light", "dark"]) {
            const img = element("img", `${theme}-icon`);
            img.src = agent[`${theme}Icon`];
            img.alt = "";
            img.width = 24;
            img.height = 24;
            icons.append(img);
        }
        const copy = element("span", "agent-copy");
        copy.append(element("span", "agent-name", agent.name), element("span", "agent-hint", agent.selected ? `${t("sidebar.selected")} · ${t("sidebar.doubleClickOpen")}` : t("sidebar.select")));
        launch.append(icons, copy);
        const star = button("star", agent.favorite ? "★" : "☆", "favorite", agent.id,
            `${t(agent.favorite ? "command.removeFavorite.title" : "command.addFavorite.title")}: ${agent.name}`);
        star.setAttribute("aria-pressed", String(agent.favorite));
        card.append(launch, star);
        agents.body.append(card);
    }
}

function renderSessions() {
    const query = search.value.trim().toLocaleLowerCase();
    const matching = state.sessions.filter((session) => session.label.toLocaleLowerCase().includes(query));
    sessions.count.textContent = String(matching.length);
    sessions.body.replaceChildren();
    if (matching.length === 0) {
        sessions.body.append(element("p", "empty", t(query ? "sidebar.noResults" : "sidebar.noSessions")));
    }
    for (const session of matching) {
        const row = button(`session${session.active ? " active" : ""}`, undefined, "focus", session.id,
            `${t("command.focusSession.title")}: ${session.label}`);
        row.append(element("span", "session-dot", "●"), element("span", "session-name", session.label));
        if (session.active) {
            row.setAttribute("aria-current", "true");
            row.append(element("span", "active-label", t("sidebar.active")));
        }
        sessions.body.append(row);
    }
}

window.addEventListener("message", (event) => {
    if (event.data?.type !== "state") return;
    const focused = document.activeElement;
    const previous = focused?.dataset.action ? { action: focused.dataset.action, id: focused.dataset.id } : undefined;
    state = event.data;
    renderSessions();
    renderSaved();
    renderAgents();
    if (previous) {
        const replacement = Array.from(app.querySelectorAll("button[data-action]")).find((node) =>
            node.dataset.action === previous.action && node.dataset.id === previous.id);
        replacement?.focus();
    }
});
vscode.postMessage({ action: "ready" });
