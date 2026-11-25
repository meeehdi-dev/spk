# spk desktop (Electron)

A thin Electron client for spk. It loads your self-hosted spk server URL and does not embed the Nuxt server. Plain JS, no build step.

## Run

```sh
cd integrations/electron
pnpm install --ignore-workspace
pnpm start
```

On first launch, enter your server URL (`https://…`, or `http://` for localhost only). Change it later from **File → Change server…**. The choice is saved in `config.json` in the Electron user data folder.

## Build

```sh
pnpm dist:mac     # dist/spk-<version>[-arm64].dmg and -mac.zip (arm64 and x64), ad-hoc signed
pnpm dist:linux   # dist/spk-<version>.AppImage and dist/spk-desktop-<version>.tar.gz (x64)
pnpm dist:win     # dist/spk Setup <version>.exe (NSIS) and dist/spk-<version>-win.zip (x64)
```

The AppImage and NSIS steps run x86-64 tools (and Wine for NSIS), so they fail on Apple Silicon without Rosetta. Build them on x86-64 Linux, or in Docker:

```sh
# from the repo root
docker run --rm --platform linux/amd64 -v "$PWD":/project -w /project/integrations/electron \
  electronuserland/builder:wine node node_modules/electron-builder/cli.js --linux AppImage --win nsis
```

Under amd64 emulation on Apple Silicon, Wine may not start, and the NSIS installer then fails; the zip and tar.gz targets work everywhere.

## Features

- Unread badge from `<meta name="spk-unread">`, the same source as the [Ferdium recipe](../ferdium/README.md).
- Notifications, microphone, camera, and screen sharing (native picker on macOS 15+), granted only to your server's origin.
- The unread badge works on macOS, and on Linux only with a matching `.desktop` file or Unity launcher. It does not work on Windows.
- Links to other sites open in your default browser; only the server origin loads in the window.

## Limitations

- Same-origin popups (attachment "Open", image "Open original") open in the system browser, which needs its own sign-in.
- No Web Push: Electron has no push service, so push is disabled in the app. Notifications appear only while the app is running.
- Builds are unsigned (Windows SmartScreen will warn) and have no auto-update. macOS builds are ad-hoc signed and not notarized: on first launch, right-click the app and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/spk.app`.
- macOS asks for microphone and camera access on first use; if denied, enable it in System Settings → Privacy & Security.

## Manual verification

1. First launch shows the setup page; an invalid URL (`ftp://x`, `http://example.com`) shows an error.
2. A valid URL loads spk; relaunch loads it directly.
3. File → Change server… returns to setup with the current URL prefilled.
4. Unread messages in another account set the dock/taskbar badge; reading clears it.
5. A link to an external site opens in the browser, not in the window.
6. Joining voice asks for the microphone (macOS prompt) and works; screen share starts.
7. A second launch focuses the existing window.
8. Settings → Notifications shows no push subscribe option; the permission prompt still works.
