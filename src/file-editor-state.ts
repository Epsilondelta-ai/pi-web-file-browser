const SHELL_FILENAMES: Set<string> = new Set([".env", ".envrc", ".bashrc", ".zshrc", ".profile"]);
const SHELL_EXTENSIONS: Set<string> = new Set(["bash", "csh", "env", "fish", "sh", "zsh"]);

export const MAX_EDITABLE_BYTES: number = 256 * 1024;

export type FilePreviewKind = "loading" | "error" | "text" | "image" | string;

export type FilePreview = {
  path?: string;
  mime?: string;
  content?: string;
  originalContent?: string;
  previewKind?: FilePreviewKind;
  truncated?: boolean;
  readOnly?: boolean;
  size?: number;
};

export type EditableFileState = {
  editable: boolean;
  readOnly: boolean;
  reason: "loading" | "error" | "large" | "missing" | "editable" | "image" | "binary";
};

export type CodeMirrorLanguageName = "javascript" | "typescript" | "json" | "markdown" | "html" | "css" | "go" | "shell" | "dockerfile" | "makefile" | "text";

export function editableFileState(file: FilePreview): EditableFileState {
  if (file.previewKind === "loading") return { editable: false, readOnly: true, reason: "loading" };
  if (file.previewKind === "error") return { editable: false, readOnly: true, reason: "error" };
  if (file.truncated) return { editable: false, readOnly: true, reason: "large" };

  if (typeof file.content !== "string" && file.previewKind !== "image") {
    return { editable: false, readOnly: true, reason: "missing" };
  }

  if (isTextFile(file)) return { editable: true, readOnly: false, reason: "editable" };
  if (file.previewKind === "image") return { editable: false, readOnly: true, reason: "image" };
  return { editable: false, readOnly: true, reason: "binary" };
}

export function isTextFile(file: FilePreview): boolean {
  return file.previewKind === "text" || file.mime === "image/svg+xml";
}

export function fileExtensionFromName(name: string): string {
  if (!name.includes(".")) return "";
  return name.split(".").pop() || "";
}

export function codeMirrorLanguageName(file: FilePreview): CodeMirrorLanguageName {
  const mime: string = file.mime || "";
  if (mime === "application/json") return "json";
  if (mime === "image/svg+xml" || mime.endsWith("+xml")) return "html";
  if (mime === "text/html") return "html";
  if (mime === "text/css") return "css";

  const name: string = basename(file).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile" || name === "justfile") return "makefile";
  if (SHELL_FILENAMES.has(name)) return "shell";

  const extension: string = fileExtensionFromName(name);
  if (["js", "mjs", "cjs", "jsx"].includes(extension)) return "javascript";
  if (["ts", "mts", "cts", "tsx"].includes(extension)) return "typescript";
  if (["json", "jsonc", "ipynb"].includes(extension)) return "json";
  if (["md", "markdown", "mdx"].includes(extension)) return "markdown";
  if (["html", "htm", "astro", "svelte", "vue"].includes(extension)) return "html";
  if (["css", "less", "scss"].includes(extension)) return "css";
  if (extension === "go") return "go";
  if (SHELL_EXTENSIONS.has(extension)) return "shell";
  return "text";
}

function basename(file: FilePreview): string {
  return (file.path || "").split("/").pop() || "";
}
