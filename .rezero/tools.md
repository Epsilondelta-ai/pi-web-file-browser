# Re:ZERO Tools

<!-- rezero-init: v0.1.0 -->

## Detected Stack

- Pi Web plugin: `plugin.json` declares frontend entry `index.js` and backend entry `backend.js`.
- Browser JavaScript UI: `index.js` implements the plugin panel and file editor integration.
- Go backend helper: `backend.go` provides filesystem operations; no `go.mod` is present.
- No package manifest, test runner, CI, container, or IaC config was found.

## Installed/Configured

- Typhon: Go formatter/parser check — `gofmt -w backend.go` and `go test ./...` when a Go module is added.
- Typhon: JavaScript syntax check — `node --check index.js && node --check backend.js`.
- Minerva: Smoke verification — install/load the local plugin in Pi Web and exercise list/read/write/rename/delete flows manually.
- Satella: Git hygiene/security baseline — `git status --short`; run `gitleaks detect --source .` if `gitleaks` is installed locally.

## Skipped

- SonarQube / sonar-scanner — skipped because this small plugin has no package/module build setup; add when project metadata and CI are introduced.
- Playwright / Lighthouse / axe — skipped because no web app package or browser test harness exists in this repository.
- OSV-Scanner / Knip / source-map-explorer — skipped because there is no dependency manifest to analyze.
- CodeQL / Trivy — skipped because no CI/container metadata is present.
- k6 / Pact / Spectral — skipped because this is not an API service and no OpenAPI/contract files exist.

## Local Services

- None required.

## Required Environment

- Go CLI for backend formatting/build checks.
- Node.js for JavaScript syntax checks.
- Pi Web runtime for manual plugin smoke testing.
