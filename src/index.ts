import { CodeMirrorFileEditor } from "./file-editor";
import type { FilePreview } from "./file-editor";

const PANEL_ID = "file-browser";

export type SubscriptionLike = { closed?: boolean; unsubscribe(): void };
export type SubjectLike<T> = { subscribe(callback: (value: T) => void): SubscriptionLike };
export type SidebarSnapshot = { activeWorkspaceId: string };
export type SidebarApi = { state$?: SubjectLike<SidebarSnapshot> };
type BackendResult = { files?: FileNode[]; statusMap?: Record<string, string> };
export type PluginContext = {
  app: AppElement;
  backend(method: string, input: { workspaceId?: string; data?: Record<string, unknown> }): Promise<BackendResult & FilePreview>;
  files?: { read(workspaceId: string, path: string): Promise<FilePreview> };
};
export type AppElement = HTMLElement & {
  fileBrowserOutsideCloseBound?: boolean;
  fileBrowserSidebarTopBound?: boolean;
  piWebSidebar?: SidebarApi;
  workspaceFiles?: FileNode[];
  workspaceFileStatuses?: Record<string, string>;
};
type FileBrowserButton = HTMLButtonElement & { fileBrowserOnToggle?: () => void; fileBrowserToggleBound?: boolean };
export type FileBrowserState = {
  files: FileNode[];
  statusMap: Record<string, string>;
  expanded: Set<string>;
  collapsed: Set<string>;
  selectedPath: string;
  query: string;
  sidebarConnected: boolean;
  sidebarStateSubject?: SubjectLike<SidebarSnapshot>;
  sidebarSubscription?: SubscriptionLike;
  sidebarWorkspaceId: string;
};
type FileNode = { name?: string; path?: string; type?: string; children?: FileNode[] };
type FileEditorModal = HTMLDivElement & {
  fileBrowserContext?: PluginContext;
  fileEditor?: CodeMirrorFileEditor;
};
type ActionItem = { path: string; kind?: string };
type MaterialIconName = string;

export default function activate(context: PluginContext): () => void {
  const panel = ensurePanel(context.app);
  const state: FileBrowserState = createFileBrowserState();
  ensureToolbarButton(context.app, () => {
    const isOpen = toggleFileBrowserSidebar(context.app);
    syncToolbarButton(context.app);

    if (isOpen) {
      bindSidebarBridge(context, state, panel);
      refresh(context, state, panel);
    }
  });
  ensureOutsideClose(context.app);

  panel.addEventListener("click", (event: MouseEvent): void => {
    const source: Element | null = event.target instanceof Element ? event.target : null;
    const target: HTMLElement | null = source?.closest<HTMLElement>("[data-file-browser-action]") || null;
    if (!target || !panel.contains(target)) return;
    event.preventDefault();
    handleAction(context, state, panel, target);
  });

  panel.querySelector<HTMLInputElement>("[data-file-browser-search]")?.addEventListener("input", (event: Event): void => {
    const input: HTMLInputElement = event.currentTarget as HTMLInputElement;
    state.query = input.value.trim().toLowerCase();
    renderTree(panel, state);
  });

  const refreshActiveWorkspace = (): void => {
    const bridgeChanged: boolean = bindSidebarBridge(context, state, panel);

    if (bridgeChanged || !state.sidebarConnected) {
      void refresh(context, state, panel);
    }
  };
  const refreshTree = (event: Event): void => {
    const detail = (event as CustomEvent<{ selectedPath?: string }>).detail;
    void refresh(context, state, panel, detail?.selectedPath || "");
  };
  const openWorkspaceFile = (event: Event): void => {
    const detail = (event as CustomEvent<{ path?: string }>).detail;
    const path = detail?.path || "";
    if (!path) return;
    state.selectedPath = path;
    renderTree(panel, state);
    void openEditor(context, state, path);
  };
  window.addEventListener("pi-workspace:active", refreshActiveWorkspace);
  window.addEventListener("pi-workspace-tree:refresh", refreshTree);
  window.addEventListener("pi-workspace-file:open", openWorkspaceFile);
  bindSidebarBridge(context, state, panel);

  syncToolbarButton(context.app);
  void refresh(context, state, panel);

  return (): void => {
    state.sidebarSubscription?.unsubscribe();
    window.removeEventListener("pi-workspace:active", refreshActiveWorkspace);
    window.removeEventListener("pi-workspace-tree:refresh", refreshTree);
    window.removeEventListener("pi-workspace-file:open", openWorkspaceFile);
  };
}

export function createFileBrowserState(): FileBrowserState {
  return {
    files: [],
    statusMap: {},
    expanded: new Set<string>(),
    collapsed: new Set<string>(),
    selectedPath: "",
    query: "",
    sidebarConnected: false,
    sidebarWorkspaceId: "",
  };
}

export function bindSidebarBridge(context: PluginContext, state: FileBrowserState, panel: HTMLElement): boolean {
  const sidebarApi: SidebarApi | undefined = context.app.piWebSidebar;
  const stateSubject: SubjectLike<SidebarSnapshot> | undefined = sidebarApi?.state$;
  const previousConnected: boolean = state.sidebarConnected;
  const previousSubject: SubjectLike<SidebarSnapshot> | undefined = state.sidebarStateSubject;
  const previousSubscriptionClosed: boolean = !!state.sidebarSubscription?.closed;
  const previousWorkspaceId: string = state.sidebarWorkspaceId;
  if (state.sidebarSubscription && !state.sidebarSubscription.closed && previousSubject === stateSubject) {
    state.sidebarConnected = true;
    return false;
  }

  state.sidebarSubscription?.unsubscribe();
  state.sidebarSubscription = undefined;
  state.sidebarStateSubject = undefined;

  if (!stateSubject) {
    state.sidebarConnected = false;
    state.sidebarWorkspaceId = "";
    return previousConnected || !!previousWorkspaceId;
  }

  state.sidebarConnected = true;
  state.sidebarStateSubject = stateSubject;
  state.sidebarWorkspaceId = "";
  let initializing = true;
  state.sidebarSubscription = stateSubject.subscribe((snapshot: SidebarSnapshot): void => {
    const nextWorkspaceId: string = snapshot.activeWorkspaceId || "";

    if (nextWorkspaceId === state.sidebarWorkspaceId) {
      return;
    }

    state.sidebarWorkspaceId = nextWorkspaceId;
    state.selectedPath = "";
    state.query = "";

    if (!initializing) {
      void refresh(context, state, panel);
    }
  });
  initializing = false;

  return (
    !previousConnected ||
    previousSubject !== stateSubject ||
    previousSubscriptionClosed ||
    previousWorkspaceId !== state.sidebarWorkspaceId
  );
}

export function activeWorkspaceId(context: PluginContext, state: FileBrowserState): string {
  if (state.sidebarConnected) {
    return state.sidebarWorkspaceId;
  }

  return context.app.dataset.activeWorkspaceId || "";
}

function ensureToolbarButton(app: AppElement, onToggle: () => void): FileBrowserButton | undefined {
  const toolbar = app.querySelector("[data-plugin-toolbar]") || app.querySelector(".topbar .actions");
  if (!toolbar) return undefined;
  let button: FileBrowserButton | null = toolbar.querySelector<FileBrowserButton>(`[data-plugin-toolbar-button="${PANEL_ID}"]`);
  if (!button) {
    button = document.createElement("button") as FileBrowserButton;
    button.type = "button";
    button.className = "iconbtn workspace-explorer-btn";
    button.dataset.pluginToolbarButton = PANEL_ID;
    button.title = "file browser";
    button.hidden = app.dataset.route !== "workspace";
    button.setAttribute("aria-label", "toggle file browser");
    button.append(materialThemeIcon("folder"));
    toolbar.insertBefore(button, toolbar.querySelector(".statusbtn"));
  }
  button.fileBrowserOnToggle = onToggle;
  if (!button.fileBrowserToggleBound) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.fileBrowserOnToggle?.();
    });
    button.fileBrowserToggleBound = true;
  }
  return button;
}

function materialThemeIcon(name: MaterialIconName, size = 16): HTMLImageElement {
  const img = document.createElement("img");
  img.alt = "";
  img.width = size;
  img.height = size;
  img.src = materialIconDataUrl(name);
  return img;
}

function materialIconDataUrl(name: MaterialIconName): string {
  const svg = materialIconSvg(name);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function materialIconSvg(name: MaterialIconName): string {
  const color = materialIconColor(name);
  const label = materialIconLabel(name);
  const folderPath =
    "M2.5 6.5c0-1.1.9-2 2-2h4l1.6 1.8h5.4c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2h-11c-1.1 0-2-.9-2-2z";
  const filePath = "M5 2.5h7l3 3v12h-10z";
  const shape = name.startsWith("folder")
    ? `<path fill="${color}" d="${folderPath}"/>`
    : `<path fill="${color}" d="${filePath}"/><path fill="rgba(255,255,255,.35)" d="M12 2.5v3h3z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">${shape}<text x="9" y="13" text-anchor="middle" font-family="Arial, sans-serif" font-size="5" font-weight="700" fill="rgba(255,255,255,.92)">${label}</text></svg>`;
}

function materialIconColor(name: MaterialIconName): string {
  return {
    astro: "#ff5d01",
    css: "#42a5f5",
    file: "#90a4ae",
    folder: "#f4b400",
    "folder-open": "#f6c34a",
    go: "#00add8",
    html: "#e44d26",
    javascript: "#f7df1e",
    json: "#8bc34a",
    markdown: "#607d8b",
    nodejs: "#68a063",
    react: "#61dafb",
    react_ts: "#61dafb",
    readme: "#42a5f5",
    svg: "#ffb13b",
    tsconfig: "#3178c6",
    typescript: "#3178c6",
    vite: "#646cff",
    yaml: "#cb171e",
  }[name] || "#90a4ae";
}

function materialIconLabel(name: MaterialIconName): string {
  return {
    astro: "A",
    css: "CSS",
    file: "",
    folder: "",
    "folder-open": "",
    go: "GO",
    html: "&lt;&gt;",
    javascript: "JS",
    json: "{}",
    markdown: "MD",
    nodejs: "N",
    react: "R",
    react_ts: "TSX",
    readme: "i",
    svg: "SVG",
    tsconfig: "TS",
    typescript: "TS",
    vite: "V",
    yaml: "YML",
  }[name] || "";
}

function syncToolbarButton(app: AppElement): void {
  const button = app.querySelector<HTMLElement>(`[data-plugin-toolbar-button="${PANEL_ID}"]`);
  const sidebar = app.querySelector<HTMLElement>("[data-file-browser-sidebar]");
  button?.classList.toggle("on", sidebar?.dataset.open === "true");
}

function toggleFileBrowserSidebar(app: AppElement): boolean {
  const sidebar = ensureSidebar(app);
  const isOpen = sidebar.dataset.open !== "true";
  setFileBrowserSidebarOpen(app, isOpen);
  return isOpen;
}

function setFileBrowserSidebarOpen(app: AppElement, isOpen: boolean): void {
  const sidebar = ensureSidebar(app);
  sidebar.dataset.open = String(isOpen);
  sidebar.setAttribute("aria-hidden", String(!isOpen));
}

function ensureOutsideClose(app: AppElement): void {
  if (app.fileBrowserOutsideCloseBound) return;
  document.addEventListener("pointerdown", (event: PointerEvent): void => {
    const sidebar = app.querySelector<HTMLElement>("[data-file-browser-sidebar]");
    if (sidebar?.dataset.open !== "true") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-file-browser-sidebar]")) return;
    if (target.closest(".pi-file-browser-menu")) return;
    if (target.closest("[data-file-editor-modal]")) return;
    if (target.closest(`[data-plugin-toolbar-button="${PANEL_ID}"]`)) return;
    setFileBrowserSidebarOpen(app, false);
    syncToolbarButton(app);
  });
  app.fileBrowserOutsideCloseBound = true;
}

function ensurePanel(app: AppElement): HTMLElement {
  const sidebar = ensureSidebar(app);
  let panel: HTMLElement | null = sidebar.querySelector<HTMLElement>(`[data-plugin-panel="${PANEL_ID}"]`);
  if (panel) return panel;

  panel = document.createElement("section");
  panel.dataset.pluginPanel = PANEL_ID;
  panel.className = "pi-file-browser-panel";
  panel.append(createHeader(), createBody());
  sidebar.append(panel);
  return panel;
}

function ensureStyle(app: AppElement): HTMLStyleElement {
  let style: HTMLStyleElement | null = document.querySelector<HTMLStyleElement>(`[data-file-browser-style="${PANEL_ID}"]`);
  if (style) return style;

  style = createStyle();
  style.dataset.fileBrowserStyle = PANEL_ID;
  (document.head || app).append(style);
  return style;
}

function ensureSidebar(app: AppElement): HTMLElement {
  ensureStyle(app);

  let sidebar: HTMLElement | null = app.querySelector<HTMLElement>("[data-file-browser-sidebar]");
  if (sidebar) {
    syncSidebarTop(app, sidebar);
    return sidebar;
  }

  sidebar = document.createElement("aside");
  sidebar.className = "pi-file-browser-sidebar";
  sidebar.dataset.fileBrowserSidebar = "";
  sidebar.dataset.open = "false";
  sidebar.dataset.ready = "false";
  sidebar.setAttribute("aria-hidden", "true");
  app.append(sidebar);
  syncSidebarTop(app, sidebar);
  requestAnimationFrame(() => {
    sidebar.dataset.ready = "true";
  });
  if (!app.fileBrowserSidebarTopBound) {
    window.addEventListener("resize", () => syncSidebarTop(app));
    app.fileBrowserSidebarTopBound = true;
  }
  return sidebar;
}

function syncSidebarTop(
  app: AppElement,
  sidebar: HTMLElement | null = app.querySelector<HTMLElement>("[data-file-browser-sidebar]"),
): void {
  if (!sidebar) return;
  const topbar: HTMLElement | null = app.querySelector<HTMLElement>(".topbar") || document.querySelector<HTMLElement>(".topbar");
  const top = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0;
  sidebar.style.setProperty("--file-browser-sidebar-top", `${top}px`);
}

function createStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = [
    ".pi-file-browser-sidebar { position: fixed; top: var(--file-browser-sidebar-top, 48px); right: 0; bottom: 0; z-index: 70; width: min(360px, calc(100vw - 48px)); display: flex; flex-direction: column; background: var(--bg-2); border-left: 1px solid var(--border); box-shadow: -18px 0 50px rgba(0,0,0,.35); transform: translateX(100%); pointer-events: none; }",
    ".pi-file-browser-sidebar[data-ready='true'] { transition: transform .22s ease; }",
    ".pi-file-browser-sidebar[data-open='true'] { transform: translateX(0); pointer-events: auto; }",
    ".pi-file-browser-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }",
    ".pi-file-browser-panel .tree-arborist { min-height: 0; }",
    ".pi-file-browser-panel .tree-search { position: relative; display: block; padding: 10px 12px 8px; }",
    ".pi-file-browser-panel .tree-search::before { content: '⌕'; position: absolute; left: 24px; top: 50%; transform: translateY(-45%); color: var(--fg-3); font-size: 14px; pointer-events: none; }",
    ".pi-file-browser-panel .tree-search input { width: 100%; height: 34px; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--bg-1) 88%, transparent); color: var(--fg-0); font: 12px/1 var(--font-mono); letter-spacing: .01em; padding: 0 12px 0 32px; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.03); transition: border-color .14s ease, box-shadow .14s ease, background .14s ease; }",
    ".pi-file-browser-panel .tree-search input::placeholder { color: var(--fg-3); opacity: .72; }",
    ".pi-file-browser-panel .tree-search input:hover { border-color: color-mix(in srgb, var(--fg-3) 48%, var(--border)); background: var(--bg-1); }",
    ".pi-file-browser-panel .tree-search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), inset 0 1px 0 rgba(255,255,255,.04); background: var(--bg-1); }",
    ".pi-file-browser-panel [data-file-browser-tree] { overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; }",
    ".pi-file-browser-panel .tree-node { grid-template-columns: minmax(0, 1fr) auto auto; position: relative; gap: 6px; }",
    ".pi-file-browser-panel .tree-node-main { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; width: 100%; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }",
    ".pi-file-browser-panel .tree-row-menu { min-width: 26px; min-height: 26px; border: 0; border-radius: 7px; background: transparent; color: var(--fg-3); opacity: 0; cursor: pointer; }",
    ".pi-file-browser-panel .tree-node:hover .tree-row-menu, .pi-file-browser-panel .tree-row-menu:focus { opacity: 1; background: var(--bg-4); color: var(--fg-1); }",
    ".pi-file-browser-panel .file-icon img { width: 16px; height: 16px; display: block; }",
    ".pi-file-browser-menu { position: fixed; z-index: 90; min-width: 148px; padding: 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-2); box-shadow: 0 18px 48px rgba(0,0,0,.45); }",
    ".pi-file-browser-menu button { display: block; width: 100%; border: 0; border-radius: 7px; background: transparent; color: var(--fg-1); font: 12px/1 var(--font-mono); text-align: left; padding: 8px 9px; cursor: pointer; }",
    ".pi-file-browser-menu button:hover { background: var(--bg-3); }",
    ".pi-file-browser-menu button.danger { color: var(--danger); }",
    ".pi-file-editor-modal[hidden] { display: none; }",
    ".pi-file-editor-modal { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: rgba(0,0,0,.42); }",
    ".pi-file-editor-dialog { width: min(980px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); display: grid; grid-template-rows: auto 1fr; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-2); overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.5); }",
    ".pi-file-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-dim); }",
    ".pi-file-editor-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }",
    ".pi-file-editor-actions { display: inline-flex; align-items: center; gap: 8px; }",
    ".pi-file-editor-actions button { border: 1px solid var(--border); background: var(--bg-1); color: var(--fg-1); border-radius: var(--radius-1); padding: 5px 9px; font: inherit; }",
    ".pi-file-editor-body { min-height: 0; display: grid; }",
    ".pi-file-editor-codemirror { min-height: 0; height: 100%; display: flex; flex-direction: column; }",
    ".pi-file-editor-codemirror .cm-editor { flex: 1 1 auto; min-height: 0; height: 100%; }",
    ".pi-file-editor-codemirror .fp-editor-search { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border-dim); background: color-mix(in srgb, var(--bg-2) 88%, black); }",
    ".pi-file-editor-codemirror .fp-editor-search span { color: var(--fg-3); font: 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }",
    ".pi-file-editor-codemirror .fp-editor-search input { min-width: 180px; flex: 1 1 auto; height: 30px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-1); color: var(--fg-0); font: 12px/1 var(--font-mono); padding: 0 10px; outline: none; transition: border-color .14s ease, box-shadow .14s ease; }",
    ".pi-file-editor-codemirror .fp-editor-search input::placeholder { color: var(--fg-3); opacity: .7; }",
    ".pi-file-editor-codemirror .fp-editor-search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }",
    ".pi-file-editor-codemirror .fp-editor-search button { min-width: 30px; height: 30px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-1); color: var(--fg-1); font: 13px/1 var(--font-mono); cursor: pointer; transition: border-color .14s ease, color .14s ease, background .14s ease; }",
    ".pi-file-editor-codemirror .fp-editor-search button:hover { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-1)); }",
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
  title.append(materialThemeIcon("folder", 14), document.createTextNode(" files"));
  tabs.append(title);
  const actions = document.createElement("span");
  actions.className = "tree-head-actions";
  actions.append(actionButton("root-menu", "+", "file actions"), actionButton("refresh", "↻", "refresh files"));
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

async function refresh(context: PluginContext, state: FileBrowserState, panel: HTMLElement, selectedPath = ""): Promise<void> {
  const workspaceId: string = activeWorkspaceId(context, state);
  if (!workspaceId) {
    state.files = [];
    state.statusMap = {};
    state.selectedPath = "";
    context.app.workspaceFiles = state.files;
    context.app.workspaceFileStatuses = state.statusMap;
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
  const row = document.createElement("div");
  row.className = ["tree-node", isDir ? "dir" : "file", status, state.selectedPath === path ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  row.dataset.fileBrowserAction = isDir ? "toggle" : "open";
  row.dataset.path = path;
  row.dataset.depth = String(depth);
  row.style.paddingLeft = `${8 + depth * 14}px`;
  const main = document.createElement("button");
  main.type = "button";
  main.className = "tree-node-main";
  main.dataset.fileBrowserAction = isDir ? "toggle" : "open";
  main.dataset.path = path;
  main.dataset.depth = String(depth);
  const fileIcon = document.createElement("span");
  fileIcon.className = "file-icon";
  fileIcon.append(materialIcon(node, isDir, expanded));
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = node.name || path;
  main.append(fileIcon, name);
  row.append(main);
  if (status !== "clean") {
    const badge = document.createElement("span");
    badge.className = "tree-status-badge";
    badge.textContent = statusLabel(status);
    row.append(badge);
  }
  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "tree-row-menu";
  menu.dataset.fileBrowserAction = "row-menu";
  menu.dataset.path = path;
  menu.dataset.kind = isDir ? "dir" : "file";
  menu.textContent = "…";
  row.append(menu);
  return row;
}

function materialIcon(node, isDir, expanded) {
  const fallback = isDir ? "📁" : "•";
  const img = document.createElement("img");
  img.alt = "";
  img.src = materialIconDataUrl(materialIconName(node, isDir, expanded));
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
    state.query = "";
    const search = panel.querySelector("[data-file-browser-search]");
    if (search) search.value = "";
    toggleExpanded(state, path, Number(target.dataset.depth || 0));
    renderTree(panel, state);
    return undefined;
  }
  if (action === "open") {
    state.selectedPath = path;
    renderTree(panel, state);
    void openEditor(context, state, path);
    return undefined;
  }
  if (action === "root-menu") return showActionMenu(context, state, panel, target, { path: "", kind: "root" });
  if (action === "row-menu") return showActionMenu(context, state, panel, target, { path, kind: target.dataset.kind });
  if (action === "new-file") return createFile(context, state, panel, target.dataset.parent || "");
  if (action === "new-folder") return createFolder(context, state, panel, target.dataset.parent || "");
  if (action === "upload") return uploadFile(context, state, panel, target.dataset.parent || "");
  if (action === "rename") return renamePath(context, state, panel, path);
  if (action === "delete") return deletePath(context, state, panel, path);
  return undefined;
}

async function openEditor(context: PluginContext, state: FileBrowserState, path: string): Promise<void> {
  const workspaceId: string = activeWorkspaceId(context, state);
  if (!workspaceId || !path) return;
  const editor = ensureEditor(context.app);
  editor.fileBrowserContext = context;
  const title = editor.querySelector("[data-file-editor-title]");
  const status = editor.querySelector("[data-file-editor-status]");
  const save = editor.querySelector("[data-file-editor-save]");
  editor.dataset.workspaceId = workspaceId;
  editor.dataset.path = path;
  editor.dataset.cleanContent = "";
  editor.fileBrowserContext = context;
  destroyEditorInstance(editor);
  title.textContent = path;
  status.textContent = "loading…";
  save.disabled = true;
  editor.hidden = false;
  try {
    const file = await readFileForEditor(context, workspaceId, path);
    if (editor.dataset.workspaceId !== workspaceId || editor.dataset.path !== path) return;
    editor.dataset.cleanContent = file.content || "";
    await mountCodeMirrorEditor(context, editor, file);
    save.disabled = true;
    status.textContent = `${file.mime || "text/plain"} · ${file.size || 0} bytes${file.truncated ? " · preview only" : ""}`;
  } catch (error) {
    status.textContent = error.message || "file unavailable";
  }
}

async function readFileForEditor(context, workspaceId, path) {
  if (context.files?.read) {
    const file = await context.files.read(workspaceId, path);
    return { ...file, size: file.size ?? (file.content || "").length, readOnly: !!file.truncated };
  }
  return context.backend("read", { workspaceId, data: { path } });
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
  const editorHost = document.createElement("div");
  editorHost.className = "pi-file-editor-codemirror";
  editorHost.dataset.fileEditorHost = "";
  body.append(editorHost);
  dialog.append(head, body);
  editor.append(dialog);
  save.addEventListener("click", () => void saveEditor(app, editor));
  close.addEventListener("click", () => closeEditor(editor));
  app.append(editor);
  return editor;
}

async function mountCodeMirrorEditor(context, editor, file) {
  const host = editor.querySelector("[data-file-editor-host]");
  const save = editor.querySelector("[data-file-editor-save]");
  host.replaceChildren();
  editor.fileEditor = new CodeMirrorFileEditor(host, {
    file,
    content: file.content || "",
    originalContent: file.originalContent || file.content || "",
    readOnly: !!file.readOnly,
    onChange(content) {
      save.disabled = content === editor.dataset.cleanContent;
    },
    onSave() {
      void saveEditor(context.app, editor);
    },
  });
  editor.fileEditor.focus?.();
}

function destroyEditorInstance(editor) {
  editor.fileEditor?.destroy?.();
  editor.fileEditor = undefined;
  editor.querySelector("[data-file-editor-host]")?.replaceChildren();
}

async function saveEditor(app, editor) {
  const workspaceId = editor.dataset.workspaceId || app.dataset.activeWorkspaceId;
  const path = editor.dataset.path || "";
  const status = editor.querySelector("[data-file-editor-status]");
  const save = editor.querySelector("[data-file-editor-save]");
  const pluginContext = editor.fileBrowserContext;
  const content = editor.fileEditor?.getValue?.() || "";
  if (!workspaceId || !path || !pluginContext) return;
  save.disabled = true;
  status.textContent = "saving…";
  try {
    const file = await pluginContext.backend("write", { workspaceId, data: { path, content } });
    editor.dataset.cleanContent = file.content || content;
    status.textContent = "saved";
    window.dispatchEvent(new CustomEvent("pi-workspace-tree:refresh", { detail: { selectedPath: path } }));
  } catch (error) {
    status.textContent = error.message || "save failed";
    save.disabled = false;
  }
}

function closeEditor(editor) {
  const content = editor.fileEditor?.getValue?.() || "";
  if (content !== editor.dataset.cleanContent && !window.confirm("Discard unsaved file changes?")) return;
  destroyEditorInstance(editor);
  editor.hidden = true;
}

function showActionMenu(context, state, panel, target, item) {
  document.querySelector(".pi-file-browser-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "pi-file-browser-menu";
  const parent = item.kind === "dir" ? item.path : parentPath(item.path || "");
  menu.append(
    menuButton("new-file", "new file", parent),
    menuButton("new-folder", "new folder", parent),
    menuButton("upload", "upload file", parent),
  );
  if (item.kind !== "root") {
    menu.append(menuButton("rename", "rename", "", item.path), menuButton("delete", "delete", "", item.path, "danger"));
  }
  menu.addEventListener("click", (event: MouseEvent): void => {
    const source: Element | null = event.target instanceof Element ? event.target : null;
    const actionTarget: HTMLElement | null = source?.closest<HTMLElement>("[data-file-browser-action]") || null;
    if (!actionTarget || !menu.contains(actionTarget)) return;
    event.preventDefault();
    event.stopPropagation();
    menu.remove();
    handleAction(context, state, panel, actionTarget);
  });
  const rect = target.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 170)}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 160)}px`;
  document.body.append(menu);
  setTimeout(() => window.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

function menuButton(action, label, parent = "", path = "", className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.fileBrowserAction = action;
  button.dataset.parent = parent;
  button.dataset.path = path;
  if (className) button.className = className;
  button.textContent = label;
  return button;
}

async function createFile(context, state, panel, parent = "") {
  const workspaceId = activeWorkspaceId(context, state);
  const path = window.prompt("New file path", joinPath(parent, "untitled.txt"));
  if (!workspaceId || !path) return;
  await context.backend("create", { workspaceId, data: { path, content: "" } });
  await refresh(context, state, panel, path);
}

async function createFolder(context, state, panel, parent = "") {
  const workspaceId = activeWorkspaceId(context, state);
  const path = window.prompt("New folder path", joinPath(parent, "untitled"));
  if (!workspaceId || !path) return;
  await context.backend("create-folder", { workspaceId, data: { path } });
  state.expanded.add(path);
  await refresh(context, state, panel);
}

async function uploadFile(context, state, panel, parent = "") {
  const workspaceId = activeWorkspaceId(context, state);
  if (!workspaceId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    for (const file of files) {
      await context.backend("write", { workspaceId, data: { path: joinPath(parent, file.name), content: await file.text() } });
    }
    await refresh(context, state, panel);
  }, { once: true });
  input.click();
}

async function renamePath(context, state, panel, path) {
  const workspaceId = activeWorkspaceId(context, state);
  const next = window.prompt("Rename path", path);
  if (!workspaceId || !path || !next || next === path) return;
  await context.backend("rename", { workspaceId, data: { path, newPath: next } });
  await refresh(context, state, panel, next);
}

async function deletePath(context, state, panel, path) {
  const workspaceId = activeWorkspaceId(context, state);
  if (!workspaceId || !path || !window.confirm(`Delete ${path}?`)) return;
  await context.backend("delete", { workspaceId, data: { path } });
  await refresh(context, state, panel);
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

function joinPath(parent, name) {
  return parent ? `${parent.replace(/\/$/, "")}/${name}` : name;
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
