#!/usr/bin/env bash
# Run this checkout as a headless server, with the settings you chose in the
# desktop app.
#
#   git pull && scripts/serve.sh [serve flags]
#   scripts/serve.sh --build-only            build, do not start
#
# On the machine the desktop app is set up on, there is nothing to pass: the
# app's Settings window already wrote settings.json and its setup window wrote
# client.json (your GRFs), and `ragnarok-stack serve` reads both from the app's
# data folder. Any flag after the first is handed to `serve` unchanged
# (--lan, --era, --grf ...; see docs/HEADLESS_SERVER.md).
#
# It builds what the release workflow builds (.github/workflows/build.yml,
# CONTRIBUTING.md "Building and running locally") into payload/, and on later
# runs rebuilds only the parts whose sources a pull changed:
#
#   the web client     config/VENDOR_PINS, patches/, scripts/patch-*
#   the engine kit     config/NEBULA_MIN_VERSION
#   the helpers        config/DOCKER_SLIM_PIN, config/REMOTECLIENT_PIN
#   server images      containers/, third-party/, apply-server-mods.sh, pins
#   payload/           anything in the checkout
#
# Server images are downloaded from the project's `images` release, as CI does
# (override with RAGNAROK_IMAGES_REPO=owner/repo). They match main; a checkout
# that changes the server itself needs them built locally -- see CONTRIBUTING.md
# "Building the server images".
#
# Quit the desktop app first, and let it finish quitting: both use the same
# ports and the same database disk.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
STAMPS="$ROOT/.ragnarokmac/serve-build"
mkdir -p "$STAMPS"

BUILD_ONLY=0
if [ "${1:-}" = "--build-only" ]; then BUILD_ONLY=1; shift; fi

say() { printf '==> %s\n' "$*"; }
die() { printf 'serve.sh: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)/$(uname -m)" in
    Darwin/arm64)          TRIPLE=aarch64-apple-darwin; ARCH=arm64 ;;
    Linux/x86_64)          TRIPLE=x64-unknown-linux;    ARCH=x64 ;;
    *) die "no engine kit for $(uname -s)/$(uname -m): the app ships for Apple silicon Macs and x64 Linux (and Windows, which this script does not cover)" ;;
esac

for tool in git curl tar node npm cargo; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed (see CONTRIBUTING.md \"What you need\")"
done
if [ "$ARCH" = x64 ] && ! { [ -r /dev/kvm ] && [ -w /dev/kvm ]; }; then
    echo "warning: /dev/kvm is missing or not usable by $(id -un); the server will not start. See docs/HEADLESS_SERVER.md." >&2
fi

sha256() {
    if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
    else sha256sum | awk '{print $1}'; fi
}
# What a set of paths holds now: committed content plus uncommitted edits, so
# a local change rebuilds as surely as a pulled one.
key_of() { { git ls-files -s -- "$@"; git diff HEAD -- "$@"; } | sha256; }
fresh() { [ -f "$STAMPS/$1" ] && [ "$(cat "$STAMPS/$1")" = "$2" ]; }
mark() { printf '%s\n' "$2" > "$STAMPS/$1"; }

REBUILT=""

# --- the web client --------------------------------------------------------
CLIENT_KEY=$(key_of config/VENDOR_PINS config/TRANSLATION_EXTRAS patches 'scripts/patch-*')
WEB="$ROOT/vendor/roBrowserLegacy/dist/Web"
if ! fresh client "$CLIENT_KEY" || [ ! -f "$WEB/api.html" ]; then
    say "building the web client (a few minutes)"
    mkdir -p vendor
    # vendor-fetch.sh resets a checkout only when its pin moves. A changed
    # patch on an unmoved pin needs the same clean start, or a patch that was
    # removed stays applied.
    if [ -d vendor/roBrowserLegacy/.git ]; then
        git -C vendor/roBrowserLegacy reset -q --hard
        git -C vendor/roBrowserLegacy clean -q -fdx -e node_modules
    fi
    scripts/vendor-fetch.sh roBrowserLegacy vendor/roBrowserLegacy
    scripts/vendor-fetch.sh ROenglishRE vendor/ROenglishRE
    scripts/patch-client.sh
    (cd vendor/roBrowserLegacy && npm ci --no-audit --no-fund && npm run build:all)
    scripts/patch-bundle.sh "$WEB"
    (cd "$WEB" && rm -f GrfViewer.js MapViewer.js ModelViewer.js StrViewer.js EffectViewer.js GrannyModelViewer.js)
    mark client "$CLIENT_KEY"
    REBUILT="$REBUILT client"
fi

# --- the engine kit ----------------------------------------------------------
if [ -z "${NEBULA_EMBED_KIT:-}" ]; then
    NEBULA="v$(tr -d '\r\n' < config/NEBULA_MIN_VERSION)"
    KIT_KEY="$NEBULA-$TRIPLE"
    if ! fresh kit "$KIT_KEY" || [ ! -d .kit/bin ]; then
        say "downloading the nebula $NEBULA engine kit"
        rm -rf .kit && mkdir -p .kit
        curl -fL -o .kit/kit.tar.gz \
            "https://github.com/Flux159/nebula/releases/download/$NEBULA/nebula-slim-embed-$TRIPLE.tar.gz"
        tar xzf .kit/kit.tar.gz -C .kit && rm -f .kit/kit.tar.gz
        mark kit "$KIT_KEY"
        REBUILT="$REBUILT kit"
    fi
    export NEBULA_EMBED_KIT="$ROOT/.kit"
fi

# --- the two helpers, each built from its pin --------------------------------
built_at() { [ -x "$1" ] && [ "$(cat "$1.source-commit" 2>/dev/null)" = "$(tr -d '\r\n' < "$2")" ]; }
if ! built_at bin/docker-slim config/DOCKER_SLIM_PIN; then
    say "building docker-slim"
    bash scripts/build-docker-slim.sh
    REBUILT="$REBUILT docker-slim"
fi
if ! built_at bin/robrowser-remoteclient config/REMOTECLIENT_PIN; then
    say "building the asset server"
    bash scripts/build-remoteclient.sh
    REBUILT="$REBUILT remoteclient"
fi
export DOCKER_SLIM_BIN="$ROOT/bin/docker-slim"
export REMOTECLIENT_BIN="$ROOT/bin/robrowser-remoteclient"

# --- server images and schema ------------------------------------------------
IMAGES_REPO="${RAGNAROK_IMAGES_REPO:-Flux159/ragnarokoffline.app}"
IMAGES_KEY=$(printf '%s %s %s\n' "$IMAGES_REPO" "$ARCH" \
    "$(key_of containers third-party scripts/apply-server-mods.sh config/VENDOR_PINS config/PACKETVERS)" | sha256)
if ! fresh images "$IMAGES_KEY" || [ ! -f dist/images.tar.gz ] || ! ls .ragnarokmac/sql/*.sql >/dev/null 2>&1; then
    say "downloading server images from $IMAGES_REPO"
    mkdir -p dist .ragnarokmac/sql
    base="https://github.com/$IMAGES_REPO/releases/download/images"
    curl -fL -o dist/images.tar.gz.part "$base/images-$ARCH.tar.gz"
    mv dist/images.tar.gz.part dist/images.tar.gz
    curl -fL -o .ragnarokmac/rathena-sql.tar.gz "$base/rathena-sql.tar.gz"
    tar xzf .ragnarokmac/rathena-sql.tar.gz -C .ragnarokmac/sql
    mark images "$IMAGES_KEY"
    REBUILT="$REBUILT images"
fi

# --- payload/ ----------------------------------------------------------------
# The whole checkout but its documentation, plus whatever was rebuilt above.
PAYLOAD_KEY=$(printf '%s %s %s %s\n' "$(key_of . ':!docs' ':!docs-site' ':!*.md')" "$CLIENT_KEY" "$IMAGES_KEY" "${NEBULA_EMBED_KIT}" | sha256)
if [ -n "$REBUILT" ] || ! fresh payload "$PAYLOAD_KEY" || [ ! -x payload/bin/ragnarok-stack ]; then
    say "assembling payload/ (tests and builds the supervisor)"
    scripts/package.sh
    mark payload "$PAYLOAD_KEY"
fi

[ "$BUILD_ONLY" = 1 ] && { say "built $(git rev-parse --short HEAD) into payload/"; exit 0; }

# payload/ carries APP_VERSION, so the supervisor keeps its state in the app's
# own data folder (stack/src/config.rs default_state) -- the settings.json and
# client.json the desktop app wrote. Nothing here overrides that.
say "starting $(git rev-parse --short HEAD) with the app's settings ($(payload/bin/ragnarok-stack settings path | head -1 | sed 's/^settings: *//'))"
exec payload/bin/ragnarok-stack serve "$@"
