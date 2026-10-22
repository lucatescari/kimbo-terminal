# Linux build environment for Kimbo. Used by scripts/linux-build.sh on macOS
# (Docker Desktop, aarch64) and usable as the base of a Linux CI job.
#
# Ubuntu 24.04 is the oldest LTS that ships libwebkit2gtk-4.1, which Tauri 2
# requires. Everything the app links against is installed here; Rust and
# Node come from upstream so the versions match the macOS toolchain.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates git pkg-config file wget xz-utils \
    libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev \
    libayatana-appindicator3-dev libxdo-dev patchelf \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (matches the macOS dev machines closely enough; Vite 8 needs >= 20).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust stable via rustup, installed system-wide like the official rust image.
# The container runs as root: Docker Desktop on macOS presents bind-mounted
# files as the host user regardless, and the named volumes the build script
# mounts are root-owned when Docker creates them.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path

WORKDIR /work
