const PANEL_ID = "file-browser";

const icons = {
  folder: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>',
  refresh: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>',
};

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
  button.innerHTML = icons.folder;
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
  panel.innerHTML = `
    <div class="tree-head">
      <span class="tree-tabs"><span class="tree-tab on">${icons.folder} files</span></span>
      <span class="tree-head-actions">
        <button type="button" data-file-browser-action="new-file" title="new file" aria-label="new file">${icons.plus}</button>
        <button type="button" data-file-browser-action="refresh" title="refresh files" aria-label="refresh files">${icons.refresh}</button>
      </span>
    </div>
    <div class="tree-arborist">
      <label class="tree-search" aria-label="search files"><input data-file-browser-search placeholder="search files" /></label>
      <div class="tree-arborist-body tree-list" data-file-browser-tree><div class="tree-empty">file tree loads when opened</div></div>
      <div class="tree-tip">click a file to preview · use + to create a file</div>
    </div>`;
  sidebar.append(panel);
  return panel;
}

async function refresh(context, state, panel, selectedPath = "") {
  const workspaceId = context.app.dataset.activeWorkspaceId;
  if (!workspaceId) {
    setTree(panel, '<div class="tree-empty">open a workspace first</div>');
    return;
  }

  setTree(panel, '<div class="tree-empty">loading files…</div>');
  try {
    const [filesResult, gitResult] = await Promise.all([
      context.api.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`),
      context.api.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/git/status`).catch(() => ({ files: {} })),
    ]);
    state.files = filesResult.files || [];
    state.statusMap = gitResult.files || {};
    state.selectedPath = selectedPath || state.selectedPath;
    context.app.workspaceFiles = state.files;
    context.app.workspaceFileStatuses = state.statusMap;
    renderTree(panel, state);
  } catch (error) {
    setTree(panel, `<div class="tree-empty err">${escapeHtml(error.message || "file browser unavailable")}</div>`);
  }
}

function renderTree(panel, state) {
  const rows = [];
  for (const node of state.files) appendNode(rows, node, state, 0);
  setTree(panel, rows.join("") || '<div class="tree-empty">no files found</div>');
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
  const status = normalizeStatus(state.statusMap[path]);
  rows.push(`<button type="button" class="tree-node ${isDir ? "dir" : "file"} ${status} ${state.selectedPath === path ? "selected" : ""}" style="padding-left:${8 + depth * 14}px" data-file-browser-action="${isDir ? "toggle" : "open"}" data-path="${escapeHtml(path)}"><span class="glyph">${isDir ? (expanded ? "▾" : "▸") : "•"}</span><span class="name">${escapeHtml(node.name || path)}</span>${status !== "clean" ? `<span class="tree-status-badge">${statusLabel(status)}</span>` : ""}</button>`);
  if (isDir && expanded) rows.push(...childRows);
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
  await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, kind: "file", content: "" }),
  });
  await refresh(context, state, panel, path);
}

function setTree(panel, html) {
  panel.querySelector("[data-file-browser-tree]").innerHTML = html;
}

function normalizeStatus(status) {
  return ["modified", "added", "deleted", "renamed", "untracked"].includes(status) ? status : "clean";
}

function statusLabel(status) {
  return { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "?" }[status] || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}
