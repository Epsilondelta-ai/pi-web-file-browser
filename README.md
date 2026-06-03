# pi-web-file-browser

File browser sidebar plugin for pi-web.

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
