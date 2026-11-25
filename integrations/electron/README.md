# spk desktop (Electron)

A thin Electron client for spk. It loads your self-hosted spk server URL and does not embed the Nuxt server. Plain JS, no build step.

## Run

```sh
cd integrations/electron
pnpm install --ignore-workspace
pnpm start
```

On macOS, `pnpm start` runs a renamed copy of Electron in `.dev/spk.app` (gitignored) so the menu bar and dock show spk and its icon. It is launched through `open` rather than as a child of your terminal: otherwise macOS applies the terminal's privacy permissions and never asks for spk's own. App output is mirrored from `.dev/output.log`. It is rebuilt when the Electron version changes; delete `.dev` to force it. The copy has its own bundle id (`dev.spk.desktop.dev`) and appears as **spk dev** in Privacy & Security, separate from installed builds (`dev.spk.desktop`), so each entry's toggle applies to the right app.

On first launch, enter your server URL (`https://…`, or `http://` for localhost only). Change it later from **spk → Change server…** (macOS) or **File → Change server…**. The choice is saved in `config.json` in the Electron user data folder.

## Build

Ready-made builds for every platform are on the [GitHub Releases](https://github.com/meeehdi-dev/spk/releases) page. To build locally:

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

## Release

Releases are automatic. The [Desktop workflow](../../.github/workflows/desktop.yml) builds macOS, Linux and Windows on every PR that touches this folder (artifacts only). On each push to `main` that changes this folder (Markdown aside) since the last `desktop-v*` tag, it:

1. Picks the next version from the Conventional Commit subjects ([`scripts/next-version.mjs`](scripts/next-version.mjs)): `feat` bumps the minor version, anything else the patch, `!` the major (the minor before 1.0).
2. Commits `chore(desktop): release X.Y.Z [skip ci]` to `main` with the new `version` in `package.json`.
3. Builds all platforms from that commit and publishes the `desktop-vX.Y.Z` GitHub release with the installers, archives and the desktop commits as notes.

Do not edit `version` by hand, and pull `main` after a desktop release: CI pushed a commit.

## Features

- Unread badge from `<meta name="spk-unread">`, the same source as the [Ferdium recipe](../ferdium/README.md). It works on macOS, and on Linux only with a matching `.desktop` file or Unity launcher; not on Windows.
- Notifications, microphone, camera, and screen sharing, granted only to your server's origin. A mention or DM while spk is in the background bounces the dock (macOS) or flashes the taskbar; clicking the notification brings spk to the front.
- **Menus:** spk/File (Settings… ⌘,, Change server…, Open at login on macOS/Windows, Global shortcuts, Push-to-talk), **Voice** (mute, deafen, camera, share screen with check marks, leave), View, Window, Help. macOS dock menu: mute, deafen, leave.
- **Screen picker:** choose a screen or window, and whether to share audio (system audio, Windows and macOS 14.2+).
- **Global shortcuts** (opt-in): ⌘/Ctrl+Alt+Shift+M mutes and +D deafens while another app is focused.
- **Push-to-talk** (opt-in): pick any key; the mic is open only while it is held, even when spk is in the background. macOS needs Accessibility permission.
- **Tray** (Windows/Linux) with call status and quick actions; **taskbar buttons** (Windows) for mute, deafen and leave during a call.
- The computer does not sleep during a call. Radio responds to media keys (play/pause).
- Links to other sites open in your default browser; only the server origin loads in the window.

Voice menu, dock menu, tray, shortcuts and push-to-talk need a server running a spk version with the desktop bridge (`app/plugins/desktop.client.ts`); with older servers those items stay disabled.

## macOS permissions

Builds are ad-hoc signed, so each rebuild can appear as a new spk entry in System Settings → Privacy & Security and lose its permissions (Accessibility, needed for push-to-talk, in particular). Quit spk and run `pnpm reset-permissions` to clear them (both spk and spk dev), then grant them again. `tccutil` only resets an app macOS currently knows about, so run it while the app (or `.dev`) still exists. Delete old `dist/mac*` builds you no longer use: a stale copy with the same bundle id can make System Settings show an entry whose toggle has no effect.

The first launch of a downloaded build needs Privacy & Security → **Open Anyway** (or `xattr -dr com.apple.quarantine /Applications/spk.app`). After allowing System Audio Recording or Screen Recording, restart spk.

## Limitations

- Same-origin popups (attachment "Open", image "Open original") open in the system browser, which needs its own sign-in.
- No Web Push: Electron has no push service, so push is disabled in the app. Notifications appear only while the app is running.
- Screen audio is all system audio (also when sharing a single window). spk asks the system to leave out its own audio (the call), but this is not yet verified on every platform, so listeners may still hear themselves; other apps' audio is included. Not available on Linux. macOS asks for System Audio Recording permission the first time.
- Push-to-talk on Linux needs X11 (not pure Wayland).
- The Linux tray needs an AppIndicator-capable desktop (GNOME: AppIndicator extension).
- Builds are unsigned (Windows SmartScreen will warn) and have no auto-update. macOS builds are ad-hoc signed and not notarized (see macOS permissions above for the first launch).
- macOS asks for microphone and camera access on first use; if denied, spk offers to open the right System Settings pane.

## Manual verification

1. First launch shows the setup page; an invalid URL (`ftp://x`, `http://example.com`) shows an error.
2. A valid URL loads spk; relaunch loads it directly.
3. File → Change server… returns to setup with the current URL prefilled.
4. Unread messages in another account set the dock/taskbar badge; reading clears it.
5. A link to an external site opens in the browser, not in the window.
6. Joining voice asks for the microphone (macOS prompt) and works; screen share starts; with audio, listeners hear system audio.
7. A second launch focuses the existing window.
8. Settings → Notifications shows no push subscribe option; the permission prompt still works.
9. Voice menu items are disabled outside a call (and on old servers); in a call, check marks follow in-app toggles and each shortcut toggles exactly once.
10. Screen share shows the picker; Cancel shares nothing; a window share works; "Share audio" off sends no audio.
11. Global shortcuts: mute/deafen from another app; nothing extra while spk is focused.
12. Push-to-talk: set a key; the mic is muted until the key is held, also in the background; deafen wins.
13. A mention in the background bounces/flashes; clicking the notification focuses spk on the message.
14. Windows: tray menu and tooltip, taskbar buttons appear in a call and disappear after leaving. macOS: dock menu, About shows spk, Open at login.
15. Denying microphone/screen in System Settings shows the dialog once and opens the right pane.
