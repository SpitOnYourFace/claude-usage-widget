#!/usr/bin/env bash
# Claude Meter — one-liner installer for Linux and macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/SpitOnYourFace/claude-usage-widget/master/install.sh | bash
set -euo pipefail

REPO="SpitOnYourFace/claude-usage-widget"
INSTALL_DIR="$HOME/.local/bin"
LINK_NAME="claude-meter"

# --- helpers ---
info()  { printf '\033[1;34m::\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --- detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="mac" ;;
  MINGW*|MSYS*|CYGWIN*)
    err "Windows detected — download the installer from https://github.com/$REPO/releases/latest" ;;
  *) err "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_SUFFIX="" ;;
  aarch64|arm64) ARCH_SUFFIX="-arm64" ;;
  *) err "Unsupported architecture: $ARCH" ;;
esac

info "Detected: $PLATFORM ($ARCH)"

# --- fetch latest release ---
info "Finding latest release..."
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
VERSION="$(echo "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')"

if [ -z "$VERSION" ]; then
  err "Could not determine latest version"
fi

info "Latest version: $VERSION"

# --- pick the right asset ---
if [ "$PLATFORM" = "linux" ]; then
  EXT="AppImage"
  # match dash-named assets (Claude-Meter-x.x.x.AppImage)
  PATTERN="Claude-Meter-.*${ARCH_SUFFIX}\\.${EXT}$"
elif [ "$PLATFORM" = "mac" ]; then
  EXT="dmg"
  PATTERN="Claude-Meter-.*${ARCH_SUFFIX}\\.${EXT}$"
fi

ASSET_URL="$(echo "$RELEASE_JSON" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed 's/"browser_download_url": *"//;s/"$//' \
  | grep -E "$PATTERN" \
  | grep -v '\.blockmap$' \
  | head -1)"

if [ -z "$ASSET_URL" ]; then
  err "No matching asset found for $PLATFORM $ARCH"
fi

FILENAME="$(basename "$ASSET_URL")"
info "Downloading $FILENAME..."

# --- clean up old versions ---
cleanup_old() {
  local count=0
  for pattern in "$@"; do
    for f in $pattern; do
      [ -e "$f" ] || continue
      rm -f "$f" && count=$((count + 1))
    done
  done
  [ "$count" -gt 0 ] && info "Removed $count old file(s)"
}

if [ "$PLATFORM" = "linux" ]; then
  cleanup_old \
    "$HOME/Claude-Meter-"*".AppImage" \
    "$HOME/Claude.Meter-"*".AppImage" \
    "$INSTALL_DIR/$LINK_NAME"
fi

# --- download ---
TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT
curl -fSL --progress-bar -o "$TMPFILE" "$ASSET_URL"

# --- install ---
if [ "$PLATFORM" = "linux" ]; then
  mkdir -p "$INSTALL_DIR"
  mv "$TMPFILE" "$INSTALL_DIR/$LINK_NAME"
  chmod +x "$INSTALL_DIR/$LINK_NAME"
  trap - EXIT  # file moved, don't delete

  ok "Installed to $INSTALL_DIR/$LINK_NAME"

  # check PATH
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) info "Add $INSTALL_DIR to your PATH if it isn't already:
  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac

  echo ""
  info "Run with: claude-meter"

elif [ "$PLATFORM" = "mac" ]; then
  DMG_PATH="$HOME/Downloads/$FILENAME"
  mv "$TMPFILE" "$DMG_PATH"
  trap - EXIT

  # try to mount and copy to /Applications
  info "Mounting disk image..."
  MOUNT_DIR="$(hdiutil attach "$DMG_PATH" -nobrowse -quiet 2>/dev/null \
    | tail -1 | awk '{print $NF}')" || true

  if [ -n "$MOUNT_DIR" ] && [ -d "$MOUNT_DIR" ]; then
    APP="$(find "$MOUNT_DIR" -maxdepth 1 -name '*.app' | head -1)"
    if [ -n "$APP" ]; then
      APP_NAME="$(basename "$APP")"
      # remove old version
      [ -d "/Applications/$APP_NAME" ] && rm -rf "/Applications/$APP_NAME"
      cp -R "$APP" /Applications/
      ok "Installed $APP_NAME to /Applications"
    fi
    hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
    rm -f "$DMG_PATH"
    echo ""
    info "Launch from Applications or Spotlight"
  else
    ok "Downloaded to $DMG_PATH"
    info "Open the .dmg and drag the app to Applications"
  fi
fi

echo ""
ok "Claude Meter $VERSION installed successfully!"
