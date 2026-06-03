#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p bin/darwin-amd64 bin/darwin-arm64 bin/linux-amd64 bin/linux-arm64

for target in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do
  os=${target%/*}
  arch=${target#*/}
  out="bin/${os}-${arch}/pi-web-file-browser-backend"
  echo "building ${os}-${arch} -> ${out}"
  GOOS=${os} GOARCH=${arch} CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "${out}" backend.go
done
