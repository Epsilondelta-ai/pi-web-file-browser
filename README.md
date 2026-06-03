# pi-web-file-browser

File browser sidebar plugin for pi-web.

Owns the file editor implementation. The browser bundle includes CodeMirror, language support, search, save, and git-change gutter markers.

## Install

```sh
pi-web
# Settings → Plugins → local path → ../pi-web-file-browser → install
```

Provides a separate file-browser panel button target (`file-browser`).

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

`src/index.js` and `src/file-editor.js` are bundled into `index.js` for pi-web to load as the plugin entry.
