# pi-web-file-browser

File browser sidebar plugin for pi-web.

Owns the file editor implementation. The TypeScript browser source is bundled to the `index.js` plugin entry and includes CodeMirror, language support, search, save, and git-change gutter markers.

## Install

```sh
pi-web
# Settings → Plugins → local path → ../pi-web-file-browser → install
```

Provides a separate file-browser panel button target (`file-browser`). When `pi-web-sidebar` is active, this plugin subscribes to `context.app.piWebSidebar.state$` and refreshes the file tree when the selected workspace changes. The legacy `pi-workspace:*` window events remain as a fallback.

## Backend

The plugin runs a prebuilt Go backend binary through `backend.js`.
Supported targets are:

- `darwin-amd64`
- `darwin-arm64`
- `linux-amd64`
- `linux-arm64`

Windows is not supported. Go is only needed when rebuilding the binaries from `backend.go`.

```sh
./scripts/build-backends.sh
```

## Frontend bundle

```sh
bun install
bun run build
```

`src/index.ts` and `src/file-editor.ts` are bundled into `index.js` for pi-web to load as the plugin entry. pi-web loads the compiled JavaScript named by `plugin.json`; TypeScript stays source-only.
