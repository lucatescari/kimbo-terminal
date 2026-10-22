#!/usr/bin/env bash
# Build and test Kimbo for Linux from macOS, inside a Docker container.
#
#   scripts/linux-build.sh            # frontend + cargo tests + tauri build
#   scripts/linux-build.sh test       # frontend tests + cargo tests only
#   scripts/linux-build.sh bundle     # sidecars + tauri build only, no tests
#   scripts/linux-build.sh shell      # interactive shell in the container
#
# The repo is bind-mounted at /work. node_modules, the cargo caches and the
# Rust target directory live in named Docker volumes so the macOS copies are
# never touched (their native binaries would not run on Linux anyway).
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE=kimbo-linux-build
MODE=${1:-build}

docker build -q -t "$IMAGE" -f docker/linux-build.Dockerfile docker >/dev/null

run() {
  local tty=()
  [ -t 0 ] && tty=(-it)
  docker run --rm ${tty[@]+"${tty[@]}"} \
    -v "$PWD:/work" \
    -v kimbo-linux-node-modules:/work/node_modules \
    -v kimbo-linux-cargo-registry:/usr/local/cargo/registry \
    -v kimbo-linux-cargo-git:/usr/local/cargo/git \
    -v kimbo-linux-target:/work/target-linux \
    -e CARGO_TARGET_DIR=/work/target-linux \
    -e CI=true \
    "$IMAGE" "$@"
}

case "$MODE" in
  shell)
    run bash
    ;;
  test)
    run bash -lc 'set -e; npm ci --no-audit --no-fund; npx vitest run; cargo test --workspace'
    ;;
  bundle)
    run bash -lc 'set -e; npm ci --no-audit --no-fund; cargo build --release -p kimbo-claude-statusline -p kimbo-claude-notify; npx tauri build --bundles deb --no-sign'
    ;;
  build)
    run bash -lc 'set -e; npm ci --no-audit --no-fund; npx vitest run; cargo test --workspace; cargo build --release -p kimbo-claude-statusline -p kimbo-claude-notify; npx tauri build --bundles deb --no-sign'
    ;;
  *)
    echo "usage: $0 [build|test|bundle|shell]" >&2; exit 2
    ;;
esac
