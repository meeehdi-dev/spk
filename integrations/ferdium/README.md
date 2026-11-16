# spk for Ferdium

Add your self-hosted spk server to [Ferdium](https://ferdium.org/) using the local recipe in [`spk/`](spk/). No dependency installation or build is needed.

## Install

1. Download this repository (or clone it) and locate `integrations/ferdium/spk/`.
2. Open Ferdium's settings and use **Open recipes directory**. Create a `dev` folder inside it if needed. The default locations are:

   | Platform | Development recipes directory                                                 |
   | -------- | ----------------------------------------------------------------------------- |
   | macOS    | `~/Library/Application Support/Ferdium/recipes/dev/`                          |
   | Windows  | `%APPDATA%\Ferdium\recipes\dev\`                                              |
   | Linux    | `~/.config/Ferdium/recipes/dev/` (or `$XDG_CONFIG_HOME/Ferdium/recipes/dev/`) |

   Custom profiles and sandboxed installations can use different locations; prefer Ferdium's directory button.

3. Copy the entire `spk` folder into `dev`. The result must be `recipes/dev/spk/package.json`, with `index.js`, `webview.js`, and `icon.svg` alongside it. Keep the folder named `spk`.
4. Reload Ferdium with **Cmd/Ctrl + Shift + R**, then choose **Add a new service**, search for **spk**, and select it.
5. Enter your server's HTTPS URL, such as `https://chat.example.com`, and save. Sign in normally, or open your invite link within the service if you need an account. You can add multiple spk services for different servers/accounts.

For local development, `http://localhost:3000` also works. Remote servers need HTTPS for microphone and camera access; do not disable certificate validation or web security.

## Badges and notifications

The badge shows the same total unread-message count as spk's browser title, including channel messages and DMs. It does not distinguish mentions or exclude muted channels. Enable unread badges in Ferdium's service settings if necessary.

The recipe reads spk's `spk-unread` metadata tag, not channel names or page titles. Your server must run a version of spk that includes this tag. Older versions still load but will not show an unread badge. Missing metadata (including on the sign-in page) clears the badge on the next Ferdium update.

Enable system notifications in spk's notification settings and allow Ferdium notifications in your OS. spk already provides notification sounds. Notification delivery while the service is unloaded or Ferdium is closed is not guaranteed; Web Push support depends on Ferdium/Electron.

Allow microphone/camera permissions when prompted. Screen sharing also depends on Ferdium and OS capture permissions. Keep spk's built-in appearance settings; the recipe does not inject a theme.

## Update

Replace the four files in `recipes/dev/spk/` with the latest copies and reload Ferdium. This is a local development recipe, so updates are manual. No marketplace installation or automatic updater is included.

When changing the app logo, also copy `public/logo.svg` to `integrations/ferdium/spk/icon.svg`. Bump the recipe's `package.json` version when distributing recipe changes.

## Manual verification

With a running server and a second account:

- Add a custom server URL, sign in, reload Ferdium, and confirm the session persists.
- Send messages from the other account; confirm the badge matches spk's unread count and clears after reading or signing out.
- Check a conversation name ending in `(3)` does not create a badge by itself.
- With the service unfocused, confirm notifications arrive without duplicate sounds.
- Join voice, enable the camera, and try screen sharing after granting permissions.

## References

- [Ferdium recipe guide](https://github.com/ferdium/ferdium-recipes/blob/main/docs/integration.md)
- [Recipe configuration](https://github.com/ferdium/ferdium-recipes/blob/main/docs/configuration.md)
- [Webview API](https://github.com/ferdium/ferdium-recipes/blob/main/docs/frontend_api.md)
- [Ferdium profile locations](https://ferdium.org/faq)
