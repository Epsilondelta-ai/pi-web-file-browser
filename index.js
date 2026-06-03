const PANEL_ID = "file-browser";

export default function activate(context) {
  ensureToolbarButton(context.app);
  const panel = ensurePanel(context.app);
  const state = { files: [], statusMap: {}, expanded: new Set(), collapsed: new Set(), selectedPath: "", query: "" };

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
  panel.append(createStyle(), createHeader(), createBody());
  sidebar.append(panel);
  return panel;
}

function createStyle() {
  const style = document.createElement("style");
  style.textContent = [
    ".pi-file-browser-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }",
    ".pi-file-browser-panel .tree-arborist { min-height: 0; }",
    ".pi-file-browser-panel [data-file-browser-tree] { overflow-y: auto; overflow-x: hidden; }",
    ".pi-file-browser-panel .tree-node { grid-template-columns: 18px 1fr auto; }",
    ".pi-file-browser-panel .file-icon img { width: 16px; height: 16px; display: block; }",
    ".pi-file-editor-modal[hidden] { display: none; }",
    ".pi-file-editor-modal { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: rgba(0,0,0,.42); }",
    ".pi-file-editor-dialog { width: min(980px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); display: grid; grid-template-rows: auto 1fr; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-2); overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.5); }",
    ".pi-file-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-dim); }",
    ".pi-file-editor-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }",
    ".pi-file-editor-actions { display: inline-flex; align-items: center; gap: 8px; }",
    ".pi-file-editor-actions button { border: 1px solid var(--border); background: var(--bg-1); color: var(--fg-1); border-radius: var(--radius-1); padding: 5px 9px; font: inherit; }",
    ".pi-file-editor-body { min-height: 0; display: grid; }",
    ".pi-file-editor-textarea { width: 100%; height: 100%; resize: none; border: 0; outline: none; background: var(--bg-1); color: var(--fg-0); font: 13px/1.55 var(--font-mono); padding: 14px; tab-size: 2; }",
    ".pi-file-editor-status { color: var(--fg-3); font-size: var(--text-xs); }",
  ].join("\n");
  return style;
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
  const expanded = isExpanded(state, path, depth);
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
  row.dataset.depth = String(depth);
  const fileIcon = document.createElement("span");
  fileIcon.className = "file-icon";
  fileIcon.append(materialIcon(node, isDir, expanded));
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = node.name || path;
  row.append(fileIcon, name);
  if (status !== "clean") {
    const badge = document.createElement("span");
    badge.className = "tree-status-badge";
    badge.textContent = statusLabel(status);
    row.append(badge);
  }
  return row;
}

function materialIcon(node, isDir, expanded) {
  const fallback = isDir ? "📁" : "•";
  const img = document.createElement("img");
  img.alt = "";
  img.src = `/node_modules/material-icon-theme/icons/${materialIconName(node, isDir, expanded)}.svg`;
  img.addEventListener("error", () => {
    img.replaceWith(document.createTextNode(fallback));
  }, { once: true });
  return img;
}

function materialIconName(node, isDir, expanded) {
  if (isDir) {
    return expanded ? "folder-open" : "folder";
  }
  const name = String(node.name || node.path || "").toLowerCase();
  const exact = {
    "package.json": "nodejs",
    "tsconfig.json": "tsconfig",
    "vite.config.ts": "vite",
    "astro.config.ts": "astro",
    "readme.md": "readme",
  };
  if (exact[name]) return exact[name];
  const ext = name.split(".").pop() || "";
  return {
    ts: "typescript",
    tsx: "react_ts",
    js: "javascript",
    jsx: "react",
    json: "json",
    md: "markdown",
    css: "css",
    go: "go",
    html: "html",
    svg: "svg",
    yml: "yaml",
    yaml: "yaml",
  }[ext] || "file";
}

function isExpanded(state, path, depth) {
  if (state.query) return true;
  if (state.collapsed.has(path)) return false;
  return state.expanded.has(path);
}

function toggleExpanded(state, path, depth) {
  if (isExpanded(state, path, depth)) {
    state.expanded.delete(path);
    state.collapsed.add(path);
    return;
  }
  state.collapsed.delete(path);
  state.expanded.add(path);
}

function handleAction(context, state, panel, target) {
  const action = target.dataset.fileBrowserAction;
  const path = target.dataset.path || "";
  if (action === "refresh") return refresh(context, state, panel);
  if (action === "toggle") {
    toggleExpanded(state, path, Number(target.dataset.depth || 0));
    renderTree(panel, state);
    return undefined;
  }
  if (action === "open") {
    state.selectedPath = path;
    renderTree(panel, state);
    void openEditor(context, path);
    return undefined;
  }
  if (action === "new-file") return createFile(context, state, panel);
  return undefined;
}

async function openEditor(context, path) {
  const workspaceId = context.app.dataset.activeWorkspaceId;
  if (!workspaceId || !path) return;
  const editor = ensureEditor(context.app);
  editor.fileBrowserContext = context;
  const title = editor.querySelector("[data-file-editor-title]");
  const status = editor.querySelector("[data-file-editor-status]");
  const textarea = editor.querySelector("[data-file-editor-textarea]");
  const save = editor.querySelector("[data-file-editor-save]");
  editor.dataset.workspaceId = workspaceId;
  editor.dataset.path = path;
  editor.dataset.cleanContent = "";
  title.textContent = path;
  status.textContent = "loading…";
  textarea.value = "";
  textarea.disabled = true;
  save.disabled = true;
  editor.hidden = false;
  try {
    const file = await context.backend("read", { workspaceId, data: { path } });
    if (editor.dataset.workspaceId !== workspaceId || editor.dataset.path !== path) return;
    editor.dataset.cleanContent = file.content || "";
    textarea.value = file.content || "";
    textarea.disabled = false;
    save.disabled = true;
    status.textContent = `${file.mime || "text/plain"} · ${file.size || 0} bytes`;
    textarea.focus();
  } catch (error) {
    status.textContent = error.message || "file unavailable";
  }
}

function ensureEditor(app) {
  let editor = app.querySelector("[data-file-editor-modal]");
  if (editor) return editor;
  editor = document.createElement("div");
  editor.className = "pi-file-editor-modal";
  editor.dataset.fileEditorModal = "";
  editor.hidden = true;
  const dialog = document.createElement("div");
  dialog.className = "pi-file-editor-dialog";
  const head = document.createElement("div");
  head.className = "pi-file-editor-head";
  const title = document.createElement("strong");
  title.className = "pi-file-editor-title";
  title.dataset.fileEditorTitle = "";
  const actions = document.createElement("span");
  actions.className = "pi-file-editor-actions";
  const status = document.createElement("span");
  status.className = "pi-file-editor-status";
  status.dataset.fileEditorStatus = "";
  const save = document.createElement("button");
  save.type = "button";
  save.dataset.fileEditorSave = "";
  save.textContent = "save";
  save.disabled = true;
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.fileEditorClose = "";
  close.textContent = "close";
  actions.append(status, save, close);
  head.append(title, actions);
  const body = document.createElement("div");
  body.className = "pi-file-editor-body";
  const textarea = document.createElement("textarea");
  textarea.className = "pi-file-editor-textarea";
  textarea.dataset.fileEditorTextarea = "";
  body.append(textarea);
  dialog.append(head, body);
  editor.append(dialog);
  save.addEventListener("click", () => void saveEditor(app, editor));
  close.addEventListener("click", () => closeEditor(editor));
  textarea.addEventListener("input", () => {
    save.disabled = textarea.value === editor.dataset.cleanContent;
  });
  app.append(editor);
  return editor;
}

async function saveEditor(app, editor) {
  const workspaceId = editor.dataset.workspaceId || app.dataset.activeWorkspaceId;
  const path = editor.dataset.path || "";
  const textarea = editor.querySelector("[data-file-editor-textarea]");
  const status = editor.querySelector("[data-file-editor-status]");
  const save = editor.querySelector("[data-file-editor-save]");
  const pluginContext = editor.fileBrowserContext;
  if (!workspaceId || !path || !pluginContext) return;
  save.disabled = true;
  status.textContent = "saving…";
  try {
    const file = await pluginContext.backend("write", { workspaceId, data: { path, content: textarea.value } });
    editor.dataset.cleanContent = file.content || textarea.value;
    textarea.value = file.content || textarea.value;
    status.textContent = "saved";
    window.dispatchEvent(new CustomEvent("pi-workspace-tree:refresh", { detail: { selectedPath: path } }));
  } catch (error) {
    status.textContent = error.message || "save failed";
    save.disabled = false;
  }
}

function closeEditor(editor) {
  const textarea = editor.querySelector("[data-file-editor-textarea]");
  if (textarea.value !== editor.dataset.cleanContent && !window.confirm("Discard unsaved file changes?")) return;
  editor.hidden = true;
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
