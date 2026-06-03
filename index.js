const PANEL_ID = "file-browser";

export default function activate(context) {
  ensureToolbarButton(context.app);
  const panel = ensurePanel(context.app);
  const state = { files: [], statusMap: {}, expanded: new Set(), selectedPath: "", query: "" };

  panel.addEventListener("click", (event) => {
    const target = event.target.closest("[data-file-browser-action]");
    if (!target || !panel.contains(target)) return;
    event.preventDefault();
    handleAction(context, state, panel, target);
  });

  panel.querySelector("[data-file-browser-search]").addEventListener("input", (event) => {
    state.query = event.currentTarget.value.trim().toLowerCase();
    renderTree(panel, state);
  });

  window.addEventListener("pi-plugin-sidebar:open", (event) => {
    syncToolbarButton(context.app);
    if (event.detail?.panel === PANEL_ID) refresh(context, state, panel);
  });
  window.addEventListener("pi-workspace:active", () => refresh(context, state, panel));
  window.addEventListener("pi-workspace-tree:refresh", (event) => refresh(context, state, panel, event.detail?.selectedPath || ""));

  context.app.syncPluginSidebarPanels?.();
  syncToolbarButton(context.app);
  refresh(context, state, panel);
}

function ensureToolbarButton(app) {
  const toolbar = app.querySelector("[data-plugin-toolbar]") || app.querySelector(".topbar .actions");
  if (!toolbar) return undefined;
  const existing = toolbar.querySelector(`[data-plugin-toolbar-button="${PANEL_ID}"]`);
  if (existing) return existing;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "iconbtn workspace-explorer-btn";
  button.dataset.action = "toggle-plugin-sidebar";
  button.dataset.pluginPanel = PANEL_ID;
  button.dataset.pluginToolbarButton = PANEL_ID;
  button.title = "file browser";
  button.hidden = app.dataset.route !== "workspace";
  button.setAttribute("aria-label", "toggle file browser");
  button.textContent = "📁";
  toolbar.insertBefore(button, toolbar.querySelector(".statusbtn"));
  return button;
}

function syncToolbarButton(app) {
  const button = app.querySelector(`[data-plugin-toolbar-button="${PANEL_ID}"]`);
  const sidebar = app.querySelector("[data-plugin-sidebar]");
  button?.classList.toggle("on", app.dataset.tree === "on" && sidebar?.dataset.activePluginPanel === PANEL_ID);
}

function ensurePanel(app) {
  const sidebar = app.querySelector("[data-plugin-sidebar]");
  let panel = sidebar.querySelector(`[data-plugin-panel="${PANEL_ID}"]`);
  if (panel) return panel;

  panel = document.createElement("section");
  panel.dataset.pluginPanel = PANEL_ID;
  panel.className = "pi-file-browser-panel";
  panel.append(createHeader(), createBody());
  sidebar.append(panel);
  return panel;
}

function createHeader() {
  const header = document.createElement("div");
  header.className = "tree-head";
  const tabs = document.createElement("span");
  tabs.className = "tree-tabs";
  const title = document.createElement("span");
  title.className = "tree-tab on";
  title.textContent = "📁 files";
  tabs.append(title);
  const actions = document.createElement("span");
  actions.className = "tree-head-actions";
  actions.append(actionButton("new-file", "+", "new file"), actionButton("refresh", "↻", "refresh files"));
  header.append(tabs, actions);
  return header;
}

function createBody() {
  const body = document.createElement("div");
  body.className = "tree-arborist";
  const label = document.createElement("label");
  label.className = "tree-search";
  label.setAttribute("aria-label", "search files");
  const input = document.createElement("input");
  input.dataset.fileBrowserSearch = "";
  input.placeholder = "search files";
  label.append(input);
  const tree = document.createElement("div");
  tree.className = "tree-arborist-body tree-list";
  tree.dataset.fileBrowserTree = "";
  tree.append(emptyNode("file tree loads when opened"));
  const tip = document.createElement("div");
  tip.className = "tree-tip";
  tip.textContent = "click a file to preview · use + to create a file";
  body.append(label, tree, tip);
  return body;
}

function actionButton(action, label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.fileBrowserAction = action;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = label;
  return button;
}

async function refresh(context, state, panel, selectedPath = "") {
  const workspaceId = context.app.dataset.activeWorkspaceId;
  if (!workspaceId) {
    setTree(panel, [emptyNode("open a workspace first")]);
    return;
  }

  setTree(panel, [emptyNode("loading files…")]);
  try {
    const result = await context.backend("list", { workspaceId, data: {} });
    state.files = result.files || [];
    state.statusMap = result.statusMap || {};
    state.selectedPath = selectedPath || state.selectedPath;
    context.app.workspaceFiles = state.files;
    context.app.workspaceFileStatuses = state.statusMap;
    renderTree(panel, state);
  } catch (error) {
    const node = emptyNode(error.message || "file browser unavailable");
    node.classList.add("err");
    setTree(panel, [node]);
  }
}

function renderTree(panel, state) {
  const rows = [];
  for (const node of state.files) appendNode(rows, node, state, 0);
  setTree(panel, rows.length ? rows : [emptyNode("no files found")]);
}

function appendNode(rows, node, state, depth) {
  const isDir = node.type === "dir";
  const children = node.children || [];
  const matches = !state.query || (node.path || node.name || "").toLowerCase().includes(state.query);
  const childRows = [];
  for (const child of children) appendNode(childRows, child, state, depth + 1);
  if (!matches && childRows.length === 0) return;

  const path = node.path || node.name || "";
  const expanded = state.query || state.expanded.has(path) || depth === 0;
  rows.push(rowNode(node, state, depth, expanded));
  if (isDir && expanded) rows.push(...childRows);
}

function rowNode(node, state, depth, expanded) {
  const isDir = node.type === "dir";
  const path = node.path || node.name || "";
  const status = normalizeStatus(state.statusMap[path]);
  const row = document.createElement("button");
  row.type = "button";
  row.className = ["tree-node", isDir ? "dir" : "file", status, state.selectedPath === path ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.dataset.fileBrowserAction = isDir ? "toggle" : "open";
  row.dataset.path = path;
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  glyph.textContent = isDir ? (expanded ? "▾" : "▸") : "•";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = node.name || path;
  row.append(glyph, name);
  if (status !== "clean") {
    const badge = document.createElement("span");
    badge.className = "tree-status-badge";
    badge.textContent = statusLabel(status);
    row.append(badge);
  }
  return row;
}

function handleAction(context, state, panel, target) {
  const action = target.dataset.fileBrowserAction;
  const path = target.dataset.path || "";
  if (action === "refresh") return refresh(context, state, panel);
  if (action === "toggle") {
    state.expanded.has(path) ? state.expanded.delete(path) : state.expanded.add(path);
    renderTree(panel, state);
    return undefined;
  }
  if (action === "open") {
    state.selectedPath = path;
    renderTree(panel, state);
    window.dispatchEvent(new CustomEvent("pi-workspace-file:open", { detail: { path } }));
    return undefined;
  }
  if (action === "new-file") return createFile(context, state, panel);
  return undefined;
}

async function createFile(context, state, panel) {
  const workspaceId = context.app.dataset.activeWorkspaceId;
  const path = window.prompt("New file path", "untitled.txt");
  if (!workspaceId || !path) return;
  await context.backend("create", { workspaceId, data: { path, content: "" } });
  await refresh(context, state, panel, path);
}

function setTree(panel, nodes) {
  panel.querySelector("[data-file-browser-tree]").replaceChildren(...nodes);
}

function emptyNode(message) {
  const node = document.createElement("div");
  node.className = "tree-empty";
  node.textContent = message;
  return node;
}

function normalizeStatus(status) {
  return ["modified", "added", "deleted", "renamed", "untracked"].includes(status) ? status : "clean";
}

function statusLabel(status) {
  return { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "?" }[status] || "";
}
