# Claude Meter

A desktop meter that shows your **real-time Claude Pro/Max subscription usage** — session limits, weekly limits, and Sonnet-specific limits — pulled directly from the Anthropic API.

![Screenshot](assets/screenshot.png)

## Features

- **Real usage data** from the Anthropic API (not estimates)
- **Global hotkey** (Ctrl+\\) to toggle the widget
- **System tray** icon with usage tooltip
- **Auto-refreshes** every 60s when visible, every 5 min in background
- **Activity-aware** — refreshes when Claude Code writes to session files
- **Remembers** window size and position
- **Zero cost** — reads the usage endpoint directly, no messages consumed
- **Single instance** — won't open duplicates

## Prerequisites

- [**Claude Code**](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (the app reads your OAuth token from `~/.claude/.credentials.json`)
- A **Claude Pro or Max** subscription

## Install

Download the latest release for your platform from [**Releases**](../../releases/latest).

### Windows

1. Download `Claude.Meter.Setup.x.x.x.exe`
2. Run the installer
3. The widget starts in the system tray — press **Ctrl+\\** to show it
4. Right-click the tray icon and enable **"Start on Login"** to auto-start on boot

### macOS

1. Download the `.dmg` for your Mac:
   - **Apple Silicon** (M1/M2/M3/M4): `*-arm64.dmg`
   - **Intel**: `*.dmg` (without arm64)
2. Open the `.dmg` and drag the app to Applications
3. Launch the app — press **Ctrl+\\** to show the widget

### Linux

1. Download the `.AppImage` for your architecture:
   - **x64**: `*.AppImage` (without arm64)
   - **ARM64**: `*-arm64.AppImage`
2. Make it executable: `chmod +x *.AppImage`
3. Run it: `./Claude.Meter-*.AppImage`
4. Press **Ctrl+\\** to show the widget

### From source

```bash
git clone https://github.com/SpitOnYourFace/claude-usage-widget.git
cd claude-usage-widget
npm install
npm start
```

## Usage

- Press **Ctrl+\\** to show/hide the widget
- Click the tray icon to toggle, or right-click for options
- Enable **"Start on Login"** from the tray menu to auto-start on boot
- The widget auto-refreshes every 60s when visible, every 5 min in background

## How it works

The widget reads your Claude Code OAuth token from `~/.claude/.credentials.json` and calls the Anthropic usage API endpoint (`/api/oauth/usage`) to fetch your current utilization percentages. No data is sent anywhere except `api.anthropic.com`.

The app is fully open source — inspect the code to verify.

## Building

```bash
npm run build        # Build for current platform
npm run build:win    # Windows .exe
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage
```

## Releasing

Push a version tag to trigger the CI build:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build for all platforms and create a release.

## License

MIT
